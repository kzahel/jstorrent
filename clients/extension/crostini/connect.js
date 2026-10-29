import { t, localizeDocument } from "../src/localization.js";
const ORIGIN = "http://jstorrent.localhost:3030";
const PERMISSION = "http://jstorrent.localhost/*";
const MAX_HEALTH_BYTES = 4096;
const TIMEOUT_MILLIS = 10_000;

// These are reachability/compatibility observations, not an OS DNS diagnosis.
export async function checkLinuxHealth(signal, request = fetch) {
  const response = await request(`${ORIGIN}/healthz`, {
    signal, redirect: "error", credentials: "omit", cache: "no-store",
  });
  if (!response.body) return "invalid_response";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    if (!response.ok) return "service_error";
    if (Number(response.headers.get("content-length")) > MAX_HEALTH_BYTES) return "invalid_response";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_HEALTH_BYTES) return "invalid_response";
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let health;
  try { health = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return "invalid_response"; }
  if (health?.product !== "rstorrent-crostini") return "wrong_service";
  if (health.launch_protocol !== 1) return "incompatible";
  if (health.status !== "ok" || typeof health.build_id !== "string" ||
      !/^[\x21-\x7e]{1,128}$/u.test(health.build_id)) return "invalid_response";
  return "ready";
}

const messages = {
  permission_denied: t("connect_dynamic_001"),
  unreachable: t("connect_dynamic_002"),
  timeout: t("connect_dynamic_003"),
  service_error: t("connect_dynamic_004"),
  wrong_service: t("connect_dynamic_005"),
  incompatible: t("connect_dynamic_006"),
  invalid_response: t("connect_dynamic_007"),
  canceled: t("connect_dynamic_008"),
};

export function startLinuxConnection({ chrome, status, button, navigate, page }) {
  const report = failure => { void chrome.runtime?.sendMessage?.({ type: "productMetrics", op: "support", failure })?.catch(() => {}); };
  let active = true;
  let generation = 0;
  let controller;
  let task;
  async function run(requestPermission) {
    controller = new AbortController();
    const owned = controller;
    let timedOut = false;
    let timeout;
    button.textContent = t("connect_dynamic_009");
    button.disabled = true;
    status.textContent = t("connect_dynamic_010");
    try {
      const permission = { origins: [PERMISSION] };
      // request() must run in the explicit button gesture, before any await.
      const grant = requestPermission ? chrome.permissions.request(permission) : chrome.permissions.contains(permission);
      if (!await grant) { report("permission_denied"); status.textContent = messages.permission_denied; return; }
      if (owned.signal.aborted || !active) return;
      button.disabled = false;
      status.textContent = t("connect_dynamic_011");
      timeout = setTimeout(() => { timedOut = true; owned.abort(); }, TIMEOUT_MILLIS);
      const result = await checkLinuxHealth(owned.signal);
      report(result === "ready" ? "none" : result);
      if (owned.signal.aborted || !active) return;
      if (result === "ready") {
        status.textContent = t("connect_dynamic_012");
        // An older installed build may have left a cacheable HTML shell.
        // Fresh explicit connection must fetch the current asset references.
        navigate(`${ORIGIN}/?connect=${crypto.randomUUID()}`);
      } else status.textContent = messages[result];
    } catch {
      report(owned.signal.aborted ? timedOut ? "timeout" : "canceled" : "unreachable");
      if (active) status.textContent = messages[owned.signal.aborted ? timedOut ? "timeout" : "canceled" : "unreachable"];
    } finally {
      clearTimeout(timeout);
      if (active) { button.textContent = t("connect_dynamic_013"); button.disabled = false; }
    }
  }
  function connect(requestPermission) {
    if (task) return;
    task = run(requestPermission).finally(() => { task = undefined; });
  }
  button.onclick = () => {
    if (!active || button.disabled) return;
    if (task) {
      status.textContent = messages.canceled;
      button.disabled = true;
      controller.abort();
    } else connect(true);
  };
  page.addEventListener("pagehide", () => { generation += 1; active = false; controller?.abort(); });
  page.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const restoredGeneration = ++generation;
    void (async () => {
      await task;
      if (restoredGeneration !== generation) return;
      active = true;
      status.textContent = messages.canceled;
      button.textContent = t("connect_dynamic_014");
      button.disabled = false;
    })();
  });
  // Initial load/restoration never requests permission or wakes Linux.
  connect(false);
}

if (typeof document !== "undefined") {
  localizeDocument(document);
  startLinuxConnection({ chrome: globalThis.chrome,
    status: document.getElementById("connection-status"), button: document.getElementById("connect"),
    navigate: url => location.replace(url), page: window });
}

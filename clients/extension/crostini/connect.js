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
  permission_denied: "Linux connection access was not granted. No service was contacted. Select Retry to request access, or use setup and troubleshooting.",
  unreachable: "The Linux service could not be reached. Open Terminal and the Linux app, then retry. Linux setup, package installation and device policy are unknown.",
  timeout: "The Linux service did not respond within 10 seconds. Open Terminal and the Linux app, then retry.",
  service_error: "The Linux service returned an error. Open the Linux app and check its status, then retry.",
  wrong_service: "The responding service is not JSTorrent for ChromeOS Linux. Open the Linux app and check its status before retrying.",
  incompatible: "The Linux app and extension need compatible updates. Check setup and troubleshooting; your Linux library remains separate from Android.",
  invalid_response: "The Linux service returned an invalid response. Check the installed app before retrying.",
  canceled: "Connection canceled. Select Retry when you are ready.",
};

export function startLinuxConnection({ chrome, status, button, navigate, page }) {
  let active = true;
  let generation = 0;
  let controller;
  let task;
  async function run(requestPermission) {
    controller = new AbortController();
    const owned = controller;
    let timedOut = false;
    let timeout;
    button.textContent = "Cancel";
    button.disabled = true;
    status.textContent = "Checking Linux connection access…";
    try {
      const permission = { origins: [PERMISSION] };
      // request() must run in the explicit button gesture, before any await.
      const grant = requestPermission ? chrome.permissions.request(permission) : chrome.permissions.contains(permission);
      if (!await grant) { status.textContent = messages.permission_denied; return; }
      if (owned.signal.aborted || !active) return;
      button.disabled = false;
      status.textContent = "Checking the Linux service…";
      timeout = setTimeout(() => { timedOut = true; owned.abort(); }, TIMEOUT_MILLIS);
      const result = await checkLinuxHealth(owned.signal);
      if (owned.signal.aborted || !active) return;
      if (result === "ready") {
        status.textContent = "Linux service is ready. Opening your Linux library…";
        // An older installed build may have left a cacheable HTML shell.
        // Fresh explicit connection must fetch the current asset references.
        navigate(`${ORIGIN}/?connect=${crypto.randomUUID()}`);
      } else status.textContent = messages[result];
    } catch {
      if (active) status.textContent = messages[owned.signal.aborted ? timedOut ? "timeout" : "canceled" : "unreachable"];
    } finally {
      clearTimeout(timeout);
      if (active) { button.textContent = "Retry"; button.disabled = false; }
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
      button.textContent = "Retry";
      button.disabled = false;
    })();
  });
  // Initial load/restoration never requests permission or wakes Linux.
  connect(false);
}

if (typeof document !== "undefined") {
  startLinuxConnection({ chrome: globalThis.chrome,
    status: document.getElementById("connection-status"), button: document.getElementById("connect"),
    navigate: url => location.replace(url), page: window });
}

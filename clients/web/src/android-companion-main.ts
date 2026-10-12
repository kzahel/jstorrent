import type { ApplicationViewClient } from "./api/client";
import { AndroidCompanionPairingFailed, AndroidCompanionUnavailable, AndroidCompanionUpdateRequired, connectAndroidCompanion, type AndroidConnectionStage } from "./android-companion-client";
import { startCompanionInspection } from "./inspection/companion-bootstrap";
import { message } from "./localization/runtime";

interface ChromeConnectionContext {
  runtime: {
    id: string;
    getManifest(): { version: string };
    onMessage?: { addListener(listener: AttachListener): void; removeListener(listener: AttachListener): void };
  };
  tabs?: { getCurrent(): Promise<{ id?: number } | undefined> };
  permissions: { contains(permission: { origins: string[] }): Promise<boolean>; request?(permission: { origins: string[] }): Promise<boolean> };
}

type AttachListener = (message: { type?: string; tabId?: number }, sender: { id?: string }, respond: (value: { ok: boolean }) => void) => boolean;

// One page owns one attach attempt and one mounted view. Retry never launches
// an app; the visible production-targeted anchor owns the OS handoff.
export async function startAndroidCompanion(): Promise<void> {
  const element = (id: string) => document.getElementById(id)!;
  const status = element("companion-status");
  const retry = element("companion-cancel") as HTMLButtonElement;
  const grantAccess = element("companion-permission") as HTMLButtonElement;
  const preview = element("companion-preview") as HTMLButtonElement;
  const context = element("companion-context") as HTMLTextAreaElement;
  const bootstrap = element("companion-bootstrap");
  const identity = element("companion-identity");
  const app = element("app");
  const chrome = (globalThis as typeof globalThis & { chrome?: ChromeConnectionContext }).chrome;
  let stage: AndroidConnectionStage | "connected" = "discovery";
  let category = "none";
  let permission = "unknown";
  let version = "unknown";
  let appVersion = "unknown";
  let versionStatus = "unknown";
  let active = true;
  let controller: AbortController | undefined;
  let task: Promise<void> | undefined;
  let client: ApplicationViewClient | undefined;
  let unmount: (() => Promise<void>) | undefined;
  let connecting = false;
  const currentTab = await chrome?.tabs?.getCurrent();
  identity.replaceChildren();
  const help = document.createElement("a");
  help.href = "../crostini/setup.html#android";
  help.target = "_blank";
  help.rel = "noopener noreferrer";
  help.textContent = message("android.companion.help");
  const backendLabel = document.createElement("span");
  backendLabel.textContent = message("shell.companion.title");
  identity.append(backendLabel, " ", help);
  preview.onclick = () => {
    context.hidden = false;
    element("companion-context-privacy").hidden = false;
    const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+(?:\.\d+){0,3})/u)?.[1] ?? "unknown";
    const osVersion = navigator.userAgent.match(/CrOS (?:x86_64|aarch64|armv7l) (\d+(?:\.\d+){0,3})/u)?.[1] ?? "unknown";
    context.value = JSON.stringify({ schema: "chromeos-connection/v1", backend: "android", stage,
      category, extension_version: version, chrome_user_agent_version: chromeVersion, chromeos_user_agent_version: osVersion,
      chrome_build_version: "unknown", chromeos_build_version: "unknown",
      browser_permission: permission, app_presence: "unknown", play_availability: "unknown",
      device_policy: "unknown", app_version: appVersion, version_status: versionStatus }, null, 2);
    context.focus();
    context.select();
  };
  const finish = () => {
    retry.textContent = message("android.companion.retry-connection");
    retry.disabled = false;
    connecting = false;
  };
  retry.onclick = () => {
    if (!active || retry.disabled) return;
    if (connecting) {
      category = "canceled";
      status.textContent = (stage === "pairing" ? message("android.companion.pairing-canceled") : message("shell.companion.connection-canceled"));
      retry.disabled = true;
      controller?.abort();
    } else {
      void connect();
    }
  };
  grantAccess.onclick = () => {
    if (!active || connecting || grantAccess.disabled || !chrome?.permissions.request) return;
    grantAccess.disabled = true;
    // Invoke synchronously in the user click; do not request from restoration
    // or the website handoff, which carries no permission authority.
    void chrome.permissions.request({ origins: ["http://100.115.92.2/*"] }).then(async granted => {
      if (!active) return;
      if (granted) await connect();
    }).catch(() => {
      if (active) status.textContent = message("android.companion.permission-denied");
    }).finally(() => { grantAccess.disabled = false; });
  };
  const attach: AttachListener = (request, sender, respond) => {
    if (sender.id !== chrome?.runtime.id || request?.type !== "androidAttachRequested" ||
        !Number.isInteger(currentTab?.id) || request.tabId !== currentTab?.id ||
        Object.keys(request).sort().join(",") !== "tabId,type") return false;
    if (active && !connecting && !client && !task) void connect();
    respond({ ok: true });
    return false;
  };
  chrome?.runtime.onMessage?.addListener(attach);
  function connect(): Promise<void> {
    if (task) return task;
    task = run().finally(() => { task = undefined; });
    return task;
  }
  async function run(): Promise<void> {
    connecting = true;
    controller = new AbortController();
    const abort = controller;
    const timeout = setTimeout(() => {
      category = "timeout";
      status.textContent = message("android.companion.attempt-timeout");
      abort.abort();
    }, 150_000);
    let departed!: () => void;
    const departure = new Promise<void>(resolve => { departed = resolve; });
    let closing: Promise<void> | undefined;
    const closeClient = (): Promise<void> => {
      if (!client) return Promise.resolve();
      const ownedClient = client;
      closing ??= Promise.resolve().then(() => ownedClient.close()).catch(() => {});
      return closing;
    };
    const canceled = () => { departed(); void closeClient(); };
    abort.signal.addEventListener("abort", canceled, { once: true });
    category = "none";
    stage = "discovery";
    context.hidden = true;
    element("companion-context-privacy").hidden = true;
    element("companion-update-android").hidden = true;
    element("companion-update-extension").hidden = true;
    retry.textContent = message("shell.companion.cancel");
    retry.disabled = true;
    grantAccess.hidden = true;
    status.textContent = message("shell.companion.loading");
    try {
      if (chrome) {
        const manifestVersion = chrome.runtime.getManifest().version;
        if (/^\d+(?:\.\d+){0,3}$/u.test(manifestVersion)) version = manifestVersion;
        permission = await chrome.permissions.contains({ origins: ["http://100.115.92.2/*"] }) ? "granted" : "denied";
        if (abort.signal.aborted) return;
        if (permission === "denied") {
          grantAccess.hidden = false;
          category = "permission_denied";
          status.textContent = message("android.companion.permission-denied");
          return;
        }
      }
      retry.disabled = false;
      const connection = await connectAndroidCompanion((text, currentStage) => {
        if (abort.signal.aborted) return;
        status.textContent = text;
        if (currentStage) stage = currentStage;
      }, abort.signal);
      client = connection.client;
      if (abort.signal.aborted) return;
      unmount = await startCompanionInspection(client);
      if (abort.signal.aborted) return;
      clearTimeout(timeout);
      const productVersion = connection.hello.backend?.product_version;
      if (productVersion && /^\d+(?:\.\d+){0,3}(?:-[a-z0-9.]{1,32})?$/iu.test(productVersion)) appVersion = productVersion;
      versionStatus = "compatible";
      stage = "connected";
      connecting = false;
      bootstrap.hidden = true;
      identity.hidden = false;
      app.hidden = false;
      await Promise.race([connection.disconnected, departure]);
      if (!abort.signal.aborted) {
        category = "disconnected";
        status.textContent = message("shell.companion.disconnected");
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof AndroidCompanionUpdateRequired) {
        category = error.component === "android" ? "app_update_required" : "extension_update_required";
        versionStatus = category;
        element("companion-update-android").hidden = error.component !== "android";
        element("companion-update-extension").hidden = error.component !== "extension";
        status.textContent = error.message;
      } else if (error instanceof AndroidCompanionPairingFailed) {
        category = `pairing_${error.outcome}`;
        stage = "pairing";
        status.textContent = error.message;
      } else if (error instanceof AndroidCompanionUnavailable) {
        category = "service_unreachable";
        status.textContent = error.message;
      } else {
        category = "connection_failed";
        status.textContent = message("android.companion.failed");
      }
      status.setAttribute("role", "alert");
    } finally {
      clearTimeout(timeout);
      abort.signal.removeEventListener("abort", canceled);
      try { await unmount?.(); } catch { /* Continue releasing the connection. */ }
      await closeClient();
      unmount = undefined;
      client = undefined;
      app.hidden = true;
      identity.hidden = true;
      bootstrap.hidden = false;
      finish();
    }
  }
  const pagehide = (event: PageTransitionEvent) => {
    active = false;
    controller?.abort();
    app.hidden = true;
    if (!event.persisted) {
      chrome?.runtime.onMessage?.removeListener(attach);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    }
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (!event.persisted || active) return;
    active = true;
    // Restoration presents manual recovery, without resurrecting launch intent.
    void (async () => {
      await task;
      if (!active) return;
      category = "canceled";
      status.textContent = (stage === "pairing" ? message("android.companion.pairing-canceled") : message("shell.companion.connection-canceled"));
      finish();
    })();
  };
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);
  await connect();
}

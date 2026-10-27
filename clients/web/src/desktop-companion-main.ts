import { ApplicationViewError } from "./api/client";
import { message } from "./localization/runtime";
import { extensionSupport } from "./extension-support";
import { connectDesktopCompanion, desktopBootstrapFailure, desktopRuntime, DesktopCompanionUnavailable } from "./desktop-companion-client";
import { startCompanionInspection } from "./inspection/companion-bootstrap";

export async function startDesktopCompanion(): Promise<void> {
  document.title = "JSTorrent";
  const bootstrap = document.getElementById("companion-bootstrap")!;
  bootstrap.querySelector("h1")!.textContent = message("desktop.companion.title");
  const status = document.getElementById("companion-status")!;
  const start = document.getElementById("companion-cancel") as HTMLButtonElement;
  const identity = document.getElementById("companion-identity")!;
  const app = document.getElementById("app")!;
  const recovery = document.createElement("div");
  recovery.hidden = true;
  const desktopUpdate = document.createElement("a");
  desktopUpdate.className = "companion-action-link";
  desktopUpdate.href = "https://jstorrent.com/";
  desktopUpdate.target = "_blank";
  desktopUpdate.rel = "noopener noreferrer";
  desktopUpdate.textContent = message("desktop.companion.open-update");
  const extensionUpdate = document.createElement("a");
  extensionUpdate.href = "https://chromewebstore.google.com/detail/dbokmlpefliilbjldladbimlcfgbolhk";
  extensionUpdate.target = "_blank";
  extensionUpdate.rel = "noopener noreferrer";
  extensionUpdate.textContent = message("companion.open-extension-update");
  const extensionUpdateRow = document.createElement("p");
  extensionUpdateRow.append(extensionUpdate);
  recovery.append(desktopUpdate, extensionUpdateRow);
  status.after(recovery);
  let abort = new AbortController();
  let pageActive = true;
  let pageGeneration = 0;
  let connectionTask: Promise<void> | undefined;
  let closeInspection: (() => Promise<void>) | undefined;
  let attempt = 0;
  let retryOnly = false;
  let connecting = false;
  let closeConnection: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const openNative = document.createElement("button");
  openNative.textContent = message("desktop.companion.open-window");
  openNative.onclick = () => { void desktopRuntime().sendMessage({ type: "nativeBootstrap", op: "launch" }); };
  identity.replaceChildren(openNative);
  identity.hidden = false;
  start.textContent = message("desktop.companion.start");
  function showFailure(error: unknown): void {
    void extensionSupport("support", error instanceof ApplicationViewError ? error.code :
      error instanceof DesktopCompanionUnavailable ? "native_host_unavailable" : "connection_failed");
    const mismatch = error instanceof ApplicationViewError && error.code === "invalid_version";
    recovery.hidden = !mismatch && !(error instanceof DesktopCompanionUnavailable);
    extensionUpdateRow.hidden = !mismatch;
    retryOnly = error instanceof ApplicationViewError && ["authentication_failed", "invalid_version"].includes(error.code);
    start.textContent = retryOnly ? message("desktop.companion.retry") : message("desktop.companion.start");
    status.textContent = error instanceof ApplicationViewError && error.code === "invalid_version"
      ? message("desktop.companion.incompatible")
      : error instanceof ApplicationViewError && error.code === "authentication_failed"
        ? message("desktop.companion.identity-changed")
        : error instanceof Error ? error.message : message("desktop.companion.unavailable");
  }
  start.onclick = async () => {
    if (!pageActive || start.disabled) return;
    start.disabled = true;
    if (timer) clearTimeout(timer);
    try {
      if (retryOnly) {
        // Version/authentication recovery must not create runtime launch intent.
        await connect();
        return;
      }
      const response = await desktopRuntime().sendMessage({ type: "nativeBootstrap", op: "start_control" });
      if (!response.ok) throw desktopBootstrapFailure(response);
      if (!pageActive) return;
      attempt = 0;
      void connect();
    } catch (error) {
      showFailure(error);
    } finally {
      start.disabled = false;
    }
  };
  function connect(): Promise<void> {
    connectionTask ??= runConnection().finally(() => { connectionTask = undefined; });
    return connectionTask;
  }
  async function runConnection(): Promise<void> {
    if (connecting || abort.signal.aborted) return;
    connecting = true;
    let departed!: () => void;
    const departure = new Promise<void>(resolve => { departed = resolve; });
    abort.signal.addEventListener("abort", departed, { once: true });
    status.textContent = message("desktop.companion.connecting");
    recovery.hidden = true;
    try {
      const connection = await connectDesktopCompanion(abort.signal);
      if (abort.signal.aborted) { await connection.client.close(); return; }
      closeConnection = () => connection.client.close();
      const hostVersion = connection.hello.backend?.product_version;
      closeInspection = await startCompanionInspection(connection.client, false, {
        connection: "desktop-companion",
        ...(hostVersion === undefined || hostVersion.length > 64 ? {} : { hostVersion }),
      });
      if (abort.signal.aborted) return;
      retryOnly = false;
      start.textContent = message("desktop.companion.start");
      bootstrap.hidden = true;
      app.hidden = false;
      attempt = 0;
      void extensionSupport("support", "none");
      // A frozen document may not receive the socket's close event before it
      // is restored. Departure itself must release the page's ownership loop.
      await Promise.race([connection.disconnected, departure]);
      status.textContent = message("desktop.companion.disconnected");
      if (!abort.signal.aborted) void extensionSupport("support", "disconnected");
    } catch (error) {
      if (abort.signal.aborted) return;
      showFailure(error);
      if (retryOnly) return;
    } finally {
      abort.signal.removeEventListener("abort", departed);
      await closeInspection?.();
      await closeConnection?.();
      closeInspection = undefined;
      closeConnection = undefined;
      connecting = false;
      app.hidden = true;
      bootstrap.hidden = false;
    }
    if (!abort.signal.aborted) {
      timer = setTimeout(() => { void connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)));
    }
  }
  const pagehide = (event: PageTransitionEvent) => {
    pageActive = false;
    pageGeneration += 1;
    abort.abort();
    if (timer) clearTimeout(timer);
    void closeConnection?.();
    app.hidden = true;
    if (!event.persisted) {
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    }
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (!event.persisted || pageActive) return;
    pageActive = true;
    const generation = ++pageGeneration;
    // A bfcache restoration reuses this document. Finish the departed owner's
    // asynchronous mount/cleanup before creating another view or connection.
    void (async () => {
      await connectionTask;
      if (!pageActive || generation !== pageGeneration) return;
      abort = new AbortController();
      attempt = 0;
      await connect();
    })();
  };
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);
  await connect();
}

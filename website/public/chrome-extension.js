const EXTENSION_ID = "dbokmlpefliilbjldladbimlcfgbolhk";
const HANDOFF_URL = "https://jstorrent.com/chrome-extension.html";
const DEADLINE_MILLIS = 5_000;

export function startChromeExtensionHandoff(document, window, chromeApi) {
  const status = document.getElementById("handoff-status");
  const button = document.getElementById("handoff-open");
  let active = true;
  let pending = false;
  let timeout;
  let generation = 0;

  function finish(text) {
    if (!active || !pending) return;
    clearTimeout(timeout);
    pending = false;
    status.textContent = text;
    button.disabled = false;
  }
  function open() {
    if (!active || pending) return;
    // This route accepts no URL-supplied authority or target extension ID.
    if (window.location.href !== HANDOFF_URL || window.top !== window) {
      status.textContent = "Open the JSTorrent extension directly to continue setup.";
      return;
    }
    if (!chromeApi?.runtime?.sendMessage) {
      status.textContent = "The extension could not be opened here. Click it in Chrome, or install or update it using the link below.";
      return;
    }
    pending = true;
    const attempt = ++generation;
    const complete = text => { if (attempt === generation) finish(text); };
    button.disabled = true;
    status.textContent = "Opening the JSTorrent extension…";
    timeout = setTimeout(() => complete("The extension did not respond. Try again or click it in Chrome."), DEADLINE_MILLIS);
    try {
      chromeApi.runtime.sendMessage(EXTENSION_ID, { type: "openAndroidUi", protocolVersion: 1 }, response => {
        const failed = chromeApi.runtime.lastError;
        complete(!failed && response?.ok === true && response?.result?.kind === "android_ui"
          ? "The extension is open. Continue there; Android approval may still be needed."
          : "The extension could not be opened. Click it in Chrome, or install or update it using the link below.");
      });
    } catch {
      complete("The extension could not be opened. Click it in Chrome, or install or update it using the link below.");
    }
  }
  button.addEventListener("click", open);
  const depart = event => {
    active = false;
    pending = false;
    generation += 1;
    clearTimeout(timeout);
    button.removeEventListener("click", open);
    if (!event?.persisted) {
      window.removeEventListener("pagehide", depart);
      window.removeEventListener("pageshow", restore);
    }
  };
  const restore = event => {
    if (!event.persisted || active) return;
    active = true;
    button.disabled = false;
    status.textContent = "Choose Open Chrome library to continue setup.";
    button.addEventListener("click", open);
  };
  window.addEventListener("pagehide", depart);
  window.addEventListener("pageshow", restore);
  open();
  return depart;
}

if (typeof document !== "undefined") {
  startChromeExtensionHandoff(document, window, globalThis.chrome);
}

import { applyPresentation, presentationForPlatform } from "./platform.js";

const desktopSurface = document.querySelector("#desktop-surface");
const chromeosSurface = document.querySelector("#chromeos-surface");
const statusDot = document.querySelector("#status-dot");
const statusTitle = document.querySelector("#status-title");
const statusDetail = document.querySelector("#status-detail");
const launchButton = document.querySelector("#launch");
const linuxButton = document.querySelector("#launch-linux");
const linuxHelpButton = document.querySelector("#linux-help");
const linuxStatus = document.querySelector("#linux-status");
const androidButton = document.querySelector("#connect-android");
const androidStatus = document.querySelector("#android-status");
const ANDROID_HOST_PERMISSION = "http://100.115.92.2/*";
const PRIVACY_URL = "https://jstorrent.com/privacy.html";
const metricsDisclosure = document.querySelector("#metrics-disclosure");
const metricsDisclosureEnabled = document.querySelector("#metrics-disclosure-enabled");
const metricsContinue = document.querySelector("#metrics-continue");
const metricsSettings = document.querySelector("#metrics-settings");
const metricsEnabled = document.querySelector("#metrics-enabled");
const metricsSummary = document.querySelector("#metrics-summary");
const metricsReset = document.querySelector("#metrics-reset");
const metricsStatus = document.querySelector("#metrics-status");
const privacyPolicy = document.querySelector("#privacy-policy");
const privacyDetails = document.querySelector("#privacy-details");

function setStatus(kind, title, detail) {
  statusDot.className = `status-dot ${kind}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function request(op) {
  return chrome.runtime.sendMessage({ type: "nativeBootstrap", op });
}

async function checkDesktop() {
  setStatus("checking", "Checking desktop setup…", "Connecting to the desktop app.");
  launchButton.disabled = true;
  try {
    const response = await request("hello");
    if (!response?.ok || response.result?.kind !== "hello") {
      throw new Error(response?.error?.message || "JSTorrent Desktop is unavailable.");
    }
    setStatus(
      "ready",
      "JSTorrent Desktop is ready",
      "Open your library here. Downloads run in the desktop app.",
    );
    void updateMetrics("connected");
    launchButton.disabled = false;
  } catch (error) {
    setStatus(
      "error",
      "Desktop setup needed",
      error instanceof Error
        ? error.message
        : "Install JSTorrent Desktop and open it once to finish setup.",
    );
  }
}

launchButton.addEventListener("click", async () => {
  launchButton.disabled = true;
  setStatus("checking", "Opening JSTorrent…", "Sending a launch request to the desktop app.");
  try {
    const response = await chrome.runtime.sendMessage({ type: "desktopBootstrap", op: "open" });
    if (!response?.ok || response.result?.kind !== "desktop_ui") {
      throw new Error(response?.error?.message || "JSTorrent could not be opened.");
    }
    setStatus(
      "ready",
      "Launch requested",
      "Your desktop library is open in the browser.",
    );
  } catch (error) {
    setStatus(
      "error",
      "JSTorrent did not open",
      error instanceof Error ? error.message : "Open JSTorrent Desktop directly and try again.",
    );
    launchButton.disabled = false;
  }
});

linuxButton.addEventListener("click", async () => {
  linuxButton.disabled = true;
  linuxStatus.textContent = "Opening the ChromeOS Linux UI…";
  try {
    const response = await requestCrostini();
    if (!response?.ok) {
      throw new Error(response?.error?.message || "Chrome could not open the Linux preview.");
    }
    linuxStatus.textContent =
      "Page requested; Linux connection is not confirmed. Use its connection check and troubleshooting if Linux is stopped or unavailable.";
  } catch (error) {
    linuxStatus.textContent =
      error instanceof Error
        ? error.message
        : "Use JSTorrent for ChromeOS Linux from the Chromebook Launcher.";
  } finally {
    linuxButton.disabled = false;
  }
});

linuxHelpButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("crostini/setup.html") });
});

androidButton.addEventListener("click", async () => {
  androidButton.disabled = true;
  androidStatus.textContent = "Requesting access to the Android service…";
  try {
    const granted = await chrome.permissions.request({
      origins: [ANDROID_HOST_PERMISSION],
    });
    if (!granted) {
      androidStatus.textContent =
        "Android connection access was not granted. No local service was contacted.";
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: "androidBootstrap",
      op: "open",
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || "Chrome could not start the Android flow.");
    }
    androidStatus.textContent =
      "Connection page opened. If Android is not ready, use Open JSTorrent Android and finish setup there. App startup and pairing are not yet confirmed.";
  } catch (error) {
    androidStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    androidButton.disabled = false;
  }
});

function requestCrostini() {
  return chrome.runtime.sendMessage({ type: "crostiniBootstrap", op: "open" });
}

async function initializePresentation() {
  let presentation;
  try {
    const platform = await chrome.runtime.getPlatformInfo();
    presentation = presentationForPlatform(platform?.os);
  } catch {
    presentation = presentationForPlatform(undefined);
  }

  applyPresentation(presentation, {
    desktop: desktopSurface,
    chromeos: chromeosSurface,
  });
  if (presentation.desktop) {
    await checkDesktop();
    // Only an actual toolbar popup is fresh launch intent. This document can
    // also be opened/restored as a tab, which must not resurrect a quit app.
    if (!presentation.chromeos && !launchButton.disabled &&
        chrome.extension.getViews({ type: "popup" }).includes(window)) {
      launchButton.click();
    }
  }
}

function metricsRequest(op, extra = {}) {
  return chrome.runtime.sendMessage({ type: "productMetrics", op, ...extra });
}

function renderMetrics(state) {
  const disclosed = state.disclosureVersion === 1;
  // First-use disclosure stays visible; returning users can expand settings.
  if (!disclosed) privacyDetails.open = true;
  metricsDisclosure.hidden = disclosed;
  metricsSettings.hidden = !disclosed;
  metricsEnabled.checked = state.statisticsEnabled;
  const days = Math.max(0, Math.floor((Date.now() - Number(state.createdAtMillis)) / 86_400_000));
  metricsSummary.textContent =
    `${days} days since first use · ${state.sessions} visible sessions · ` +
    (state.everConnected ? "connected" : "not connected yet");
}

async function updateMetrics(op, extra = {}) {
  const response = await metricsRequest(op, extra);
  if (!response?.ok) throw new Error(response?.error || "Privacy settings could not be saved.");
  renderMetrics(response.state);
}

metricsContinue.addEventListener("click", async () => {
  metricsContinue.disabled = true;
  try {
    await updateMetrics("acknowledge", { enabled: metricsDisclosureEnabled.checked });
    metricsStatus.textContent = "Privacy preference saved.";
  } catch (error) {
    metricsStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    metricsContinue.disabled = false;
  }
});

metricsEnabled.addEventListener("change", async () => {
  metricsEnabled.disabled = true;
  try {
    await updateMetrics("setEnabled", { enabled: metricsEnabled.checked });
    metricsStatus.textContent = "Privacy preference saved.";
  } catch (error) {
    metricsStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    metricsEnabled.disabled = false;
  }
});

metricsReset.addEventListener("click", async () => {
  if (!confirm("Create a new identifier and clear extension usage statistics?")) return;
  try {
    await updateMetrics("reset");
    metricsStatus.textContent = "Statistics and identifier reset.";
  } catch (error) {
    metricsStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

privacyPolicy.addEventListener("click", () => chrome.tabs.create({ url: PRIVACY_URL }));

async function initialize() {
  await Promise.all([initializePresentation(), updateMetrics("session")]);
}

initialize().catch((error) => {
  metricsStatus.textContent = error instanceof Error ? error.message : String(error);
});

import { t, localizeDocument, errorText } from "../src/localization.js";
import { applyPresentation, presentationForPlatform } from "./platform.js";

localizeDocument(document);

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

function recordSupport(failure) {
  void metricsRequest("support", { failure }).catch(() => {});
}

document.querySelector("#feedback-preview").addEventListener("click", async () => {
  try {
    const response = await metricsRequest("feedback");
    if (!response?.ok || !response.state?.url) throw new Error();
    const context = document.querySelector("#feedback-context");
    context.textContent = response.state.url;
    context.hidden = false;
    const link = document.querySelector("#feedback-open");
    link.href = response.state.url;
    link.hidden = false;
  } catch {
    metricsStatus.textContent = t("popup_dynamic_001");
  }
});

function request(op) {
  return chrome.runtime.sendMessage({ type: "nativeBootstrap", op });
}

async function checkDesktop() {
  setStatus("checking", t("popup_dynamic_002"), t("popup_dynamic_003"));
  launchButton.disabled = true;
  try {
    const response = await request("hello");
    if (!response?.ok || response.result?.kind !== "hello") {
      throw new Error(response?.error?.message || t("popup_dynamic_004"));
    }
    setStatus(
      "ready",
      t("popup_dynamic_005"),
      t("popup_dynamic_006"),
    );
    void updateMetrics("connected");
    recordSupport("none");
    launchButton.disabled = false;
  } catch (error) {
    recordSupport("connection_failed");
    setStatus(
      "error",
      t("popup_dynamic_008"),
      error instanceof Error
        ? errorText(error.message)
        : t("popup_dynamic_009"),
    );
  }
}

launchButton.addEventListener("click", async () => {
  launchButton.disabled = true;
  setStatus("checking", t("popup_dynamic_010"), t("popup_dynamic_011"));
  try {
    const response = await chrome.runtime.sendMessage({ type: "desktopBootstrap", op: "open" });
    if (!response?.ok || response.result?.kind !== "desktop_ui") {
      throw new Error(response?.error?.message || t("popup_dynamic_012"));
    }
    setStatus(
      "ready",
      t("popup_dynamic_013"),
      t("popup_dynamic_014"),
    );
  } catch (error) {
    setStatus(
      "error",
      t("popup_dynamic_015"),
      error instanceof Error ? errorText(error.message) : t("popup_dynamic_016"),
    );
    launchButton.disabled = false;
  }
});

linuxButton.addEventListener("click", async () => {
  linuxButton.disabled = true;
  linuxStatus.textContent = t("popup_dynamic_017");
  try {
    const response = await requestCrostini();
    if (!response?.ok) {
      throw new Error(response?.error?.message || t("popup_dynamic_018"));
    }
    linuxStatus.textContent =
      t("popup_dynamic_019");
  } catch (error) {
    linuxStatus.textContent =
      error instanceof Error
        ? errorText(error.message)
        : t("popup_dynamic_020");
  } finally {
    linuxButton.disabled = false;
  }
});

linuxHelpButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("crostini/setup.html") });
});

androidButton.addEventListener("click", async () => {
  androidButton.disabled = true;
  androidStatus.textContent = t("popup_dynamic_021");
  try {
    const granted = await chrome.permissions.request({
      origins: [ANDROID_HOST_PERMISSION],
    });
    if (!granted) {
      recordSupport("permission_denied");
      androidStatus.textContent =
        t("popup_dynamic_022");
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: "androidBootstrap",
      op: "open",
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || t("popup_dynamic_023"));
    }
    androidStatus.textContent =
      t("popup_dynamic_024");
  } catch (error) {
    androidStatus.textContent = error instanceof Error ? errorText(error.message) : String(error);
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
  const numbers = new Intl.NumberFormat(globalThis.chrome?.i18n?.getUILanguage?.() || "en");
  metricsSummary.textContent = t("metrics_summary", {
    days: numbers.format(days), sessions: numbers.format(state.sessions),
    connection: state.everConnected ? t("metrics_connected") : t("metrics_not_connected"),
  });
}

async function updateMetrics(op, extra = {}) {
  const response = await metricsRequest(op, extra);
  if (!response?.ok) throw new Error(response?.error || t("popup_dynamic_025"));
  renderMetrics(response.state);
  document.querySelector("#feedback-context").hidden = true;
  document.querySelector("#feedback-open").hidden = true;
}

metricsContinue.addEventListener("click", async () => {
  metricsContinue.disabled = true;
  try {
    await updateMetrics("acknowledge", { enabled: metricsDisclosureEnabled.checked });
    metricsStatus.textContent = t("popup_dynamic_026");
  } catch (error) {
    metricsStatus.textContent = error instanceof Error ? errorText(error.message) : String(error);
  } finally {
    metricsContinue.disabled = false;
  }
});

metricsEnabled.addEventListener("change", async () => {
  metricsEnabled.disabled = true;
  try {
    await updateMetrics("setEnabled", { enabled: metricsEnabled.checked });
    metricsStatus.textContent = t("popup_dynamic_027");
  } catch (error) {
    metricsStatus.textContent = error instanceof Error ? errorText(error.message) : String(error);
  } finally {
    metricsEnabled.disabled = false;
  }
});

metricsReset.addEventListener("click", async () => {
  if (!confirm(t("popup_dynamic_028"))) return;
  try {
    await updateMetrics("reset");
    metricsStatus.textContent = t("popup_dynamic_029");
  } catch (error) {
    metricsStatus.textContent = error instanceof Error ? errorText(error.message) : String(error);
  }
});

privacyPolicy.addEventListener("click", () => chrome.tabs.create({ url: PRIVACY_URL }));

async function initialize() {
  await Promise.all([initializePresentation(), updateMetrics("session")]);
}

initialize().catch((error) => {
  metricsStatus.textContent = error instanceof Error ? errorText(error.message) : String(error);
});

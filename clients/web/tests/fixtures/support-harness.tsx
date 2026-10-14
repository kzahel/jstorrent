import { createRoot } from "react-dom/client";
import "../../src/inspection/global.css";
import { AboutUpdatesSettingsSection } from "../../src/inspection/components/AboutUpdatesSettingsSection";
import { ToastProvider } from "../../src/inspection/components/Toast";
import type { DesktopUpdaterSnapshot } from "../../src/inspection/updater/types";
import { DesktopUpdaterController } from "../../src/inspection/updater/controller";
import { ExternalUrlProvider, type OpenExternalUrl } from "../../src/inspection/external-links";

const desktop = new URLSearchParams(location.search).has("desktop");
const openedUrls: string[] = [];
let rejectOpen = new URLSearchParams(location.search).has("rejectOpen");
Object.assign(window, { openedUrls });
const openUrl: OpenExternalUrl | undefined = desktop ? async (url) => {
  openedUrls.push(url);
  if (rejectOpen) { rejectOpen = false; throw new Error("private native failure"); }
} : undefined;

document.documentElement.dataset.interfaceSize = "standard";
document.documentElement.dataset.colorTheme = new URLSearchParams(location.search).get("theme") ?? "light";
const manualUpdate = new URLSearchParams(location.search).has("manual");
const managedPackage = new URLSearchParams(location.search).get("package");
if (managedPackage !== null && !["msi", "deb", "rpm", "unknown"].includes(managedPackage)) {
  throw new Error("unsupported controlled package fixture");
}
let snapshot: DesktopUpdaterSnapshot = {
  info: { version: "0.1.3", buildId: "abcdef1234567890", target: manualUpdate ? "linux-gnu" : "aarch64-apple-darwin",
    arch: "aarch64", bundleType: manualUpdate ? "headless" : "app", checkPrivacy: manualUpdate ? "anonymous" : "preference-controlled" },
  state: manualUpdate ? { phase: "available", version: "0.1.4", reason: "startup",
    manualApply: {command: "$HOME/.local/bin/rstorrent-headless update --apply",
      releaseUrl: "https://github.com/kzahel/jstorrent/releases/tag/headless-v0.1.4"} } : { phase: "idle" },
};
const updater = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  check: async () => undefined,
  install: async () => undefined,
  dismiss: () => undefined,
  close: () => undefined,
};
const managedController = managedPackage === null ? undefined : new DesktopUpdaterController({
  check: async () => { throw new Error("managed fixture must never check a backend"); },
  relaunch: async () => { throw new Error("managed fixture must never replace its process"); },
}, {
  ...snapshot.info,
  target: managedPackage === "msi" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu",
  arch: "x86_64",
  bundleType: managedPackage as "msi" | "deb" | "rpm" | "unknown",
});
if (managedController) {
  snapshot = managedController.getSnapshot();
  window.addEventListener("pagehide", () => managedController.close(), { once: true });
}
createRoot(document.getElementById("support-harness")!).render(
  <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "1rem" }}>
    <h1>About &amp; updates</h1>
    <ToastProvider>
      <ExternalUrlProvider openUrl={openUrl}>
        <AboutUpdatesSettingsSection about={{ connection: manualUpdate ? "server" : "desktop" }} updater={managedController ?? updater} snapshot={snapshot} />
      </ExternalUrlProvider>
    </ToastProvider>
  </main>,
);

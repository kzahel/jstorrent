import { applyStoredAppearance } from "./inspection/appearance";
import { resolveInspectionBootstrapTarget } from "./inspection/bootstrap-target";
import { initializeLocalization, localizeDocumentShell, message } from "./localization/runtime";
import { markStartup, startupTimings } from "./startup-timing";

markStartup("entry");
localizeDocumentShell();

const parameters = new URLSearchParams(window.location.search);
const appearance = applyStoredAppearance();
document
  .querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  ?.setAttribute(
    "content",
    appearance.colorTheme === "auto"
      ? "light dark"
      : appearance.colorTheme,
  );

void startInspection().catch(renderBootstrapError);

async function startInspection(): Promise<void> {
  await initializeLocalization();
  const { startDemoInspection, startLiveInspection, startTauriInspection } =
    await import("./inspection/bootstrap");
  markStartup("app_loaded");
  const target = resolveInspectionBootstrapTarget(
    parameters,
    "__TAURI_INTERNALS__" in window,
    import.meta.env.VITE_RSTORRENT_DEFAULT_LIVE,
  );
  switch (target.type) {
    case "demo":
      await startDemoInspection(target.parameters);
      break;
    case "live":
      await startLiveInspection(target.parameters);
      break;
    case "tauri":
      await startTauriInspection();
      break;
  }
}

function renderBootstrapError(error: unknown): void {
  // Once the application has rendered, it reports connection problems itself.
  if (startupTimings().shell_rendered !== undefined) {
    console.error("JSTorrent startup failed after the application rendered", error);
    return;
  }
  const rootElement = document.querySelector<HTMLElement>("#app");
  if (rootElement === null) {
    console.error("Unable to start RSTorrent", error);
    return;
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  rootElement.replaceChildren();
  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  alert.textContent = `${message("shell.app.start-failed")}: ${errorMessage}`;
  rootElement.append(alert);
}

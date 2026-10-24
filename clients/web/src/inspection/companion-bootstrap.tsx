import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "../localization/runtime";

import type { ApplicationViewClient } from "../api/client";
import { App } from "./components/App";
import { InspectionProvider } from "./context";
import { InspectionController } from "./controller";
import { LiveApplication } from "./live/LiveApplication";
import type { AboutFacts } from "./support/about";
import "./global.css";

export async function startCompanionInspection(
  client: ApplicationViewClient,
  oneCurrentRoot = true,
  about?: AboutFacts,
): Promise<() => Promise<void>> {
  const application = await LiveApplication.open(client, {
    storagePolicy: oneCurrentRoot ? "one_current_root" : "portable",
  });
  application.installBrowserWakeHints(window, document);
  const controller = new InspectionController(application);
  controller.start();
  const rootElement = document.querySelector<HTMLElement>("#app");
  if (rootElement === null) throw new Error("missing application root");
  const root = createRoot(rootElement);
  root.render(
    <LocalizationProvider>
      <InspectionProvider controller={controller}>
        <App oneCurrentRoot={oneCurrentRoot} about={about} />
      </InspectionProvider>
    </LocalizationProvider>,
  );
  return async () => { root.unmount(); await controller.close(); };
}

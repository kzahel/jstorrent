import { createRoot, type Root } from "react-dom/client";
import { LocalizationProvider } from "../localization/runtime";

import { ExternalUrlProvider, type OpenExternalUrl } from "./external-links";
import { App } from "./components/App";
import { WebAuthGate } from "./components/WebAuthGate";
import { InspectionProvider } from "./context";
import { InspectionController } from "./controller";
import { DemoApplication } from "./demo/DemoApplication";
import { isDemoScenarioId } from "./demo/catalog";
import { LiveApplication } from "./live/LiveApplication";
import type { DemoScenarioId } from "./model";
import type { DesktopUpdater } from "./updater/types";
import type { DesktopExternalIntake } from "../desktop-external-intake";
import type { DesktopNotifications } from "./desktop-notifications/types";
import type { DesktopPower } from "./desktop-power/types";
import type { DesktopRemoteAccess } from "./remote-access/types";
import type { ProductPrivacyController } from "./product-privacy/types";
import type { ApplicationViewClient } from "../api/client";
import { RemoteOnlyApplicationClient } from "../remote-application-client";
import { HttpApplicationClient } from "../api/client";
import { TauriApplicationViewClient } from "../tauri-view-client";
import { WebSocketApplicationViewClient } from "../websocket-view-client";
import { WebAuthClient } from "../web-auth-client";
import {
  createHostedHostIntegration,
  type HostedAccessMode,
  type HostedProduct,
} from "../headless-updater";
import "./global.css";

export function startDemoInspection(parameters: URLSearchParams): void {
  const requested = parameters.get("demo");
  const scenarioId: DemoScenarioId = isDemoScenarioId(requested)
    ? requested
    : "healthy-download";
  const elapsedMs = parseElapsed(parameters.get("at"));
  const running = parameters.get("autoplay") !== "0";
  const application = new DemoApplication({ scenarioId, elapsedMs, running });
  const controller = new InspectionController(application);
  renderInspection(controller);
}

export async function startLiveInspection(
  parameters: URLSearchParams,
): Promise<void> {
  const baseUrl = new URL(window.location.origin);
  const token = parameters.get("token");
  const transport = parameters.get("transport");
  if (transport !== null && transport !== "http") {
    throw new Error("live transport must be omitted or set to http");
  }
  if (transport !== "http" && parameters.has("poll_ms")) {
    throw new Error("poll_ms requires the diagnostic transport=http mode");
  }
  const waitMillis =
    transport === "http"
      ? parsePollMillis(parameters.get("poll_ms"))
      : undefined;
  const webAuth = token === null ? new WebAuthClient(baseUrl.href) : undefined;
  const authStatus = await webAuth?.status();
  const root = createRoot(applicationRoot());
  if (
    webAuth !== undefined &&
    authStatus?.available === true &&
    authStatus.state !== "local_open" &&
    authStatus.state !== "session_valid"
  ) {
    root.render(
      <LocalizationProvider>
        <WebAuthGate
          client={webAuth}
          initialStatus={authStatus}
          onAuthorized={() =>
            openLiveInspection(
              root,
              baseUrl,
              token,
              transport,
              waitMillis,
              webAuth,
            )
          }
        />
      </LocalizationProvider>,
    );
    return;
  }
  await openLiveInspection(
    root,
    baseUrl,
    token,
    transport,
    waitMillis,
    webAuth,
  );
}

async function openLiveInspection(
  root: Root,
  baseUrl: URL,
  token: string | null,
  transport: string | null,
  waitMillis: number | undefined,
  webAuth: WebAuthClient | undefined,
): Promise<void> {
  const client =
    transport === "http"
      ? new HttpApplicationClient(baseUrl.href, token, window.location.origin)
      : new WebSocketApplicationViewClient(baseUrl.href, token);
  const [application, hosted] = await Promise.all([
    LiveApplication.open(client, {
      ...(waitMillis === undefined ? {} : { waitMillis }),
    }),
    createHostedHostIntegration(baseUrl).catch((error: unknown) => {
      console.error("Hosted product integration initialization failed:", error);
      return undefined;
    }),
  ]);
  application.installBrowserWakeHints(window, document);
  renderInspection(
    new InspectionController(application),
    root,
    webAuth,
    hosted?.updater,
    undefined,
    undefined,
    undefined,
    undefined,
    hosted?.accessMode,
    hosted?.product,
  );
}

export async function startTauriInspection(): Promise<void> {
  const { openTauriExternalUrl } = await import("../tauri-external-links");
  const [updater, notifications, power, remoteAccess, productPrivacy, application, externalIntake] =
    await Promise.all([
      import("../tauri-updater")
        .then(({ createTauriDesktopUpdater }) => createTauriDesktopUpdater())
        .catch((error: unknown) => {
          console.error("Desktop updater initialization failed:", error);
          return undefined;
        }),
      import("../tauri-desktop-notifications")
        .then(({ createTauriDesktopNotifications }) =>
          createTauriDesktopNotifications(),
        )
        .catch((error: unknown) => {
          console.error(
            "Desktop notification settings initialization failed:",
            error,
          );
          return undefined;
        }),
      import("../tauri-desktop-power")
        .then(({ createTauriDesktopPower }) => createTauriDesktopPower())
        .catch((error: unknown) => {
          console.error("Desktop power settings initialization failed:", error);
          return undefined;
        }),
      import("../tauri-remote-access")
        .then(({ createTauriDesktopRemoteAccess }) =>
          createTauriDesktopRemoteAccess(),
        )
        .catch((error: unknown) => {
          console.error("Desktop remote access initialization failed:", error);
          return undefined;
        }),
      import("../tauri-product-privacy")
        .then(({ createTauriProductPrivacy }) => createTauriProductPrivacy())
        .catch((error: unknown) => {
          console.error("Desktop product privacy initialization failed:", error);
          return undefined;
        }),
      LiveApplication.open(new TauriApplicationViewClient()),
      import("../desktop-external-intake").then(
        ({ TauriDesktopExternalIntake }) => TauriDesktopExternalIntake.open(),
      ),
    ]);
  application.installBrowserWakeHints(window, document);
  renderInspection(
    new InspectionController(application),
    undefined,
    undefined,
    updater,
    externalIntake,
    notifications,
    power,
    remoteAccess,
    undefined,
    undefined,
    productPrivacy,
    openTauriExternalUrl,
  );
}

export async function startRemoteInspection(
  client: ApplicationViewClient,
  root: Root,
  remoteAccess: DesktopRemoteAccess,
): Promise<void> {
  const application = await LiveApplication.open(
    new RemoteOnlyApplicationClient(client),
  );
  application.installBrowserWakeHints(window, document);
  renderInspection(
    new InspectionController(application),
    root,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    remoteAccess,
  );
}

function renderInspection(
  controller: InspectionController,
  root: Root = createRoot(applicationRoot()),
  webAuth?: WebAuthClient,
  updater?: DesktopUpdater,
  externalIntake?: DesktopExternalIntake,
  notifications?: DesktopNotifications,
  power?: DesktopPower,
  remoteAccess?: DesktopRemoteAccess,
  accessMode?: HostedAccessMode,
  hostedProduct?: HostedProduct,
  productPrivacy?: ProductPrivacyController,
  openExternalUrl?: OpenExternalUrl,
): void {
  controller.start();
  root.render(
    <LocalizationProvider>
      <ExternalUrlProvider openUrl={openExternalUrl}>
        <InspectionProvider controller={controller}>
          <App
            webAuth={webAuth}
            updater={updater}
            externalIntake={externalIntake}
            notifications={notifications}
            power={power}
            remoteAccess={remoteAccess}
            accessMode={accessMode}
            hostedProduct={hostedProduct}
            productPrivacy={productPrivacy}
          />
        </InspectionProvider>
      </ExternalUrlProvider>
    </LocalizationProvider>,
  );
}

function applicationRoot(): HTMLElement {
  const rootElement = document.querySelector<HTMLElement>("#app");
  if (rootElement === null) throw new Error("missing application root");
  return rootElement;
}

function parseElapsed(value: string | null): number {
  if (value === null || value.trim() === "") return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(86_400_000, Math.trunc(numeric)));
}

function parsePollMillis(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(50, Math.min(20_000, Math.trunc(numeric)));
}

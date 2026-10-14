import { createRoot, type Root } from "react-dom/client";
import { LocalizationProvider } from "../localization/runtime";

import { ExternalUrlProvider, type OpenExternalUrl } from "./external-links";
import { App, type AppProps } from "./components/App";
import { WebAuthGate } from "./components/WebAuthGate";
import { InspectionProvider } from "./context";
import { InspectionController } from "./controller";
import { LiveApplication } from "./live/LiveApplication";
import type { DemoScenarioId } from "./model";
import type { DesktopRemoteAccess } from "./remote-access/types";
import type { ApplicationViewClient } from "../api/client";
import { WebAuthClient } from "../web-auth-client";
import { createHostedHostIntegration } from "../headless-updater";
import { markStartup } from "../startup-timing";
import "./global.css";

// Demo scenarios load only for demo mode, not with every live shell.
export async function startDemoInspection(
  parameters: URLSearchParams,
): Promise<void> {
  const [{ DemoApplication }, { isDemoScenarioId }] = await Promise.all([
    import("./demo/DemoApplication"),
    import("./demo/catalog"),
  ]);
  const requested = parameters.get("demo");
  const scenarioId: DemoScenarioId = isDemoScenarioId(requested)
    ? requested
    : "healthy-download";
  const elapsedMs = parseElapsed(parameters.get("at"));
  const running = parameters.get("autoplay") !== "0";
  const application = new DemoApplication({ scenarioId, elapsedMs, running });
  const controller = new InspectionController(application);
  renderInspection(controller, createRoot(applicationRoot()), {});
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
  markStartup("auth_checked");
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
  const application = LiveApplication.connect(
    {
      load: () =>
        transport === "http"
          ? import("../api/client").then(
              ({ HttpApplicationClient }) =>
                new HttpApplicationClient(
                  baseUrl.href,
                  token,
                  window.location.origin,
                ),
            )
          : import("../websocket-view-client").then(
              ({ WebSocketApplicationViewClient }) =>
                new WebSocketApplicationViewClient(baseUrl.href, token),
            ),
      torrentListBundles: true,
    },
    { ...(waitMillis === undefined ? {} : { waitMillis }) },
  );
  application.installBrowserWakeHints(window, document);
  const update = renderInspection(new InspectionController(application), root, {
    webAuth,
    about: { connection: "server" },
  });
  const hosted = await createHostedHostIntegration(baseUrl).catch(
    (error: unknown) => {
      console.error("Hosted product integration initialization failed:", error);
      return undefined;
    },
  );
  if (hosted === undefined) return;
  update({
    webAuth,
    updater: hosted.updater,
    accessMode: hosted.accessMode,
    hostedProduct: hosted.product,
    about: {
      connection: "server",
      ...(hosted.buildId === undefined ? {} : { hostBuild: hosted.buildId }),
    },
  });
}

// Renders before any desktop adapter exists; each adapter tolerates absence
// and arrives in one later render. Nothing here rejects after that render.
export async function startTauriInspection(): Promise<void> {
  const application = LiveApplication.connect({
    load: () =>
      import("../tauri-view-client").then(
        ({ TauriApplicationViewClient }) => new TauriApplicationViewClient(),
      ),
    torrentListBundles: true,
  });
  application.installBrowserWakeHints(window, document);
  const update = renderInspection(
    new InspectionController(application),
    createRoot(applicationRoot()),
    { about: { connection: "desktop" } },
  );
  const [
    openExternalUrl,
    updater,
    notifications,
    power,
    remoteAccess,
    productPrivacy,
    externalIntake,
    identifier,
  ] = await Promise.all([
    adapter("external links", () =>
      import("../tauri-external-links").then(
        ({ openTauriExternalUrl }) => openTauriExternalUrl,
      ),
    ),
    adapter("updater", () =>
      import("../tauri-updater").then(({ createTauriDesktopUpdater }) =>
        createTauriDesktopUpdater(),
      ),
    ),
    adapter("notification settings", () =>
      import("../tauri-desktop-notifications").then(
        ({ createTauriDesktopNotifications }) => createTauriDesktopNotifications(),
      ),
    ),
    adapter("power settings", () =>
      import("../tauri-desktop-power").then(({ createTauriDesktopPower }) =>
        createTauriDesktopPower(),
      ),
    ),
    adapter("remote access", () =>
      import("../tauri-remote-access").then(
        ({ createTauriDesktopRemoteAccess }) => createTauriDesktopRemoteAccess(),
      ),
    ),
    adapter("product privacy", () =>
      import("../tauri-product-privacy").then(({ createTauriProductPrivacy }) =>
        createTauriProductPrivacy(),
      ),
    ),
    adapter("external torrent intake", () =>
      import("../desktop-external-intake").then(({ TauriDesktopExternalIntake }) =>
        TauriDesktopExternalIntake.open(),
      ),
    ),
    adapter("identifier lookup", () =>
      import("@tauri-apps/api/app").then(({ getIdentifier }) => getIdentifier()),
    ),
  ]);
  markStartup("adapters_ready");
  update({
    updater,
    externalIntake,
    notifications,
    power,
    remoteAccess,
    productPrivacy,
    openExternalUrl,
    about: {
      connection: "desktop",
      ...(identifier === undefined ? {} : { identifier }),
    },
  });
}

function adapter<T>(
  name: string,
  create: () => Promise<T>,
): Promise<T | undefined> {
  return create().catch((error: unknown) => {
    console.error(`Desktop ${name} initialization failed:`, error);
    return undefined;
  });
}

// The remote gate relies on a failed first attach to return to sign-in, so
// this entry still attaches before rendering.
export async function startRemoteInspection(
  client: ApplicationViewClient,
  root: Root,
  remoteAccess: DesktopRemoteAccess,
  pageBuild?: string,
): Promise<void> {
  const { RemoteOnlyApplicationClient } = await import(
    "../remote-application-client"
  );
  const application = await LiveApplication.open(
    new RemoteOnlyApplicationClient(client),
  );
  application.installBrowserWakeHints(window, document);
  renderInspection(new InspectionController(application), root, {
    remoteAccess,
    about: {
      connection: "remote",
      ...(pageBuild === undefined ? {} : { pageBuild }),
    },
  });
}

interface InspectionHost extends AppProps {
  readonly openExternalUrl?: OpenExternalUrl | undefined;
}

/** Renders the application and returns a re-render for later host facts. */
function renderInspection(
  controller: InspectionController,
  root: Root,
  host: InspectionHost,
): (host: InspectionHost) => void {
  controller.start();
  const render = ({ openExternalUrl, ...props }: InspectionHost) =>
    root.render(
      <LocalizationProvider>
        <ExternalUrlProvider openUrl={openExternalUrl}>
          <InspectionProvider controller={controller}>
            <App {...props} />
          </InspectionProvider>
        </ExternalUrlProvider>
      </LocalizationProvider>,
    );
  render(host);
  return render;
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

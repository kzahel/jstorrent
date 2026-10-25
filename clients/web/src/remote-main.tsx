import { applyStoredAppearance } from "./inspection/appearance";
import { createRoot } from "react-dom/client";

import { startRemoteInspection } from "./inspection/bootstrap";
import type { RemoteCryptoWasmModule } from "./remote-application-websocket";
import { IndexedDbRemoteClientStore } from "./remote-client-store";
import { RemoteAccessGate } from "./remote/RemoteAccessGate";
import {
  LocalizationProvider,
  initializeLocalization,
  localizeDocumentShell,
  message,
} from "./localization/runtime";

localizeDocumentShell();
applyStoredAppearance();

const relayUrl = import.meta.env.VITE_RSTORRENT_REMOTE_RELAY_URL;
const clientBuild = import.meta.env.VITE_RSTORRENT_REMOTE_BUILD_ID;
const rootElement = document.querySelector<HTMLElement>("#app");
if (rootElement === null) throw new Error("missing application root");
if (typeof relayUrl !== "string" || !relayUrl.startsWith("wss://")) {
  throw new Error("remote client build has no secure relay URL");
}
if (
  typeof clientBuild !== "string" ||
  clientBuild.length < 1 ||
  clientBuild.length > 160
) {
  throw new Error("remote client build has no valid build ID");
}

const root = createRoot(rootElement);
void initializeLocalization().then(loadCrypto)
  .then((crypto) => {
    root.render(
      <LocalizationProvider>
        <RemoteAccessGate
          relayUrl={relayUrl}
          clientBuild={clientBuild}
          crypto={crypto}
          store={new IndexedDbRemoteClientStore()}
          onConnected={(client, remoteAccess) =>
            startRemoteInspection(client, root, remoteAccess, clientBuild)
          }
        />
      </LocalizationProvider>,
    );
  })
  .catch((error: unknown) => {
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.textContent = `${message("shell.remote.start-failed")}: ${errorMessage(error)}`;
    rootElement.replaceChildren(alert);
  });

async function loadCrypto(): Promise<RemoteCryptoWasmModule> {
  const module = await import("rstorrent-remote-wasm-client");
  await module.default();
  return module as unknown as RemoteCryptoWasmModule;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

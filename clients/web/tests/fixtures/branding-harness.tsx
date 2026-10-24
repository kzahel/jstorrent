// Presentation-only fixture: no network, authentication or engine operations.
import { AddTorrentDialog } from "../../src/inspection/components/AddTorrentDialog";
import { createRoot } from "react-dom/client";
import "../../src/inspection/global.css";
import { LocalizationProvider } from "../../src/localization/runtime";
import { RemoteAccessGate } from "../../src/remote/RemoteAccessGate";
import type { RemoteClientStore } from "../../src/remote-client-store";
import type { RemoteCryptoWasmModule } from "../../src/remote-application-websocket";
import { WebAuthGate } from "../../src/inspection/components/WebAuthGate";
import type { WebAuthClient, WebAuthStatus } from "../../src/web-auth-client";
const query = new URLSearchParams(location.search);
document.documentElement.dataset.colorTheme = query.get("theme") ?? "light";
const store = { load: async () => undefined } as unknown as RemoteClientStore;
createRoot(document.getElementById("app")!).render(
  <LocalizationProvider>
    {query.get("surface") === "add" ? <AddTorrentDialog roots={[]} defaultRoot={null}
      returnFocus={{current:null}} showCrostiniStorageHelp={false} fileSelectionEnabled={true}
      onChooseFolder={async()=>null} onCancel={()=>undefined} onConfirm={async()=>undefined} /> : query.get("surface") === "remote" ? <RemoteAccessGate
      relayUrl="wss://127.0.0.1:7443" clientBuild="audit"
      crypto={{} as RemoteCryptoWasmModule} store={store}
      onConnected={async () => undefined} /> : <WebAuthGate
      client={{} as WebAuthClient}
      initialStatus={{ available: true, state: (query.get("state") ?? "initial_window_open") as WebAuthStatus["state"], remaining_seconds: 600 }}
      onAuthorized={async () => undefined} />}
  </LocalizationProvider>,
);

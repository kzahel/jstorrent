import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  applyDesktopLocaleSnapshot,
  bindDesktopLanguageAuthority,
  type DesktopLocaleSnapshot,
} from "./localization/runtime";

let initialization: Promise<void> | undefined;

/** Native presentation preferences own both the tray and this webview. */
export function initializeTauriLocalization(): Promise<void> {
  initialization ??= (async () => {
    let latestEvent: DesktopLocaleSnapshot | undefined;
    let eventGeneration = 0;
    const unlisten = await listen<DesktopLocaleSnapshot>("desktop://locale-changed", (event) => {
      latestEvent = event.payload;
      eventGeneration += 1;
      void applyDesktopLocaleSnapshot(event.payload).catch((error: unknown) => {
        console.error("Desktop locale update failed", error);
      });
    });
    try {
      const snapshot = await invoke<DesktopLocaleSnapshot>("load_desktop_locale");
      await bindDesktopLanguageAuthority({
        save: async (preference) => {
          const before = eventGeneration;
          const result = await invoke<DesktopLocaleSnapshot>("set_desktop_locale", { preference });
          // A system/other-window change may arrive before this command reply.
          // The newest native event remains authoritative in that case.
          return eventGeneration !== before ? latestEvent ?? result : result;
        },
      }, latestEvent ?? snapshot);
    } catch (error) {
      unlisten();
      throw error;
    }
  })().catch((error: unknown) => { initialization = undefined; throw error; });
  return initialization;
}

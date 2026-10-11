import { openUrl } from "@tauri-apps/plugin-opener";
import type { OpenExternalUrl } from "./inspection/external-links";

export const openTauriExternalUrl: OpenExternalUrl = (url) => openUrl(url);

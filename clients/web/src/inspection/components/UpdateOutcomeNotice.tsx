import { useEffect, useRef } from "react";
import { message } from "../../localization/runtime";
import type { DesktopUpdaterSnapshot } from "../updater/types";
import { useToast } from "./Toast";

const SEEN_KEY = "rstorrent.notice.updated-version.v1";
const AUTOMATIC_SEEN_KEY = "rstorrent.notice.automatic-updates.v1";

/** Local UI preferences; these never control installation or durable outcomes. */
export function UpdateOutcomeNotice({ snapshot }: { readonly snapshot: DesktopUpdaterSnapshot | undefined }) {
  const toast = useToast();
  const seen = useRef<string | null>(null);
  const introductionSeen = useRef<string | null>(null);
  const outcome = snapshot?.lastOutcome;
  const version = snapshot?.info.version;
  const target = snapshot?.info.target;
  const automatic = snapshot?.automaticAvailable === true && snapshot.automaticUpdates === true;
  const installed = outcome?.succeeded === true && outcome.version === version;
  useEffect(() => {
    if (!installed && !automatic) return;
    const token = `${target}:${version}`;
    const introductionToken = target ?? "desktop";
    const show = () => {
      if (!document.hasFocus()) return;
      let introduction = automatic && introductionSeen.current !== introductionToken;
      let updated = installed && seen.current !== token;
      try {
        introduction &&= localStorage.getItem(AUTOMATIC_SEEN_KEY) !== introductionToken;
        updated &&= localStorage.getItem(SEEN_KEY) !== token;
      } catch { /* Per-tab fallback below. */ }
      if (!introduction && !updated) return;
      if (introduction) introductionSeen.current = introductionToken;
      if (updated) seen.current = token;
      try {
        if (introduction) localStorage.setItem(AUTOMATIC_SEEN_KEY, introductionToken);
        if (updated) localStorage.setItem(SEEN_KEY, token);
      } catch { /* Storage can be unavailable. */ }
      toast.show({
        key: "desktop-update-outcome",
        message: introduction
          ? updated
            ? message("updates.automatic-introduction-updated", { version })
            : message("updates.automatic-introduction")
          : message("updates.updated-version", { version }),
        ...(introduction ? { action: { label: message("inspection.components.app.got.it"), onAction: () => {} } } : {}),
      });
    };
    show();
    window.addEventListener("focus", show);
    window.addEventListener("pointerdown", show);
    window.addEventListener("keydown", show);
    return () => {
      window.removeEventListener("focus", show);
      window.removeEventListener("pointerdown", show);
      window.removeEventListener("keydown", show);
    };
  }, [installed, automatic, version, target, toast]);
  return null;
}

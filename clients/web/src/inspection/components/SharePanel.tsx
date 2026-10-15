import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { encode } from "uqr";

import { copyText } from "../clipboard";
import { useInspectionController, useInspectionStore } from "../context";
import { hostSupports, MAGNET_EXPORT_OPTIONS } from "../host-capabilities";
import type { TorrentRow } from "../model";
import {
  exportShareLink,
  peerHintStatus,
  sharedLinksMessage,
  type ShareExport,
} from "../share-export";
import {
  loadPeerHintPreference, loadShortLinkPreference, saveShortLinkPreference,
} from "../share-preferences";
import { createShortLink, type ShortLink } from "../share-short-link";
import { Icon } from "./Icon";
import { trapTab } from "./PeerHintDialog";
import { useToast } from "./Toast";
import styles from "./ShareDialogs.module.css";

// Companion pages intentionally permit only their local host connections.
const supportsShortLinks = import.meta.env.MODE !== "companion";

type ShareState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly result: ShareExport;
      readonly peerHint: boolean;
    }
  | { readonly status: "failed"; readonly error: string };

/**
 * The General tab's Share panel (Tactical 357): the link, Copy, the system
 * share sheet where the browser has one, and a QR code. Toggling the
 * address re-exports the link and leaves the remembered choice alone.
 */
export function SharePanel({
  torrent,
  returnFocus,
  onClose,
}: {
  readonly torrent: TorrentRow;
  readonly returnFocus: () => void;
  readonly onClose: () => void;
}) {
  const controller = useInspectionController();
  const toast = useToast();
  // An older host cannot add the address to the link.
  const richShareLinks = useInspectionStore((state) =>
    hostSupports(state.session, MAGNET_EXPORT_OPTIONS),
  );
  const showAddressOption = torrent.privateTorrent !== true && richShareLinks;
  const [includeAddress, setIncludeAddress] = useState(
    () => loadPeerHintPreference() === "include",
  );
  const [useShortLink, setUseShortLink] = useState(() => supportsShortLinks && loadShortLinkPreference());
  const [shortState, setShortState] = useState<{
    source: string;
    result?: ShortLink;
    failed?: boolean;
  } | null>(null);
  const uploads = useRef(new Map<string, Promise<ShortLink>>());
  const requests = useRef(new Set<AbortController>());
  const mounted = useRef(false);
  const [state, setState] = useState<ShareState>({ status: "loading" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canShare = typeof navigator.share === "function";
  const peerHint = showAddressOption && includeAddress;

  useEffect(() => {
    closeRef.current?.focus();
    return returnFocus;
  }, [returnFocus]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    exportShareLink((command) => controller.execute(command), {
      torrentId: torrent.id,
      peerHint,
    }).then(
      (result) => {
        if (active) setState({ status: "ready", result, peerHint });
      },
      (error: unknown) => {
        if (active) setState({ status: "failed", error: errorText(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [controller, peerHint, torrent.id]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode reattaches immediately; only abort on an actual unmount.
      queueMicrotask(() => {
        if (!mounted.current) {
          for (const request of requests.current) request.abort();
          requests.current.clear();
          uploads.current.clear();
        }
      });
    };
  }, []);

  const fullLink = state.status === "ready" ? state.result.link : "";
  useEffect(() => {
    if (!supportsShortLinks || !useShortLink || fullLink === "") return;
    let active = true;
    setShortState({ source: fullLink });
    let upload = uploads.current.get(fullLink);
    if (upload === undefined) {
      // Bound panel-lifetime state even if a live host changes its exports.
      if (uploads.current.size >= 16) {
        setShortState({ source: fullLink, failed: true });
        return;
      }
      const controller = new AbortController();
      requests.current.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15_000);
      upload = createShortLink(fullLink, controller.signal).finally(() => {
        clearTimeout(timeout);
        requests.current.delete(controller);
      });
      uploads.current.set(fullLink, upload);
    }
    upload.then(
      (result) => { if (active) setShortState({ source: fullLink, result }); },
      () => { if (active) setShortState({ source: fullLink, failed: true }); },
    );
    return () => { active = false; };
  }, [fullLink, useShortLink]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    trapTab(event, dialogRef.current);
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const ready = state.status === "ready" ? state : null;
  const shortened = useShortLink && shortState?.source === fullLink ? shortState : null;
  const shortening = useShortLink && fullLink !== "" &&
    (shortened === null || (shortened.result === undefined && !shortened.failed));
  const link = shortened?.result?.link ?? fullLink;
  const status = ready === null ? null : peerHintStatus(ready.result);

  const copy = () => {
    if (ready === null || shortening) return;
    copyText(link).then(
      () =>
        toast.show({
          message: sharedLinksMessage([torrent], [ready.result], ready.peerHint),
        }),
      (error: unknown) =>
        toast.show({
          tone: "error",
          message: localizedMessage("feedback.share.link.copy.failed", {
            error: errorText(error),
          }),
        }),
    );
  };

  const share = () => {
    if (ready === null || shortening || !canShare) return;
    // Called inside the click with the link already in hand, so the
    // browser keeps the user activation the share sheet needs.
    navigator.share({ title: torrent.name, url: link }).catch(
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.show({
          tone: "error",
          message: localizedMessage("share.panel.share.failed", {
            error: errorText(error),
          }),
        });
      },
    );
  };

  return (
    <div className={styles.backdrop} onMouseDown={closeFromBackdrop}>
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${styles.panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-panel-title"
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 id="share-panel-title">{localizedMessage("share.panel.title")}</h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label={localizedMessage("share.panel.close")}
            title={localizedMessage("share.panel.close")}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className={styles.name} title={torrent.name}>
          {torrent.name}
        </p>
        <label className={styles.field}>
          {localizedMessage("share.panel.link.label")}
          <input
            className={styles.link}
            type="text"
            readOnly
            disabled={ready === null || shortening}
            value={ready === null || shortening ? localizedMessage("share.panel.loading") : link}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <div className={styles.linkActions}>
          <button
            type="button"
            className={styles.primary}
            disabled={ready === null || shortening}
            onClick={copy}
          >
            {localizedMessage("share.panel.copy")}
          </button>
          {canShare ? (
            <button type="button" disabled={ready === null || shortening} onClick={share}>
              {localizedMessage("share.panel.share")}
            </button>
          ) : null}
        </div>
        <div className={styles.qrFrame}>
          {ready === null || shortening ? null : <ShareQrCode value={link} />}
        </div>
        {supportsShortLinks ? <div className={styles.addressOption}>
          <input
            id="share-panel-short"
            type="checkbox"
            checked={useShortLink}
            aria-describedby="share-panel-short-help"
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              saveShortLinkPreference(enabled);
              setUseShortLink(enabled);
            }}
          />
          <label htmlFor="share-panel-short">{localizedMessage("share.panel.short.label")}</label>
          <span id="share-panel-short-help">{localizedMessage("share.panel.short.description")}</span>
        </div> : null}
        {shortened?.result ? (
          <p className={styles.status}>
            {localizedMessage("share.panel.short.expires", { date: new Date(shortened.result.expiresAt) })}
          </p>
        ) : null}
        {shortened?.failed ? (
          <p className={styles.error} role="alert">{localizedMessage("share.panel.short.failed")}</p>
        ) : null}
        {showAddressOption ? (
          <div className={styles.addressOption}>
            <input
              id="share-panel-address"
              type="checkbox"
              checked={includeAddress}
              aria-describedby="share-panel-address-help"
              onChange={(event) => setIncludeAddress(event.currentTarget.checked)}
            />
            <label htmlFor="share-panel-address">
              {localizedMessage("share.panel.include.address")}
            </label>
            <span id="share-panel-address-help">
              {localizedMessage("share.panel.include.address.description")}
            </span>
          </div>
        ) : (
          <p>{localizedMessage("inspection.components.detail.pane.private.hint")}</p>
        )}
        <p className={styles.status} role="status">
          {status ?? ""}
        </p>
        {state.status === "failed" ? (
          <p className={styles.error} role="alert">
            {localizedMessage("share.panel.failed", { error: state.error })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The link as a QR code: one `<rect>` per run of dark modules. */
export function ShareQrCode({ value }: { readonly value: string }) {
  const code = useMemo(() => {
    try {
      return encode(value, { ecc: "L", boostEcc: true, border: 0 });
    } catch {
      return null;
    }
  }, [value]);
  if (code === null) {
    return <p>{localizedMessage("share.panel.qr.too.long")}</p>;
  }
  const quiet = 4;
  const size = code.size + quiet * 2;
  const runs: { x: number; y: number; width: number }[] = [];
  code.data.forEach((row, y) => {
    let start = -1;
    row.forEach((dark, x) => {
      if (dark && start < 0) start = x;
      if ((!dark || x === row.length - 1) && start >= 0) {
        runs.push({ x: start, y, width: (dark ? x + 1 : x) - start });
        start = -1;
      }
    });
  });
  return (
    <svg
      className={styles.qr}
      role="img"
      aria-label={localizedMessage("share.panel.qr.label")}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect className={styles.qrBackground} width={size} height={size} />
      {runs.map((run) => (
        <rect
          key={`${run.x}:${run.y}`}
          x={run.x + quiet}
          y={run.y + quiet}
          width={run.width}
          height={1}
        />
      ))}
    </svg>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

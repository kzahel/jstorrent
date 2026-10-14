import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import styles from "./ShareDialogs.module.css";

/**
 * Asks whether a share link carries this device's address (Tactical 357).
 * The chosen button's click is the copy's user activation, so `onChoose`
 * must start the clipboard write synchronously.
 */
export function PeerHintDialog({
  returnFocus,
  onChoose,
  onCancel,
}: {
  readonly returnFocus: () => void;
  readonly onChoose: (include: boolean, remember: boolean) => void;
  readonly onCancel: () => void;
}) {
  const [remember, setRemember] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const omitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    omitRef.current?.focus();
    return returnFocus;
  }, [returnFocus]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    trapTab(event, dialogRef.current);
  };

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="peer-hint-title"
        aria-describedby="peer-hint-description"
        onKeyDown={handleKeyDown}
      >
        <h2 id="peer-hint-title">{localizedMessage("share.peer.hint.dialog.title")}</h2>
        <p id="peer-hint-description">{localizedMessage("share.peer.hint.dialog.body")}</p>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          {localizedMessage("share.peer.hint.dialog.remember")}
        </label>
        <div className={styles.actions}>
          <button
            ref={omitRef}
            type="button"
            onClick={() => onChoose(false, remember)}
          >
            {localizedMessage("share.peer.hint.dialog.omit")}
          </button>
          <button
            className={styles.primary}
            type="button"
            onClick={() => onChoose(true, remember)}
          >
            {localizedMessage("share.peer.hint.dialog.include")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Keeps Tab inside a modal dialog. */
export function trapTab(
  event: ReactKeyboardEvent<HTMLElement>,
  dialog: HTMLElement | null,
): void {
  if (event.key !== "Tab" || dialog === null) return;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

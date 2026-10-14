import { formatNumber, message as localizedMessage } from "../../localization/runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icon } from "./Icon";
import styles from "./Toast.module.css";

/** Android's short and long snackbar durations (Tactical 346). */
export const TOAST_SHORT_MS = 4_000;
export const TOAST_LONG_MS = 10_000;

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastOptions {
  readonly message: string;
  /** Errors stay until dismissed or replaced. */
  readonly tone?: "info" | "error";
  readonly action?: ToastAction;
  /** 0–100. A toast with progress stays until replaced or dismissed. */
  readonly progress?: number;
  /** Showing a toast with the current key updates it in place. */
  readonly key?: string;
}

interface ShownToast extends ToastOptions {
  readonly id: number;
}

interface ToastApi {
  readonly show: (toast: ToastOptions) => void;
  /** Dismisses the current toast, or only the one with this key. */
  readonly dismiss: (key?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * One toast slot, bottom-centre, like the Android snackbar host: a new toast
 * replaces the current one instead of queueing behind it.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const [paused, setPaused] = useState(false);
  const nextId = useRef(1);

  const show = useCallback((options: ToastOptions) => {
    setToast((current) => ({
      ...options,
      id:
        current !== null && options.key !== undefined && current.key === options.key
          ? current.id
          : nextId.current++,
    }));
  }, []);

  const dismiss = useCallback((key?: string) => {
    setToast((current) =>
      current === null || (key !== undefined && current.key !== key) ? current : null,
    );
  }, []);

  const duration =
    toast === null || toast.tone === "error" || toast.progress !== undefined
      ? null
      : toast.action === undefined
        ? TOAST_SHORT_MS
        : TOAST_LONG_MS;

  useEffect(() => {
    if (toast === null || duration === null || paused) return;
    const id = toast.id;
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, paused, toast]);

  useEffect(() => setPaused(false), [toast?.id]);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [dismiss, show]);
  const error = toast?.tone === "error";

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Mounted before any toast so the first confirmation is announced. */}
      <div className={styles.announcer} role="status" aria-live="polite">
        {toast === null || error ? "" : toast.message}
      </div>
      {toast === null ? null : (
        <section
          key={toast.id}
          className={styles.toast}
          data-tone={toast.tone ?? "info"}
          aria-label={localizedMessage("toast.region")}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setToast(null);
            }
          }}
        >
          <div className={styles.body}>
            <p
              className={styles.message}
              role={error ? "alert" : undefined}
              title={toast.message}
            >
              {toast.message}
            </p>
            {toast.progress === undefined ? null : (
              <div className={styles.progressRow}>
                <progress
                  className={styles.progress}
                  aria-label={toast.message}
                  max={100}
                  value={toast.progress}
                />
                <span aria-hidden="true">
                  {formatNumber(toast.progress / 100, {
                    style: "percent",
                    maximumFractionDigits: 1,
                  })}
                </span>
              </div>
            )}
          </div>
          {toast.action === undefined ? null : (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                const action = toast.action;
                setToast(null);
                action?.onAction();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className={styles.dismiss}
            aria-label={localizedMessage("toast.dismiss")}
            title={localizedMessage("toast.dismiss")}
            onClick={() => setToast(null)}
          >
            <Icon name="close" />
          </button>
        </section>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (value === null) throw new Error("ToastProvider is missing");
  return value;
}

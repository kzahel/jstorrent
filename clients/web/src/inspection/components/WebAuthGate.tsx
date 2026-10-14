import jstorrentIcon from "../../assets/jstorrent.png";
import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useState, type FormEvent } from "react";

import type {
  WebAuthClient,
  WebAuthStatus,
} from "../../web-auth-client";
import styles from "./WebAuthGate.module.css";

export interface WebAuthGateProps {
  readonly client: WebAuthClient;
  readonly initialStatus: WebAuthStatus;
  readonly onAuthorized: () => Promise<void>;
}

export function WebAuthGate({
  client,
  initialStatus,
  onAuthorized,
}: WebAuthGateProps) {
  const [status, setStatus] = useState(initialStatus);
  const [remaining, setRemaining] = useState(
    initialStatus.remaining_seconds ?? 0,
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRemaining(status.remaining_seconds ?? 0);
    if (status.remaining_seconds === undefined) return;
    const interval = window.setInterval(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearInterval(interval);
  }, [status]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await onAuthorized();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      try {
        setStatus(await client.status());
      } catch {
        // Retain the actionable operation error.
      }
    } finally {
      setBusy(false);
    }
  };

  const redeem = (event: FormEvent) => {
    event.preventDefault();
    if (!/^[0-9]{4}$/.test(code)) {
      setError(localizedMessage("inspection.components.web.auth.gate.enter.the.four.digit.code.shown.by"));
      return;
    }
    void perform(() => client.redeem(code, browserLabel()));
  };

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="web-auth-title">
        <img className={styles.brand} src={jstorrentIcon} width="40" height="40" alt="" />
        {status.state === "initial_window_open" ? (
          <>
            <p className={styles.eyebrow}>{localizedMessage("inspection.components.web.auth.gate.first.launch")}</p>
            <h1 id="web-auth-title">{localizedMessage("inspection.components.web.auth.gate.choose.web.access")}</h1>
            <p>{localizedMessage("inspection.components.web.auth.gate.initial.setup.is.open.on.this.computer")}{" "}{formatRemaining(remaining)}{localizedMessage("inspection.components.web.auth.gate.choose.how.future.browser.profiles.should.connect")}</p>
            <div className={styles.choices}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void perform(() => client.setPolicy("local_open"))}
              >
                <strong>{localizedMessage("inspection.components.web.auth.gate.keep.localhost.open")}</strong>
                <span>{localizedMessage("inspection.components.web.auth.gate.any.browser.on.this.computer.can.open")}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void perform(() => client.setPolicy("paired", browserLabel()))
                }
              >
                <strong>{localizedMessage("inspection.components.web.auth.gate.remember.this.browser")}</strong>
                <span>{localizedMessage("inspection.components.web.auth.gate.new.browser.profiles.will.need.your.approval")}</span>
              </button>
            </div>
          </>
        ) : status.state === "initial_window_expired" ? (
          <>
            <p className={styles.eyebrow}>{localizedMessage("inspection.components.web.auth.gate.setup.closed")}</p>
            <h1 id="web-auth-title">{localizedMessage("inspection.components.web.auth.gate.restart.to.finish.setup")}</h1>
            <p>{localizedMessage("inspection.components.web.auth.gate.setup.is.closed.restart")}</p>
          </>
        ) : status.state === "recovery_window_open" ? (
          <>
            <p className={styles.eyebrow}>{localizedMessage("inspection.components.web.auth.gate.recovery.window")}</p>
            <h1 id="web-auth-title">{localizedMessage("inspection.components.web.auth.gate.approve.this.browser")}</h1>
            <p>{localizedMessage("inspection.components.web.auth.gate.rstorrent.was.restarted.with.browser.pairing.enabled")}{" "}{formatRemaining(remaining)}{" "}{localizedMessage("inspection.components.web.auth.gate.and.the.first.approval.consumes.it")}</p>
            <button
              className={styles.primary}
              type="button"
              disabled={busy}
              onClick={() => void perform(() => client.claimRecovery(browserLabel()))}
            >{localizedMessage("inspection.components.web.auth.gate.approve.this.browser")}</button>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>{localizedMessage("inspection.components.web.auth.gate.browser.approval")}</p>
            <h1 id="web-auth-title">{localizedMessage("inspection.components.web.auth.gate.this.browser.is.not.approved")}</h1>
            <p>{localizedMessage("inspection.components.web.auth.gate.in.an.approved.browser.open.settings.web")}</p>
            <form className={styles.codeForm} onSubmit={redeem}>
              <label htmlFor="pairing-code">{localizedMessage("inspection.components.web.auth.gate.four.digit.code")}</label>
              <input
                id="pairing-code"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{4}"
                maxLength={4}
                disabled={busy}
                onChange={(event) =>
                  setCode(event.currentTarget.value.replace(/[^0-9]/g, ""))
                }
              />
              <button className={styles.primary} type="submit" disabled={busy}>{localizedMessage("inspection.components.web.auth.gate.authorize.browser")}</button>
            </form>
            <p className={styles.help}>{localizedMessage("inspection.components.web.auth.gate.locked.out.restart.with")}{" "}<code>{localizedMessage("inspection.components.web.auth.gate.pairing.window")}</code>.
            </p>
          </>
        )}
        {error === null ? null : <p className={styles.error} role="alert">{error}</p>}
      </section>
    </main>
  );
}

function browserLabel(): string {
  const platform = navigator.platform.trim();
  return platform === "" ? "Browser" : `Browser on ${platform}`.slice(0, 80);
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

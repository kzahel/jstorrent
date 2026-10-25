import { message as localizedMessage, formatDate as localizedDate } from "../../localization/runtime";
import { useEffect, useState } from "react";

import type {
  PairingTicket,
  WebAuthClient,
  WebAuthStatus,
  WebSession,
} from "../../web-auth-client";
import { useToast } from "./Toast";
import styles from "./WebAccessSettingsSection.module.css";

export interface WebAccessSettingsSectionProps {
  readonly client: WebAuthClient;
  readonly onSignedOut: () => void;
}

export function WebAccessSettingsSection({
  client,
  onSignedOut,
}: WebAccessSettingsSectionProps) {
  const [status, setStatus] = useState<WebAuthStatus | null>(null);
  const [sessions, setSessions] = useState<readonly WebSession[]>([]);
  const [ticket, setTicket] = useState<PairingTicket | null>(null);
  const [ticketRemaining, setTicketRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const nextStatus = await client.status();
    setStatus(nextStatus);
    setSessions(
      nextStatus.state === "session_valid" ? await client.sessions() : [],
    );
  };

  useEffect(() => {
    void refresh().catch((cause) => setError(asMessage(cause)));
  }, []);

  useEffect(() => {
    if (ticket === null) return;
    const update = () =>
      setTicketRemaining(
        Math.max(0, ticket.expires_at - Math.floor(Date.now() / 1_000)),
      );
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [ticket]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(asMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (status === null) {
    return <p className={styles.note}>{localizedMessage("inspection.components.web.access.settings.section.loading.web.access")}</p>;
  }

  const paired = status.state === "session_valid";
  return (
    <div className={styles.panel}>
      <section className={styles.statusCard}>
        <div>
          <span>{localizedMessage("inspection.components.web.access.settings.section.current.policy")}</span>
          <strong>{paired ? localizedMessage("inspection.components.web.access.settings.section.approved.browsers") : localizedMessage("inspection.components.web.access.settings.section.localhost.open")}</strong>
        </div>
        <p>
          {paired
            ? localizedMessage("inspection.components.web.access.settings.section.this.browser.is.approved.new.browser.profiles")
            : localizedMessage("inspection.components.web.access.settings.section.any.browser.on.this.computer.can.use")}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              if (paired) {
                await client.setPolicy("local_open");
                toast.show({ message: localizedMessage("inspection.components.web.access.settings.section.localhost.access.is.now.open") });
              } else {
                await client.setPolicy("paired", browserLabel());
                toast.show({ message: localizedMessage("inspection.components.web.access.settings.section.this.browser.is.now.remembered") });
              }
              setTicket(null);
              await refresh();
            })
          }
        >
          {paired ? localizedMessage("inspection.components.web.access.settings.section.keep.localhost.open") : localizedMessage("inspection.components.web.access.settings.section.require.browser.approval")}
        </button>
      </section>

      {paired ? (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>{localizedMessage("inspection.components.web.access.settings.section.approve.another.browser")}</h3>
                <p>{localizedMessage("inspection.components.web.access.settings.section.the.code.works.once.for.10.minutes")}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const next = await client.createPairingTicket();
                    setTicket(next);
                  })
                }
              >{localizedMessage("inspection.components.web.access.settings.section.generate.code")}</button>
            </div>
            {ticket === null ? null : (
              <div className={styles.ticket} role="status">
                <strong aria-label={`Pairing code ${ticket.code.split("").join(" ")}`}>
                  {ticket.code}
                </strong>
                <span>
                  {ticketRemaining > 0
                    ? `Expires in ${formatRemaining(ticketRemaining)}`
                    : localizedMessage("inspection.components.web.access.settings.section.expired.generate.a.new.code")}
                </span>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>{localizedMessage("inspection.components.web.access.settings.section.authorized.browsers")}</h3>
                <p>{sessions.length}{" "}{localizedMessage("inspection.components.web.access.settings.section.of.32.remembered.sessions")}</p>
              </div>
              <button
                type="button"
                disabled={busy || sessions.length <= 1}
                onClick={() => {
                  if (!window.confirm("Revoke every other authorized browser?")) return;
                  void perform(async () => {
                    const changed = await client.revokeOtherSessions();
                    toast.show({ message: localizedMessage("feedback.browsers.revoked", { count: changed }) });
                    await refresh();
                  });
                }}
              >{localizedMessage("inspection.components.web.access.settings.section.revoke.all.others")}</button>
            </div>
            <ul className={styles.sessions}>
              {sessions.map((session) => (
                <li key={session.id}>
                  <div>
                    <strong>{session.label}</strong>
                    {session.current ? <span className={styles.current}>{localizedMessage("inspection.components.web.access.settings.section.this.browser")}</span> : null}
                    <small>{localizedMessage("inspection.components.web.access.settings.section.added")}{" "}{formatDate(session.created_at)}{" "}{localizedMessage("inspection.components.web.access.settings.section.last.used")}{" "}{formatDate(session.last_used_at)}
                    </small>
                  </div>
                  {session.current ? null : (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Revoke ${session.label}`}
                      onClick={() => {
                        if (!window.confirm(`Revoke ${session.label}?`)) return;
                        void perform(async () => {
                          await client.revokeSession(session.id);
                          toast.show({ message: localizedMessage("feedback.browser.revoked", { name: session.label }) });
                          await refresh();
                        });
                      }}
                    >{localizedMessage("inspection.components.web.access.settings.section.revoke")}</button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <h3>{localizedMessage("inspection.components.web.access.settings.section.recovery.and.sign.out")}</h3>
            <p className={styles.note}>{localizedMessage("inspection.components.web.access.settings.section.locked.out.restart.with")}{" "}<code>{localizedMessage("inspection.components.web.access.settings.section.pairing.window")}</code>{localizedMessage("inspection.components.web.access.settings.section.that.gives.you.10.minutes")}</p>
            <button
              className={styles.danger}
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Sign out this browser?")) return;
                void perform(async () => {
                  await client.logout();
                  onSignedOut();
                });
              }}
            >{localizedMessage("inspection.components.web.access.settings.section.sign.out.this.browser")}</button>
          </section>
        </>
      ) : null}

      {error === null ? null : <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

function browserLabel(): string {
  const platform = navigator.platform.trim();
  return platform === "" ? "Browser" : `Browser on ${platform}`.slice(0, 80);
}

function formatRemaining(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(unixSeconds: number): string {
  return localizedDate(unixSeconds * 1_000, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function asMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

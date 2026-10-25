import { formatDate as localizedDate, formatNumber, message as localizedMessage  } from "../../localization/runtime";
import { useEffect, useState, type FormEvent } from "react";

import type {
  DesktopRemoteAccess,
  DesktopRemoteAccessState,
  RemoteAuthorizedClient,
  RemoteSecuritySnapshot,
} from "../remote-access/types";
import { useToast } from "./Toast";
import styles from "./RemoteAccessSettingsSection.module.css";

export interface RemoteAccessSettingsSectionProps {
  readonly remoteAccess: DesktopRemoteAccess;
}

export function RemoteAccessSettingsSection({
  remoteAccess,
}: RemoteAccessSettingsSectionProps) {
  const [state, setState] = useState<DesktopRemoteAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [newConfirmation, setNewConfirmation] = useState("");

  const refresh = async () => setState(await remoteAccess.state());

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(asMessage(cause)));
  }, []);

  const perform = async (
    operation: () => Promise<string | void>,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      await refresh();
      if (result !== undefined) toast.show({ message: result });
    } catch (cause) {
      setError(asMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (state === null) return <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.loading.remote.access")}</p>;
  if (!state.configured) {
    return (
      <div className={styles.panel}>
        <section className={styles.statusCard}>
          <span>{localizedMessage("inspection.components.remote.access.settings.section.remote.access")}</span>
          <strong>{localizedMessage("inspection.components.remote.access.settings.section.unavailable")}</strong>
          <p>{localizedMessage("inspection.components.remote.access.settings.section.this.application.could.not.establish.protected.remote")}</p>
        </section>
      </div>
    );
  }

  const security = state.security;
  const local = remoteAccess.scope === "local";
  if (security === null) {
    return <p className={styles.error}>{localizedMessage("inspection.components.remote.access.settings.section.remote.security.state.is.unavailable")}</p>;
  }

  const enable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passphrase !== confirmation) {
      setError(localizedMessage("inspection.components.remote.access.settings.section.the.password.confirmation.does.not.match"));
      return;
    }
    void perform(async () => {
      await remoteAccess.enable(username, passphrase);
      setPassphrase("");
      setConfirmation("");
      return localizedMessage("inspection.components.remote.access.settings.section.remote.access.is.enabled");
    });
  };

  const changePassphrase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassphrase !== newConfirmation) {
      setError(localizedMessage("inspection.components.remote.access.settings.section.the.new.password.confirmation.does.not.match"));
      return;
    }
    void perform(async () => {
      const revoked = await remoteAccess.changePassphrase(newPassphrase);
      setNewPassphrase("");
      setNewConfirmation("");
      return localizedMessage("feedback.remote.password.changed", { count: revoked });
    });
  };

  return (
    <div className={styles.panel}>
      <section className={styles.statusCard}>
        <div>
          <span>{localizedMessage("inspection.components.remote.access.settings.section.remote.access")}</span>
          <strong>{security.enabled ? localizedMessage("inspection.components.remote.access.settings.section.enabled") : localizedMessage("inspection.components.remote.access.settings.section.disabled")}</strong>
        </div>
        {security.enabled ? (
          <dl className={styles.identity}>
            <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.route")}</dt><dd>{security.route}</dd></div>
            <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.username")}</dt><dd>{security.username}</dd></div>
            <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.relay.deployment")}</dt><dd><code>{security.relay_id}</code></dd></div>
            <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.host.identity")}</dt><dd><code>{security.host_pin}</code></dd></div>
          </dl>
        ) : (
          <p>{localizedMessage("inspection.components.remote.access.settings.section.remote.access.is.off.history.only")}</p>
        )}
        <button type="button" disabled={busy} onClick={() => void perform(refresh)}>{localizedMessage("inspection.components.remote.access.settings.section.refresh.audit")}</button>
      </section>

      {!security.enabled && local ? (
        <section className={styles.section}>
          <h3>{localizedMessage("inspection.components.remote.access.settings.section.enable.remote.access")}</h3>
          <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.choose.the.relay.route.username.and.a")}</p>
          <form className={styles.form} onSubmit={enable}>
            <label>{localizedMessage("inspection.components.remote.access.settings.section.route.username")}<input required minLength={3} maxLength={32} pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" value={username} onChange={(event) => setUsername(event.currentTarget.value)} /></label>
            <label>{localizedMessage("inspection.components.remote.access.settings.section.password")}<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.currentTarget.value)} /></label>
            <label>{localizedMessage("inspection.components.remote.access.settings.section.confirm.password")}<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label>
            <button type="submit" disabled={busy}>{localizedMessage("inspection.components.remote.access.settings.section.enable.remote.access")}</button>
          </form>
        </section>
      ) : (
        <>
          <AuthorizationSection
            snapshot={security.authority}
            busy={busy}
            currentClientId={remoteAccess.currentClientId}
            activeClientIds={security.live_circuits.flatMap((circuit) =>
              circuit.client_id === null ? [] : [circuit.client_id]
            )}
            perform={perform}
            remoteAccess={remoteAccess}
          />

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div><h3>{localizedMessage("inspection.components.remote.access.settings.section.live.circuits")}</h3><p>{security.live_circuits.length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.active")}</p></div>
            </div>
            {security.live_circuits.length === 0 ? (
              <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.no.browser.is.connected")}</p>
            ) : (
              <ul className={styles.records}>
                {security.live_circuits.map((circuit) => (
                  <li key={circuit.circuit_id}>
                    <div>
                      <strong>{circuit.client_id === null ? localizedMessage("inspection.components.remote.access.settings.section.shared.browser") : labelForClient(security.authority, circuit.client_id)}</strong>
                      <small>
                        {circuit.authentication_method}{" "}{localizedMessage("inspection.components.remote.access.settings.section.generation")}{" "}{circuit.connection_generation}{" "}{localizedMessage("inspection.components.remote.access.settings.section.started")}{" "}{formatDate(circuit.started)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.active.506018d")}{" "}{formatDate(circuit.last_activity)} · {circuit.route}
                      </small>
                      <code>{circuit.circuit_id}</code>
                    </div>
                    <button type="button" disabled={busy} onClick={() => {
                      if (!window.confirm("Close this authenticated remote circuit?")) return;
                      void perform(async () => {
                        await remoteAccess.closeCircuit(circuit.circuit_id);
                        return localizedMessage("inspection.components.remote.access.settings.section.the.circuit.was.closed");
                      });
                    }}>{localizedMessage("inspection.components.remote.access.settings.section.close")}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>{localizedMessage("inspection.components.remote.access.settings.section.direct.file.transfers")}</h3>
                <p>
                  {security.direct_file.compiled
                    ? security.direct_file.enabled
                      ? localizedMessage("inspection.components.remote.access.settings.section.enabled.file.bytes.use.a.direct.encrypted")
                      : localizedMessage("inspection.components.remote.access.settings.section.disabled.by.the.operator")
                    : localizedMessage("inspection.components.remote.access.settings.section.not.included.in.this.host.build")}
                </p>
              </div>
              <span className={styles.badge}>{humanize(security.direct_file.state)}</span>
            </div>
            <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.the.relay.carries.encrypted.connection.setup.only")}</p>
            <dl className={styles.identity}>
              <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.active.circuit")}</dt><dd><code>{security.direct_file.active_circuit_id ?? localizedMessage("inspection.components.remote.access.settings.section.none")}</code></dd></div>
              <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.data.sent")}</dt><dd>{formatNumber(security.direct_file.bytes_sent)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.bytes")}</dd></div>
              <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.candidate.class")}</dt><dd>{security.direct_file.candidate_class === null ? localizedMessage("inspection.components.remote.access.settings.section.none") : humanize(security.direct_file.candidate_class)}</dd></div>
              <div><dt>{localizedMessage("inspection.components.remote.access.settings.section.resources")}</dt><dd>{security.direct_file.active_tasks}{" "}{localizedMessage("inspection.components.remote.access.settings.section.tasks")}{" "}{security.direct_file.open_sockets}{" "}{localizedMessage("inspection.components.remote.access.settings.section.sockets")}{" "}{security.direct_file.active_requests}{" "}{localizedMessage("inspection.components.remote.access.settings.section.range.requests")}{" "}{formatNumber(security.direct_file.queued_bytes)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.queued.bytes")}</dd></div>
            </dl>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy || !security.direct_file.compiled}
                onClick={() => void perform(async () => {
                  const enabled = !security.direct_file.enabled;
                  await remoteAccess.setDirectFileTransfersEnabled(enabled);
                  return enabled
                    ? localizedMessage("feedback.remote.direct.enabled")
                    : localizedMessage("feedback.remote.direct.disabled");
                })}
              >
                {security.direct_file.enabled ? localizedMessage("inspection.components.remote.access.settings.section.disable.direct.file.transfers") : localizedMessage("inspection.components.remote.access.settings.section.enable.direct.file.transfers")}
              </button>
              <button
                type="button"
                disabled={busy || security.direct_file.active_circuit_id === null}
                onClick={() => void perform(async () => {
                  await remoteAccess.stopDirectFileTransfers();
                  return localizedMessage("inspection.components.remote.access.settings.section.active.direct.file.transfers.stopped");
                })}
              >{localizedMessage("inspection.components.remote.access.settings.section.stop.active.transfers")}</button>
            </div>
          </section>

          <section className={styles.section}>
            <h3>{localizedMessage("inspection.components.remote.access.settings.section.authentication.and.recovery")}</h3>
            <div className={styles.actions}>
              <button type="button" disabled={busy || (security.authority?.clients.length ?? 0) === 0} onClick={() => {
                if (!window.confirm("Require the password again on every browser and close their authorized circuits?")) return;
                void perform(async () => {
                  const revoked = await remoteAccess.requirePasswordEverywhere();
                  return localizedMessage("feedback.remote.authorizations.revoked", { count: revoked });
                });
              }}>{localizedMessage("inspection.components.remote.access.settings.section.require.password.everywhere")}</button>
              {local ? <button className={styles.danger} type="button" disabled={busy} onClick={() => {
                if (!window.confirm("Turn off remote access? Every browser is signed out and the remote access password is removed.")) return;
                void perform(async () => {
                  const outcome = await remoteAccess.disable();
                  return outcome.authority_file_removed && outcome.route_released
                    ? localizedMessage("feedback.remote.disabled")
                    : localizedMessage("feedback.remote.disabled.incomplete", {
                        authority: String(outcome.authority_file_removed),
                        route: String(outcome.route_released),
                      });
                });
              }}>{localizedMessage("inspection.components.remote.access.settings.section.disable.remote.access")}</button> : null}
              {remoteAccess.signOutThisBrowser === undefined ? null : (
                <button className={styles.danger} type="button" disabled={busy} onClick={() => {
                  if (!window.confirm("Sign out this browser and revoke its private authorization, if present?")) return;
                  setBusy(true);
                  setError(null);
                  void remoteAccess.signOutThisBrowser?.().catch((cause: unknown) => {
                    setError(asMessage(cause));
                    setBusy(false);
                  });
                }}>{localizedMessage("inspection.components.remote.access.settings.section.sign.out.this.browser")}</button>
              )}
            </div>
            {local ? <form className={styles.form} onSubmit={changePassphrase}>
              <h4>{localizedMessage("inspection.components.remote.access.settings.section.change.password")}</h4>
              <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.changing.it.revokes.every.private.browser.and")}</p>
              <label>{localizedMessage("inspection.components.remote.access.settings.section.new.password")}<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={newPassphrase} onChange={(event) => setNewPassphrase(event.currentTarget.value)} /></label>
              <label>{localizedMessage("inspection.components.remote.access.settings.section.confirm.new.password")}<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={newConfirmation} onChange={(event) => setNewConfirmation(event.currentTarget.value)} /></label>
              <button type="submit" disabled={busy}>{localizedMessage("inspection.components.remote.access.settings.section.change.password")}</button>
            </form> : null}
          </section>
        </>
      )}

      <AuditHistory
        title={localizedMessage("inspection.components.remote.access.settings.section.current.security.ledger")}
        snapshot={security.authority}
        busy={busy}
      />
      <AuditHistory
        title={localizedMessage("inspection.components.remote.access.settings.section.security.history")}
        snapshot={security.retained_history}
        busy={busy}
        clear={() => {
          if (!window.confirm("Clear security history? Browsers that are signed in stay signed in.")) return;
          void perform(async () => {
            const cleared = await remoteAccess.clearHistory();
            return cleared
              ? localizedMessage("feedback.remote.history.cleared")
              : localizedMessage("feedback.remote.history.empty");
          });
        }}
      />

      {error === null ? null : <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

interface AuthorizationSectionProps {
  readonly snapshot: RemoteSecuritySnapshot | null;
  readonly busy: boolean;
  readonly activeClientIds: readonly string[];
  readonly currentClientId?: string | undefined;
  readonly remoteAccess: DesktopRemoteAccess;
  readonly perform: (operation: () => Promise<string | void>) => Promise<void>;
}

function AuthorizationSection({ snapshot, busy, activeClientIds, currentClientId, remoteAccess, perform }: AuthorizationSectionProps) {
  const clients = snapshot?.clients ?? [];
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div><h3>{localizedMessage("inspection.components.remote.access.settings.section.authorized.browsers")}</h3><p>{clients.length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.of.32.current.authorizations")}</p></div>
      </div>
      {clients.length === 0 ? <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.no.browser.can.resume.without.the.password")}</p> : (
        <ul className={styles.records}>
          {clients.map((client) => (
            <li key={client.client_id}>
              <div>
                <strong>{client.label}</strong>
                {client.client_id === currentClientId ? <span className={styles.badge}>{localizedMessage("inspection.components.remote.access.settings.section.this.browser")}</span> : null}
                <span className={styles.badge}>{activeClientIds.filter((id) => id === client.client_id).length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.live")}</span>
                <small>{client.state}{" "}{localizedMessage("inspection.components.remote.access.settings.section.added")}{" "}{formatDate(client.created)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.password.029c017")}{" "}{formatDate(client.last_full_login)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.resume")}{" "}{formatOptionalDate(client.last_resume)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.seen")}{" "}{formatDate(client.last_seen)}</small>
                <small>{localizedMessage("inspection.components.remote.access.settings.section.idle.expiry")}{" "}{formatDate(client.idle_expires)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.absolute.expiry")}{" "}{formatDate(client.absolute_expires)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.build")}{" "}{client.client_build ?? localizedMessage("inspection.components.remote.access.settings.section.not.reported")}</small>
                <small>{localizedMessage("inspection.components.remote.access.settings.section.route.observation")}{" "}{client.route_observation ?? localizedMessage("inspection.components.remote.access.settings.section.not.reported")}{" "}{localizedMessage("inspection.components.remote.access.settings.section.browser.observation")}{" "}{client.browser_observation ?? localizedMessage("inspection.components.remote.access.settings.section.not.reported")}</small>
                <code title={client.fingerprint}>{client.fingerprint}</code>
              </div>
              <div className={styles.rowActions}>
                <button type="button" disabled={busy} onClick={() => {
                  const label = window.prompt("Browser name", client.label);
                  if (label === null || label === client.label) return;
                  void perform(async () => {
                    await remoteAccess.rename(client.client_id, label);
                    return localizedMessage("inspection.components.remote.access.settings.section.browser.authorization.renamed");
                  });
                }}>{localizedMessage("inspection.components.remote.access.settings.section.rename")}</button>
                <button type="button" disabled={busy || clients.length <= 1} onClick={() => {
                  if (!window.confirm(`Revoke every browser except ${client.label}?`)) return;
                  void perform(async () => {
                    const revoked = await remoteAccess.revokeAllOther(client.client_id);
                    return localizedMessage("feedback.browsers.revoked", { count: revoked });
                  });
                }}>{localizedMessage("inspection.components.remote.access.settings.section.keep.only.this")}</button>
                <button className={styles.danger} type="button" disabled={busy} onClick={() => {
                  if (!window.confirm(`Revoke ${client.label} and close all of its circuits?`)) return;
                  void perform(async () => {
                    await remoteAccess.revoke(client.client_id);
                    return localizedMessage("feedback.browser.revoked", { name: client.label });
                  });
                }}>{localizedMessage("inspection.components.remote.access.settings.section.revoke")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditHistory({ title, snapshot, busy, clear }: { readonly title: string; readonly snapshot: RemoteSecuritySnapshot | null; readonly busy: boolean; readonly clear?: () => void }) {
  if (snapshot === null) return null;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div><h3>{title}</h3><p>{snapshot.events.length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.owner.events")}{" "}{snapshot.tombstones.length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.ended.authorizations")}{" "}{snapshot.failed_attempts.length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.failed.attempt.buckets")}</p></div>
        {clear === undefined ? null : <button type="button" disabled={busy || (snapshot.events.length === 0 && snapshot.tombstones.length === 0 && snapshot.failed_attempts.length === 0)} onClick={clear}>{localizedMessage("inspection.components.remote.access.settings.section.clear.history")}</button>}
      </div>
      <p className={styles.note}>{localizedMessage("inspection.components.remote.access.settings.section.generation.40536dd")}{" "}{snapshot.generation}{localizedMessage("inspection.components.remote.access.settings.section.authorization.generation")}{" "}{snapshot.authorization_generation}{localizedMessage("inspection.components.remote.access.settings.section.entries.below.are.complete.and.unfiltered")}</p>
      <ol className={styles.audit}>
        {snapshot.events.map((event) => (
          <li key={event.event_id}>
            <strong>{humanize(event.kind)}</strong>
            <small>{formatDate(event.timestamp)} · {event.result} · {event.authentication_method ?? localizedMessage("inspection.components.remote.access.settings.section.owner.action")}{" "}{localizedMessage("inspection.components.remote.access.settings.section.route.f7f55fb")}{" "}{event.route ?? localizedMessage("inspection.components.remote.access.settings.section.none")}</small>
            <small>{localizedMessage("inspection.components.remote.access.settings.section.client")}{" "}{event.client_id ?? localizedMessage("inspection.components.remote.access.settings.section.none")}{" "}{localizedMessage("inspection.components.remote.access.settings.section.circuit")}{" "}{event.circuit_id ?? localizedMessage("inspection.components.remote.access.settings.section.none")}{" "}{localizedMessage("inspection.components.remote.access.settings.section.build")}{" "}{event.client_build ?? localizedMessage("inspection.components.remote.access.settings.section.none")}{" "}{localizedMessage("inspection.components.remote.access.settings.section.reason")}{" "}{event.reason_class ?? localizedMessage("inspection.components.remote.access.settings.section.none")}</small>
            {event.direct_file === null ? null : (
              <small>{localizedMessage("inspection.components.remote.access.settings.section.torrent")}{" "}{event.direct_file.torrent_id}{" "}{localizedMessage("inspection.components.remote.access.settings.section.file.index")}{" "}{event.direct_file.file_index} · {formatNumber(event.direct_file.byte_count)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.bytes.candidate")}{" "}{event.direct_file.candidate_class === null ? localizedMessage("inspection.components.remote.access.settings.section.none") : humanize(event.direct_file.candidate_class)}
              </small>
            )}
          </li>
        ))}
      </ol>
      {snapshot.tombstones.length === 0 ? null : <details><summary>{localizedMessage("inspection.components.remote.access.settings.section.ended.browser.authorizations")}{snapshot.tombstones.length})</summary><ul className={styles.audit}>{snapshot.tombstones.map((item) => <li key={`${item.client_id}-${item.ended}`}><strong>{item.label} — {item.state}</strong><small>{localizedMessage("inspection.components.remote.access.settings.section.added.6b02e0d")}{" "}{formatDate(item.created)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.seen")}{" "}{formatDate(item.last_seen)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.ended")}{" "}{formatDate(item.ended)}</small><code>{item.fingerprint}</code></li>)}</ul></details>}
      {snapshot.failed_attempts.length === 0 ? null : <details><summary>{localizedMessage("inspection.components.remote.access.settings.section.failed.authentication.pressure")}{snapshot.failed_attempts.length}{" "}{localizedMessage("inspection.components.remote.access.settings.section.buckets")}</summary><ul className={styles.audit}>{snapshot.failed_attempts.map((item) => <li key={`${item.bucket_start}-${item.kind}-${item.route_class}`}><strong>{item.kind}: {item.attempts}{" "}{localizedMessage("inspection.components.remote.access.settings.section.attempts")}</strong><small>{formatDate(item.bucket_start)}{" "}{localizedMessage("inspection.components.remote.access.settings.section.route.class")}{" "}{item.route_class}</small></li>)}</ul></details>}
    </section>
  );
}

function labelForClient(snapshot: RemoteSecuritySnapshot | null, clientId: string): string {
  return snapshot?.clients.find((client) => client.client_id === clientId)?.label ?? `Browser ${clientId}`;
}

function formatDate(value: number): string {
  return localizedDate(value, {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
}

function formatOptionalDate(value: number | null): string {
  return value === null ? "never" : formatDate(value);
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

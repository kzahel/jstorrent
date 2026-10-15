import jstorrentIcon from "../assets/jstorrent.png";
import { message as localizedMessage } from "../localization/runtime";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ApplicationViewClient } from "../api/client";
import {
  RemoteApplicationWebSocket,
  type RemoteAuthentication,
  type RemoteConnectionFailure,
  type RemoteCryptoWasmModule,
  type RemoteHostIdentity,
} from "../remote-application-websocket";
import {
  createPrivateBrowserCredential,
  type RemoteClientStore,
} from "../remote-client-store";
import { WebSocketApplicationViewClient } from "../websocket-view-client";
import { clientIdentity } from "../client-identity";
import { createRemoteSecurityClient } from "../remote-security-client";
import type { DesktopRemoteAccess } from "../inspection/remote-access/types";
import styles from "./RemoteAccessGate.module.css";

const LAST_USERNAME_KEY = "rstorrent.remote.last-username.v1";
const TERMINAL_FAILURE_KEY = "rstorrent.remote.terminal-failure.v1";
const RESUME_CONNECTION_ATTEMPTS = 5;
const RESUME_RETRY_BASE_MILLIS = 100;
const TERMINAL_RECONNECT_DELAY_MILLIS = 250;

type Phase = "loading" | "sign_in" | "connecting" | "identity_changed";

export interface RemoteAccessGateProps {
  readonly relayUrl: string;
  readonly clientBuild: string;
  readonly crypto: RemoteCryptoWasmModule;
  readonly store: RemoteClientStore;
  readonly onConnected: (
    client: ApplicationViewClient,
    remoteAccess: DesktopRemoteAccess,
  ) => Promise<void>;
}

export function RemoteAccessGate({
  relayUrl,
  clientBuild,
  crypto,
  store,
  onConnected,
}: RemoteAccessGateProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [privateBrowser, setPrivateBrowser] = useState(true);
  const [browserLabel, setBrowserLabel] = useState(defaultBrowserLabel);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const terminal = sessionStorage.getItem(TERMINAL_FAILURE_KEY);
    sessionStorage.removeItem(TERMINAL_FAILURE_KEY);
    const remembered = localStorage.getItem(LAST_USERNAME_KEY) ?? "";
    setUsername(remembered);
    if (terminal === "host_identity_changed") {
      setMessage(
        "This route now presents a different authenticated host identity. " +
          "JSTorrent will not send your password until you explicitly clear the old trust record.",
      );
      setPhase("identity_changed");
      return () => {
        mounted.current = false;
      };
    }
    if (terminal === "resume_rejected") {
      setMessage(
        localizedMessage("remote.remote.access.gate.this.browser.authorization.is.no.longer.valid"),
      );
    }
    void attemptRememberedResume(remembered);
    return () => {
      mounted.current = false;
    };
  }, []);

  async function attemptRememberedResume(remembered: string): Promise<void> {
    if (remembered === "") {
      setPhase("sign_in");
      return;
    }
    try {
      const stored = await store.load(remembered);
      if (stored?.authorization === undefined || stored.key === undefined) {
        if (mounted.current) setPhase("sign_in");
        return;
      }
      for (let attempt = 0; attempt < RESUME_CONNECTION_ATTEMPTS; attempt += 1) {
        try {
          await connect(remembered, {
            type: "resume",
            authorization: stored.authorization,
            key: stored.key,
          });
          return;
        } catch (error) {
          if (!(error instanceof ResumeConnectionUnavailable)) throw error;
          if (attempt + 1 === RESUME_CONNECTION_ATTEMPTS) {
            await handleInitialFailure(remembered, "connection_failed");
            return;
          }
          await delay(RESUME_RETRY_BASE_MILLIS * 2 ** attempt);
        }
      }
    } catch (error) {
      if (!mounted.current) return;
      setMessage(errorMessage(error));
      setPhase("sign_in");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setPhase("connecting");
    let encodedPassphrase = new TextEncoder().encode(passphrase);
    setPassphrase("");
    try {
      const stored = await store.load(username);
      const authentication: RemoteAuthentication = privateBrowser
        ? {
            type: "password",
            passphrase: encodedPassphrase,
            ...(stored?.identity === undefined
              ? {}
              : { expectedIdentity: stored.identity }),
            choice: {
              type: "private",
              credential: await createPrivateBrowserCredential(
                browserLabel,
                clientBuild,
              ),
            },
          }
        : {
            type: "password",
            passphrase: encodedPassphrase,
            ...(stored?.identity === undefined
              ? {}
              : { expectedIdentity: stored.identity }),
            choice: { type: "shared", clientBuild },
          };
      await connect(username, authentication);
      encodedPassphrase = new Uint8Array();
    } catch (error) {
      encodedPassphrase.fill(0);
      if (!mounted.current) return;
      setMessage(errorMessage(error));
      setPhase("sign_in");
    }
  }

  async function connect(
    selectedUsername: string,
    initialAuthentication: RemoteAuthentication,
  ): Promise<void> {
    let authentication = initialAuthentication;
    let enteredProduct = false;
    let observedFailure: RemoteConnectionFailure | undefined;
    let activeTransport: RemoteApplicationWebSocket | undefined;
    const applicationClient = new WebSocketApplicationViewClient(
      window.location.origin,
      null,
      () => {
        activeTransport = new RemoteApplicationWebSocket({
          relayUrl,
          username: selectedUsername,
          authentication,
          crypto,
          onAuthorization: async (authorization) => {
            if (
              initialAuthentication.type !== "password" ||
              initialAuthentication.choice.type !== "private"
            ) {
              throw new Error("private browser credential is unavailable");
            }
            const key = initialAuthentication.choice.credential.key;
            await store.saveAuthorization(authorization, key);
            initialAuthentication.passphrase.fill(0);
            authentication = { type: "resume", authorization, key };
          },
          onHostPin: async (identity) => {
            await store.saveTrust(selectedUsername, identity);
            localStorage.setItem(LAST_USERNAME_KEY, selectedUsername);
            if (authentication.type === "password") {
              authentication = {
                ...authentication,
                expectedIdentity: copyIdentity(identity),
              };
            }
          },
          onFailure: (failure) => {
            observedFailure = failure;
            if (enteredProduct) {
              void handleTerminalFailure(selectedUsername, failure);
            }
          },
        });
        return activeTransport;
      },
      undefined,
      { client: clientIdentity("remote", { buildId: clientBuild }) },
    );
    const currentClientId = currentClientIdentifier(initialAuthentication);
    const remoteAccess = createRemoteSecurityClient({
      username: selectedUsername,
      ...(currentClientId === undefined ? {} : { currentClientId }),
      transport: () => activeTransport,
      application: applicationClient,
      store,
    });
    try {
      await onConnected(applicationClient, remoteAccess);
      enteredProduct = true;
    } catch (error) {
      await applicationClient.close();
      if (initialAuthentication.type === "password") {
        initialAuthentication.passphrase.fill(0);
      }
      if (observedFailure !== undefined) {
        if (
          observedFailure === "connection_failed" &&
          initialAuthentication.type === "resume"
        ) {
          throw new ResumeConnectionUnavailable();
        }
        await handleInitialFailure(selectedUsername, observedFailure);
        return;
      }
      throw error;
    }
  }

  async function handleInitialFailure(
    selectedUsername: string,
    failure: RemoteConnectionFailure,
  ): Promise<void> {
    if (failure === "resume_rejected") {
      await store.clearAuthorization(selectedUsername);
      if (!mounted.current) return;
      setMessage(
        localizedMessage("remote.remote.access.gate.this.browser.authorization.is.no.longer.valid"),
      );
      setPhase("sign_in");
      return;
    }
    if (failure === "host_identity_changed") {
      if (!mounted.current) return;
      setMessage(
        "This route presents a different authenticated host identity. " +
          "JSTorrent did not send your password.",
      );
      setPhase("identity_changed");
      return;
    }
    if (!mounted.current) return;
    setMessage(
      "The remote host is unavailable or authentication was rejected. " +
        "Check the route and password, then try again.",
    );
    setPhase("sign_in");
  }

  async function handleTerminalFailure(
    selectedUsername: string,
    failure: RemoteConnectionFailure,
  ): Promise<void> {
    if (failure === "resume_rejected") {
      await store.clearAuthorization(selectedUsername);
    }
    sessionStorage.setItem(TERMINAL_FAILURE_KEY, failure);
    if (failure === "connection_failed") {
      window.setTimeout(
        () => window.location.reload(),
        TERMINAL_RECONNECT_DELAY_MILLIS,
      );
    } else {
      window.location.reload();
    }
  }

  async function clearChangedIdentity(): Promise<void> {
    if (username !== "") await store.clearHost(username);
    localStorage.removeItem(LAST_USERNAME_KEY);
    setMessage(
      localizedMessage("remote.remote.access.gate.local.trust.was.cleared.confirm.the.host"),
    );
    setPhase("sign_in");
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="remote-title">
        <img className={styles.brand} src={jstorrentIcon} width="42" height="42" alt="" />
        <p className={styles.eyebrow}>{localizedMessage("remote.remote.access.gate.rstorrent.remote.access")}</p>
        <h1 id="remote-title">{localizedMessage("remote.remote.access.gate.your.torrents.from.this.browser")}</h1>
        <p className={styles.intro}>{localizedMessage("remote.remote.access.gate.the.relay.can.route.encrypted.bytes.but")}</p>

        {phase === "loading" || phase === "connecting" ? (
          <div className={styles.progress} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            {phase === "loading"
              ? localizedMessage("remote.remote.access.gate.checking.this.browser.for.an.authorization")
              : localizedMessage("remote.remote.access.gate.authenticating.the.host.and.opening.rstorrent")}
          </div>
        ) : null}

        {message !== null ? (
          <p className={styles.message} role="alert">
            {message}
          </p>
        ) : null}

        {phase === "identity_changed" ? (
          <div className={styles.recovery}>
            <p>{localizedMessage("remote.remote.access.gate.only.continue.if.the.rstorrent.operator.intentionally")}</p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void clearChangedIdentity()}
            >{localizedMessage("remote.remote.access.gate.clear.old.host.trust")}</button>
          </div>
        ) : null}

        {phase === "sign_in" ? (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label>{localizedMessage("remote.remote.access.gate.route.username")}<input
                required
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </label>
            <label>{localizedMessage("remote.remote.access.gate.password")}<input
                required
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.currentTarget.value)}
              />
            </label>
            <fieldset>
              <legend>{localizedMessage("remote.remote.access.gate.this.browser")}</legend>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name="browser-kind"
                  checked={privateBrowser}
                  onChange={() => setPrivateBrowser(true)}
                />
                <span>
                  <strong>{localizedMessage("remote.remote.access.gate.private")}</strong>{" "}{localizedMessage("remote.remote.access.gate.resume.automatically.on.this.browser")}</span>
              </label>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name="browser-kind"
                  checked={!privateBrowser}
                  onChange={() => setPrivateBrowser(false)}
                />
                <span>
                  <strong>{localizedMessage("remote.remote.access.gate.shared")}</strong>{" "}{localizedMessage("remote.remote.access.gate.require.the.password.after.this.page.closes")}</span>
              </label>
            </fieldset>
            {privateBrowser ? (
              <label>{localizedMessage("remote.remote.access.gate.browser.name.shown.to.the.operator")}<input
                  required
                  maxLength={80}
                  value={browserLabel}
                  onChange={(event) => setBrowserLabel(event.currentTarget.value)}
                />
              </label>
            ) : null}
            <button type="submit" className={styles.primary}>{localizedMessage("remote.remote.access.gate.sign.in")}</button>
          </form>
        ) : null}

        <p className={styles.disclosure}>{localizedMessage("remote.remote.access.gate.a.compromised.client.page.could.observe.entered")}</p>
      </section>
    </main>
  );
}

class ResumeConnectionUnavailable extends Error {}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function defaultBrowserLabel(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    "Browser";
  const prefix = platform.trim().slice(0, 60) || "Private";
  return `${prefix} browser`;
}

function copyIdentity(identity: RemoteHostIdentity): RemoteHostIdentity {
  return {
    relayId: identity.relayId.slice(),
    hostId: identity.hostId.slice(),
    hostPin: identity.hostPin.slice(),
  };
}

function currentClientIdentifier(
  authentication: RemoteAuthentication,
): string | undefined {
  const bytes =
    authentication.type === "resume"
      ? authentication.authorization.clientId
      : authentication.choice.type === "private"
        ? authentication.choice.credential.clientId
        : undefined;
  if (bytes === undefined) return undefined;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote access failed";
}

import { remoteCryptoOperationEntropy } from "./remote-crypto-entropy";
import type {
  ApplicationWebSocket,
  ApplicationWebSocketFactory,
} from "./websocket-view-client";

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;
const HANDSHAKE_TIMEOUT_MILLIS = 20_000;
const REMOTE_FAILURE_CLOSE_CODE = 4_008;
const CLIENT_SELECT_MAGIC = bytes("RSC1");
const PAIRED_CONTROL = bytes("RSP1");
const HOST_GREETING = bytes("RHG1");
const LOGIN_REQUEST = bytes("RSL1");
const LOGIN_RESPONSE = bytes("RSL2");
const LOGIN_FINALIZATION = bytes("RSL3");
const RESUME_REQUEST = bytes("RSR1");
const RESUME_RESPONSE = bytes("RSR2");
const RESUME_FINALIZATION = bytes("RSR3");
const AUTHENTICATED_READY = bytes("RSA2");
const AUTHORIZATION_CHOICE = bytes("RSA3");
const AUTHENTICATION_SUCCEEDED = bytes("RSA4");
const REMOTE_CONTROL_REQUEST = bytes("RSC2");
const REMOTE_CONTROL_RESPONSE = bytes("RSC3");
const DIRECT_FILE_REQUEST = bytes("RDF1");
const DIRECT_FILE_RESPONSE = bytes("RDF2");
const MAX_REMOTE_CONTROL_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_DIRECT_FILE_SIGNALING_BYTES = 64 * 1024;
const MAX_PENDING_REMOTE_CONTROLS = 4;
const REMOTE_CONTROL_TIMEOUT_MILLIS = 10_000;
const DIRECT_FILE_SIGNALING_TIMEOUT_MILLIS = 15_000;

export type RemoteConnectionFailure =
  | "connection_failed"
  | "host_identity_changed"
  | "resume_rejected";

export type RemoteControlOperation =
  | { readonly type: "inspect" }
  | { readonly type: "rename"; readonly client_id: string; readonly label: string }
  | { readonly type: "revoke"; readonly client_id: string }
  | { readonly type: "revoke_all_other"; readonly retained_client_id: string }
  | { readonly type: "close_circuit"; readonly circuit_id: string }
  | { readonly type: "require_password_everywhere" }
  | { readonly type: "set_direct_file_transfers"; readonly enabled: boolean }
  | { readonly type: "stop_direct_file_transfers" }
  | { readonly type: "sign_out_this_browser" }
  | { readonly type: "clear_history" };

export type RemoteControlOutcome =
  | { readonly type: "security"; readonly security: unknown }
  | { readonly type: "count"; readonly count: number }
  | { readonly type: "complete" }
  | { readonly type: "signed_out"; readonly authorization_revoked: boolean };

export interface DirectIceCandidate {
  readonly candidate: string;
  readonly sdp_mid: string | null;
  readonly sdp_m_line_index: number | null;
  readonly username_fragment: string | null;
}

interface DirectFileIdentity {
  readonly request_id: number;
  readonly circuit_generation: number;
  readonly browser_peer_generation: number;
}

export type DirectFileRequest =
  | (DirectFileIdentity & {
      readonly type: "open";
      readonly torrent_id: string;
      readonly file_index: number;
      readonly offer: { readonly type: "offer"; readonly sdp: string };
    })
  | (DirectFileIdentity & {
      readonly type: "candidate";
      readonly candidate: DirectIceCandidate;
    })
  | (DirectFileIdentity & { readonly type: "end_of_candidates" })
  | (DirectFileIdentity & {
      readonly type: "close";
      readonly outcome: "complete" | "cancelled" | "sink_failed";
    });

export type DirectFileResponse =
  | (DirectFileIdentity & {
      readonly type: "opened";
      readonly host_peer_generation: number;
      readonly file_length: string;
      readonly max_chunk_bytes: number;
      readonly answer: { readonly type: "answer"; readonly sdp: string };
      readonly candidates: readonly DirectIceCandidate[];
    })
  | (DirectFileIdentity & {
      readonly type: "candidate";
      readonly host_peer_generation: number;
      readonly candidate: DirectIceCandidate;
    })
  | (DirectFileIdentity & {
      readonly type: "end_of_candidates";
      readonly host_peer_generation: number;
    })
  | (DirectFileIdentity & {
      readonly type: "status";
      readonly host_peer_generation: number;
      readonly state: "negotiating" | "connected" | "transferring" | "complete";
      readonly bytes_sent: string;
      readonly candidate_class: "host" | "server_reflexive" | "peer_reflexive" | null;
    })
  | (DirectFileIdentity & {
      readonly type: "rejected";
      readonly reason:
        | "disabled"
        | "busy"
        | "unsupported"
        | "invalid_request"
        | "file_unavailable"
        | "signaling_limit"
        | "direct_unavailable"
        | "cancelled"
        | "circuit_closed"
        | "internal";
    })
  | (DirectFileIdentity & {
      readonly type: "closed";
      readonly host_peer_generation: number | null;
      readonly outcome: "complete" | "cancelled" | "sink_failed";
    });

export interface RemoteHostIdentity {
  readonly relayId: Uint8Array;
  readonly hostId: Uint8Array;
  readonly hostPin: Uint8Array;
}

export interface RemoteAuthorization extends RemoteHostIdentity {
  readonly username: string;
  readonly hostResumePublicKey: Uint8Array;
  readonly clientId: Uint8Array;
  readonly clientPublicKey: Uint8Array;
  readonly authorizationGeneration: bigint;
  readonly clientGeneration: bigint;
  readonly protocolFloor: number;
  readonly label: string;
}

export interface PrivateBrowserCredential {
  readonly key: CryptoKey;
  readonly clientId: Uint8Array;
  readonly clientPublicKey: Uint8Array;
  readonly label: string;
  readonly clientBuild?: string;
  readonly routeObservation?: string;
  readonly browserObservation?: string;
}

export type RemoteAuthentication =
  | {
      readonly type: "password";
      readonly passphrase: Uint8Array;
      readonly choice:
        | { readonly type: "shared"; readonly clientBuild?: string }
        | {
            readonly type: "private";
            readonly credential: PrivateBrowserCredential;
          };
      readonly expectedIdentity?: RemoteHostIdentity;
    }
  | {
      readonly type: "resume";
      readonly authorization: RemoteAuthorization;
      readonly key: CryptoKey;
    };

export interface AuthenticationReady {
  readonly protocol_version: number;
  readonly host_build: string;
  readonly host_pin: string;
  readonly host_resume_public_key: string;
  readonly authorization_generation: number;
  readonly authorization_challenge: string;
  readonly protocol_floor: number;
}

export interface WasmOpenedRecord {
  readonly plaintext: Uint8Array;
  readonly isClose: boolean;
}

export interface WasmClientSession {
  take_finalization(): Uint8Array;
  host_pin(): Uint8Array;
  seal(plaintext: Uint8Array): Uint8Array;
  seal_close(): Uint8Array;
  open(record: Uint8Array): WasmOpenedRecord;
}

export interface WasmClientLogin {
  request(): Uint8Array;
  finish(
    passphrase: Uint8Array,
    relayId: Uint8Array,
    username: string,
    hostId: Uint8Array,
    expectedPin: Uint8Array,
    response: Uint8Array,
    entropy: Uint8Array,
  ): WasmClientSession;
}

export interface WasmClientResumeProof {
  signature_input(): Uint8Array;
  complete(signature: Uint8Array): WasmClientSession;
}

export interface WasmClientResume {
  request(): Uint8Array;
  finish(challenge: Uint8Array): WasmClientResumeProof;
}

export interface RemoteCryptoWasmModule {
  readonly ClientLogin: new (
    passphrase: Uint8Array,
    entropy: Uint8Array,
  ) => WasmClientLogin;
  readonly ClientResume: new (
    relayId: Uint8Array,
    username: string,
    hostId: Uint8Array,
    hostPin: Uint8Array,
    hostResumePublicKey: Uint8Array,
    clientId: Uint8Array,
    clientPublicKey: Uint8Array,
    authorizationGeneration: bigint,
    clientGeneration: bigint,
    protocolFloor: number,
    entropy: Uint8Array,
  ) => WasmClientResume;
  authorizationTranscript(
    relayId: Uint8Array,
    username: string,
    hostId: Uint8Array,
    hostPin: Uint8Array,
    hostResumePublicKey: Uint8Array,
    authorizationGeneration: bigint,
    authorizationChallenge: Uint8Array,
    clientPublicKey: Uint8Array,
    label: string,
    clientBuild?: string,
    routeObservation?: string,
    browserObservation?: string,
  ): Uint8Array;
}

export interface RemoteConnectionOptions {
  readonly relayUrl: string;
  readonly username: string;
  readonly authentication: RemoteAuthentication;
  readonly crypto: RemoteCryptoWasmModule;
  readonly socketFactory?: ApplicationWebSocketFactory;
  readonly entropy?: () => Uint8Array;
  readonly subtle?: SubtleCrypto;
  readonly onHostPin?: (identity: RemoteHostIdentity) => void | Promise<void>;
  readonly onAuthorization?: (
    authorization: RemoteAuthorization,
  ) => void | Promise<void>;
  readonly onFailure?: (failure: RemoteConnectionFailure) => void;
}

type HandshakePhase =
  | "pair"
  | "greeting"
  | "login_response"
  | "password_ready"
  | "resume_response"
  | "resume_outcome"
  | "password_outcome"
  | "application";

interface HostGreetingValue {
  readonly relayId: Uint8Array;
  readonly hostId: Uint8Array;
  readonly protocolVersion: number;
}

interface AuthenticationSucceeded {
  readonly protocol_version: number;
  readonly authorization: null | {
    readonly client_id: string;
    readonly fingerprint: string;
  };
  readonly capabilities?: readonly string[];
  readonly circuit_id?: string;
  readonly connection_generation?: number;
}

interface PendingRemoteControl {
  readonly resolve: (outcome: RemoteControlOutcome) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingDirectFile {
  readonly requestId: number;
  readonly resolve: (response: DirectFileResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

class HostIdentityChanged extends Error {}

/** ApplicationWebSocket-compatible encrypted product relay transport. */
export class RemoteApplicationWebSocket implements ApplicationWebSocket {
  public binaryType: BinaryType = "arraybuffer";
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  private state = SOCKET_CONNECTING;
  private phase: HandshakePhase = "pair";
  private readonly socket: ApplicationWebSocket;
  private readonly passphrase: Uint8Array;
  private readonly expectedHostPin: Uint8Array;
  private login: WasmClientLogin | undefined;
  private resume: WasmClientResume | undefined;
  private session: WasmClientSession | undefined;
  private greeting: HostGreetingValue | undefined;
  private ready: AuthenticationReady | undefined;
  private readonly timer: ReturnType<typeof setTimeout>;
  private failed = false;
  private nextControlId = 1;
  private readonly pendingControls = new Map<number, PendingRemoteControl>();
  private pendingDirectFile: PendingDirectFile | undefined;
  private directFileCircuitGeneration: number | undefined;
  private directFileCapability = false;
  private readonly circuitCloseListeners = new Set<() => void>();

  public constructor(private readonly options: RemoteConnectionOptions) {
    validateOptions(options);
    this.passphrase =
      options.authentication.type === "password"
        ? options.authentication.passphrase.slice()
        : new Uint8Array();
    this.expectedHostPin = expectedIdentity(options)?.hostPin.slice() ?? new Uint8Array();
    const factory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.socket = factory(clientRelayUrl(options.relayUrl));
    this.socket.binaryType = "arraybuffer";
    this.socket.onopen = () => {
      try {
        this.socket.send(exactBuffer(encodeClientSelect(options.username)));
      } catch (error) {
        this.fail(error);
      }
    };
    this.socket.onmessage = (event) => {
      void this.receive(event.data).catch((error: unknown) => this.fail(error));
    };
    this.socket.onerror = () => this.fail(new Error("relay transport failed"));
    this.socket.onclose = (event) => {
      if (
        (this.state === SOCKET_CONNECTING || this.state === SOCKET_OPEN) &&
        !this.failed
      ) {
        const resumeRejected =
          this.state === SOCKET_CONNECTING &&
          this.options.authentication.type === "resume" &&
          this.phase !== "pair" &&
          this.phase !== "greeting";
        this.failed = true;
        this.options.onFailure?.(
          resumeRejected ? "resume_rejected" : "connection_failed",
        );
        if (this.state === SOCKET_CONNECTING) this.onerror?.(new Event("error"));
      }
      this.closed(event);
    };
    this.timer = setTimeout(
      () => this.fail(new Error("remote authentication timed out")),
      HANDSHAKE_TIMEOUT_MILLIS,
    );
  }

  public get readyState(): number {
    return this.state;
  }

  public send(data: string | ArrayBuffer): void {
    if (this.state !== SOCKET_OPEN || this.session === undefined) {
      throw new Error("remote application connection is not open");
    }
    if (data instanceof ArrayBuffer) {
      throw new Error("remote torrent byte attachments are unsupported");
    }
    rejectUnsupportedApplicationBreadth(data);
    this.socket.send(exactBuffer(this.session.seal(new TextEncoder().encode(data))));
  }

  /** Direct peers must terminate with their authenticated parent circuit. */
  public onCircuitClosed(listener: () => void): () => void {
    if (this.state >= SOCKET_CLOSING) { listener(); return () => {}; }
    this.circuitCloseListeners.add(listener);
    return () => { this.circuitCloseListeners.delete(listener); };
  }
  private notifyCircuitClosed(): void {
    const listeners = [...this.circuitCloseListeners];
    this.circuitCloseListeners.clear();
    for (const listener of listeners) listener();
  }
  public close(code = 1_000, reason = ""): void {
    if (this.state === SOCKET_CLOSED || this.state === SOCKET_CLOSING) return;
    this.state = SOCKET_CLOSING;
    this.notifyCircuitClosed();
    clearTimeout(this.timer);
    this.eraseHandshakeSecrets();
    this.rejectPendingControls(new Error("remote application connection closed"));
    this.rejectPendingDirectFile(new Error("remote application connection closed"));
    if (this.session !== undefined) {
      try {
        this.socket.send(exactBuffer(this.session.seal_close()));
      } catch {
        // The authenticated record channel may already be terminal.
      }
    }
    this.socket.close(code, reason);
  }

  public remoteControl(
    operation: RemoteControlOperation,
  ): Promise<RemoteControlOutcome> {
    if (this.state !== SOCKET_OPEN || this.session === undefined) {
      return Promise.reject(new Error("remote application connection is not open"));
    }
    if (this.pendingControls.size >= MAX_PENDING_REMOTE_CONTROLS) {
      return Promise.reject(new Error("remote security operation limit reached"));
    }
    const requestId = this.allocateControlId();
    const plaintext = encodeJsonRecord(REMOTE_CONTROL_REQUEST, {
      request_id: requestId,
      operation,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingControls.delete(requestId);
        reject(new Error("remote security operation timed out"));
      }, REMOTE_CONTROL_TIMEOUT_MILLIS);
      this.pendingControls.set(requestId, { resolve, reject, timer });
      try {
        this.socket.send(exactBuffer(this.session!.seal(plaintext)));
      } catch (error) {
        clearTimeout(timer);
        this.pendingControls.delete(requestId);
        reject(asError(error));
      }
    });
  }

  public directFileSupported(): boolean {
    return this.state === SOCKET_OPEN && this.directFileCapability;
  }

  public directFileConnectionGeneration(): number {
    if (!this.directFileSupported() || this.directFileCircuitGeneration === undefined) {
      throw new Error("direct file transfer is unavailable on this connection");
    }
    return this.directFileCircuitGeneration;
  }

  public directFile(request: DirectFileRequest): Promise<DirectFileResponse> {
    if (this.state !== SOCKET_OPEN || this.session === undefined) {
      return Promise.reject(new Error("remote application connection is not open"));
    }
    if (!this.directFileCapability || this.directFileCircuitGeneration === undefined) {
      return Promise.reject(new Error("direct file transfer is unsupported by this host"));
    }
    if (request.circuit_generation !== this.directFileCircuitGeneration) {
      return Promise.reject(new Error("direct file transfer uses a stale connection"));
    }
    if (this.pendingDirectFile !== undefined) {
      return Promise.reject(new Error("a direct file signaling operation is already pending"));
    }
    let plaintext: Uint8Array;
    try {
      plaintext = encodeJsonRecord(DIRECT_FILE_REQUEST, request);
      if (plaintext.byteLength - DIRECT_FILE_REQUEST.byteLength > MAX_DIRECT_FILE_SIGNALING_BYTES) {
        throw new Error("direct file signaling exceeds the size limit");
      }
    } catch (error) {
      return Promise.reject(asError(error));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDirectFile = undefined;
        reject(new Error("direct file signaling timed out"));
      }, DIRECT_FILE_SIGNALING_TIMEOUT_MILLIS);
      this.pendingDirectFile = { requestId: request.request_id, resolve, reject, timer };
      try {
        this.socket.send(exactBuffer(this.session!.seal(plaintext)));
      } catch (error) {
        clearTimeout(timer);
        this.pendingDirectFile = undefined;
        reject(asError(error));
      }
    });
  }

  private async receive(data: unknown): Promise<void> {
    const message = binaryMessage(data);
    switch (this.phase) {
      case "pair":
        if (!equalBytes(message, PAIRED_CONTROL)) throw new Error("pair failed");
        this.phase = "greeting";
        return;
      case "greeting":
        this.beginAuthentication(decodeHostGreeting(message));
        return;
      case "login_response":
        this.finishPasswordLogin(payload(message, LOGIN_RESPONSE));
        return;
      case "password_ready":
        await this.acceptPasswordReady(message);
        return;
      case "resume_response":
        await this.acceptResumeChallenge(payload(message, RESUME_RESPONSE));
        return;
      case "resume_outcome":
      case "password_outcome":
        await this.acceptAuthenticationOutcome(message);
        return;
      case "application":
        this.acceptApplicationRecord(message);
        return;
    }
  }

  private beginAuthentication(greeting: HostGreetingValue): void {
    if (greeting.protocolVersion !== 1 && greeting.protocolVersion !== 2) {
      throw new Error("unsupported host protocol");
    }
    const expected = expectedIdentity(this.options);
    if (
      expected !== undefined &&
      (!equalBytes(expected.relayId, greeting.relayId) ||
        !equalBytes(expected.hostId, greeting.hostId))
    ) {
      throw new HostIdentityChanged("host identity changed");
    }
    this.greeting = greeting;
    if (this.options.authentication.type === "password") {
      this.login = new this.options.crypto.ClientLogin(
        this.passphrase,
        this.operationEntropy(),
      );
      this.socket.send(exactBuffer(framed(LOGIN_REQUEST, this.login.request())));
      this.phase = "login_response";
      return;
    }
    const authorization = this.options.authentication.authorization;
    this.resume = new this.options.crypto.ClientResume(
      greeting.relayId,
      this.options.username,
      greeting.hostId,
      authorization.hostPin,
      authorization.hostResumePublicKey,
      authorization.clientId,
      authorization.clientPublicKey,
      authorization.authorizationGeneration,
      authorization.clientGeneration,
      authorization.protocolFloor,
      this.operationEntropy(),
    );
    this.socket.send(
      exactBuffer(
        framed(
          RESUME_REQUEST,
          concatenate(authorization.clientId, this.resume.request()),
        ),
      ),
    );
    this.phase = "resume_response";
  }

  private finishPasswordLogin(response: Uint8Array): void {
    const greeting = required(this.greeting, "host greeting");
    const login = required(this.login, "login state");
    let session: WasmClientSession;
    try {
      session = login.finish(
        this.passphrase,
        greeting.relayId,
        this.options.username,
        greeting.hostId,
        this.expectedHostPin,
        response,
        this.operationEntropy(),
      );
    } catch (error) {
      if (errorMessage(error) === "host identity changed") {
        throw new HostIdentityChanged("host identity changed");
      }
      throw error;
    }
    this.login = undefined;
    this.passphrase.fill(0);
    this.expectedHostPin.fill(0);
    this.session = session;
    this.socket.send(
      exactBuffer(framed(LOGIN_FINALIZATION, session.take_finalization())),
    );
    this.phase = "password_ready";
  }

  private async acceptPasswordReady(record: Uint8Array): Promise<void> {
    const session = required(this.session, "record state");
    const opened = session.open(record);
    if (opened.isClose) throw new Error("authenticated host closed");
    const ready = decodeJsonRecord<AuthenticationReady>(
      opened.plaintext,
      AUTHENTICATED_READY,
    );
    validateReady(ready);
    const pin = decodeId(ready.host_pin, 64, "host pin");
    if (!equalBytes(pin, session.host_pin())) {
      throw new Error("authenticated host pin is inconsistent");
    }
    this.ready = ready;
    const authentication = this.options.authentication;
    if (authentication.type !== "password") throw new Error("invalid authentication state");
    let choice: unknown;
    if (authentication.choice.type === "shared") {
      choice = {
        choice: "shared",
        ...(authentication.choice.clientBuild === undefined
          ? {}
          : { client_build: authentication.choice.clientBuild }),
      };
    } else {
      const greeting = required(this.greeting, "host greeting");
      const credential = authentication.choice.credential;
      const transcript = this.options.crypto.authorizationTranscript(
        greeting.relayId,
        this.options.username,
        greeting.hostId,
        pin,
        decodeId(ready.host_resume_public_key, 65, "host resume public key"),
        BigInt(ready.authorization_generation),
        decodeId(ready.authorization_challenge, 32, "authorization challenge"),
        credential.clientPublicKey,
        credential.label,
        credential.clientBuild,
        credential.routeObservation,
        credential.browserObservation,
      );
      const signature = await signP256(
        this.options.subtle ?? crypto.subtle,
        credential.key,
        transcript,
      );
      transcript.fill(0);
      choice = {
        choice: "private",
        client_id: encodeId(credential.clientId),
        client_public_key: encodeId(credential.clientPublicKey),
        signature: encodeId(signature),
        label: credential.label,
        client_build: credential.clientBuild ?? null,
        route_observation: credential.routeObservation ?? null,
        browser_observation: credential.browserObservation ?? null,
      };
      signature.fill(0);
    }
    const plaintext = encodeJsonRecord(AUTHORIZATION_CHOICE, choice);
    this.socket.send(exactBuffer(session.seal(plaintext)));
    this.phase = "password_outcome";
  }

  private async acceptResumeChallenge(challenge: Uint8Array): Promise<void> {
    const resume = required(this.resume, "resume state");
    const proof = resume.finish(challenge);
    this.resume = undefined;
    const signatureInput = proof.signature_input();
    const authentication = this.options.authentication;
    if (authentication.type !== "resume") throw new Error("invalid resume state");
    const signature = await signP256(
      this.options.subtle ?? crypto.subtle,
      authentication.key,
      signatureInput,
    );
    signatureInput.fill(0);
    const session = proof.complete(signature);
    signature.fill(0);
    this.session = session;
    this.socket.send(
      exactBuffer(framed(RESUME_FINALIZATION, session.take_finalization())),
    );
    this.phase = "resume_outcome";
  }

  private async acceptAuthenticationOutcome(record: Uint8Array): Promise<void> {
    const session = required(this.session, "record state");
    const opened = session.open(record);
    if (opened.isClose) throw new Error("authenticated host closed");
    const outcome = decodeJsonRecord<AuthenticationSucceeded>(
      opened.plaintext,
      AUTHENTICATION_SUCCEEDED,
    );
    validateOutcome(outcome);
    this.directFileCapability = outcome.capabilities?.includes("direct_file_v1") ?? false;
    this.directFileCircuitGeneration = outcome.connection_generation;
    const authentication = this.options.authentication;
    if (authentication.type === "resume") {
      if (
        outcome.authorization === null ||
        outcome.authorization.client_id !== encodeId(authentication.authorization.clientId)
      ) {
        throw new Error("resume authorization acknowledgement is invalid");
      }
    } else if (authentication.choice.type === "private") {
      const credential = authentication.choice.credential;
      if (
        outcome.authorization === null ||
        outcome.authorization.client_id !== encodeId(credential.clientId)
      ) {
        throw new Error("private authorization acknowledgement is invalid");
      }
      const greeting = required(this.greeting, "host greeting");
      const ready = required(this.ready, "authenticated readiness");
      const identity = {
        relayId: greeting.relayId.slice(),
        hostId: greeting.hostId.slice(),
        hostPin: session.host_pin().slice(),
      };
      await this.options.onAuthorization?.({
        ...identity,
        username: this.options.username,
        hostResumePublicKey: decodeId(
          ready.host_resume_public_key,
          65,
          "host resume public key",
        ),
        clientId: credential.clientId.slice(),
        clientPublicKey: credential.clientPublicKey.slice(),
        authorizationGeneration: BigInt(ready.authorization_generation),
        clientGeneration: 1n,
        protocolFloor: ready.protocol_floor,
        label: credential.label,
      });
      await this.options.onHostPin?.(identity);
    } else {
      if (outcome.authorization !== null) {
        throw new Error("shared browser unexpectedly received authorization");
      }
      const greeting = required(this.greeting, "host greeting");
      await this.options.onHostPin?.({
        relayId: greeting.relayId.slice(),
        hostId: greeting.hostId.slice(),
        hostPin: session.host_pin().slice(),
      });
    }
    clearTimeout(this.timer);
    this.eraseHandshakeSecrets();
    this.state = SOCKET_OPEN;
    this.phase = "application";
    this.onopen?.(new Event("open"));
  }

  private acceptApplicationRecord(record: Uint8Array): void {
    const session = required(this.session, "record state");
    const opened = session.open(record);
    if (opened.isClose) {
      this.close(1_000, "authenticated remote close");
      return;
    }
    if (
      opened.plaintext.byteLength > 4 &&
      equalBytes(opened.plaintext.subarray(0, 4), REMOTE_CONTROL_RESPONSE)
    ) {
      this.acceptRemoteControl(opened.plaintext);
      return;
    }
    if (
      opened.plaintext.byteLength > 4 &&
      equalBytes(opened.plaintext.subarray(0, 4), DIRECT_FILE_RESPONSE)
    ) {
      this.acceptDirectFile(opened.plaintext);
      return;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext);
    this.onmessage?.(new MessageEvent("message", { data: text }));
  }

  private fail(error: unknown): void {
    if (this.failed || this.state === SOCKET_CLOSED) return;
    this.failed = true;
    this.options.onFailure?.(
      error instanceof HostIdentityChanged
        ? "host_identity_changed"
        : this.options.authentication.type === "resume" &&
            this.phase !== "pair" &&
            this.phase !== "greeting"
          ? "resume_rejected"
          : "connection_failed",
    );
    this.onerror?.(new Event("error"));
    this.close(REMOTE_FAILURE_CLOSE_CODE, "remote connection failed");
  }

  private closed(event: CloseEvent): void {
    clearTimeout(this.timer);
    this.eraseHandshakeSecrets();
    this.state = SOCKET_CLOSED;
    this.notifyCircuitClosed();
    this.onclose?.(event);
  }

  private operationEntropy(): Uint8Array {
    const entropy = this.options.entropy?.() ?? remoteCryptoOperationEntropy();
    if (entropy.byteLength !== 32) {
      entropy.fill(0);
      throw new Error("secure browser randomness is unavailable");
    }
    return entropy;
  }

  private eraseHandshakeSecrets(): void {
    this.passphrase.fill(0);
    this.expectedHostPin.fill(0);
    this.login = undefined;
    this.resume = undefined;
  }

  private acceptRemoteControl(plaintext: Uint8Array): void {
    const response = decodeJsonRecord<{
      readonly request_id: number;
      readonly outcome: unknown;
    }>(plaintext, REMOTE_CONTROL_RESPONSE, MAX_REMOTE_CONTROL_RESPONSE_BYTES);
    if (
      !hasExactKeys(response, ["outcome", "request_id"]) ||
      !Number.isSafeInteger(response.request_id) ||
      response.request_id < 1 ||
      response.request_id > 0xffff_ffff
    ) {
      throw new Error("invalid remote security response");
    }
    const pending = this.pendingControls.get(response.request_id);
    if (pending === undefined) throw new Error("unexpected remote security response");
    clearTimeout(pending.timer);
    this.pendingControls.delete(response.request_id);
    const outcome = validateControlOutcome(response.outcome);
    if (outcome.type === "error") {
      pending.reject(new Error(outcome.message));
    } else {
      pending.resolve(outcome);
    }
  }

  private allocateControlId(): number {
    for (let attempts = 0; attempts < MAX_PENDING_REMOTE_CONTROLS + 1; attempts += 1) {
      const candidate = this.nextControlId;
      this.nextControlId = candidate === 0xffff_ffff ? 1 : candidate + 1;
      if (!this.pendingControls.has(candidate)) return candidate;
    }
    throw new Error("remote security operation IDs are exhausted");
  }

  private rejectPendingControls(error: Error): void {
    for (const pending of this.pendingControls.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingControls.clear();
  }

  private acceptDirectFile(plaintext: Uint8Array): void {
    const response = validateDirectFileResponse(
      decodeJsonRecord<unknown>(
        plaintext,
        DIRECT_FILE_RESPONSE,
        MAX_DIRECT_FILE_SIGNALING_BYTES,
      ),
    );
    const pending = this.pendingDirectFile;
    if (pending === undefined || pending.requestId !== response.request_id) {
      throw new Error("unexpected direct file signaling response");
    }
    clearTimeout(pending.timer);
    this.pendingDirectFile = undefined;
    if (response.type === "rejected") {
      pending.reject(new Error(directFileFailureMessage(response.reason)));
    } else {
      pending.resolve(response);
    }
  }

  private rejectPendingDirectFile(error: Error): void {
    const pending = this.pendingDirectFile;
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pendingDirectFile = undefined;
    pending.reject(error);
  }
}

async function signP256(
  subtle: SubtleCrypto,
  key: CryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  const signature = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, exactBuffer(message)),
  );
  if (signature.byteLength !== 64) {
    signature.fill(0);
    throw new Error("browser ECDSA signature encoding is unsupported");
  }
  return signature;
}

function expectedIdentity(options: RemoteConnectionOptions): RemoteHostIdentity | undefined {
  return options.authentication.type === "resume"
    ? options.authentication.authorization
    : options.authentication.expectedIdentity;
}

function decodeHostGreeting(message: Uint8Array): HostGreetingValue {
  if (message.byteLength !== 70 || !equalBytes(message.subarray(0, 4), HOST_GREETING)) {
    throw new Error("invalid host greeting");
  }
  return {
    relayId: message.slice(4, 36),
    hostId: message.slice(36, 68),
    protocolVersion: (message[68]! << 8) | message[69]!,
  };
}

function validateReady(value: AuthenticationReady): void {
  if (
    !hasExactKeys(value, [
      "authorization_challenge",
      "authorization_generation",
      "host_build",
      "host_pin",
      "host_resume_public_key",
      "protocol_floor",
      "protocol_version",
    ]) ||
    (value.protocol_version !== 1 && value.protocol_version !== 2) ||
    !Number.isSafeInteger(value.authorization_generation) ||
    value.authorization_generation < 1 ||
    !Number.isSafeInteger(value.protocol_floor) ||
    value.protocol_floor < 1 ||
    typeof value.host_build !== "string" ||
    value.host_build.length < 1 ||
    value.host_build.length > 160
  ) {
    throw new Error("invalid authenticated readiness");
  }
  decodeId(value.host_pin, 64, "host pin");
  decodeId(value.host_resume_public_key, 65, "host resume public key");
  decodeId(value.authorization_challenge, 32, "authorization challenge");
}

function validateOutcome(value: AuthenticationSucceeded): void {
  if (value.protocol_version !== 1 && value.protocol_version !== 2) {
    throw new Error("invalid authentication result");
  }
  const expectedKeys =
    value.protocol_version === 1
      ? ["authorization", "protocol_version"]
      : [
          "authorization",
          "capabilities",
          "circuit_id",
          "connection_generation",
          "protocol_version",
        ];
  if (!hasExactKeys(value, expectedKeys)) throw new Error("invalid authentication result");
  if (value.protocol_version === 2) {
    if (
      !Array.isArray(value.capabilities) ||
      value.capabilities.some(
        (capability) => typeof capability !== "string" || capability.length > 64,
      ) ||
      typeof value.circuit_id !== "string" ||
      !Number.isSafeInteger(value.connection_generation) ||
      (value.connection_generation ?? 0) < 1
    ) {
      throw new Error("invalid authentication result");
    }
    decodeId(value.circuit_id, 16, "circuit ID");
  }
  if (value.authorization !== null) {
    if (!hasExactKeys(value.authorization, ["client_id", "fingerprint"])) {
      throw new Error("invalid authentication result");
    }
    decodeId(value.authorization.client_id, 16, "client ID");
    if (
      typeof value.authorization.fingerprint !== "string" ||
      value.authorization.fingerprint.length < 1 ||
      value.authorization.fingerprint.length > 128
    ) {
      throw new Error("invalid authorization fingerprint");
    }
  }
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function encodeJsonRecord(magic: Uint8Array, value: unknown): Uint8Array {
  return framed(magic, new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJsonRecord<T>(
  message: Uint8Array,
  magic: Uint8Array,
  maximumBytes = 2 * 1024,
): T {
  const encoded = payload(message, magic);
  if (encoded.byteLength > maximumBytes) throw new Error("JSON record exceeds size limit");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded)) as T;
}

function validateControlOutcome(
  value: unknown,
): RemoteControlOutcome | { readonly type: "error"; readonly message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid remote security response");
  }
  const candidate = value as { type?: unknown; [key: string]: unknown };
  switch (candidate.type) {
    case "security":
      if (!hasExactKeys(value, ["security", "type"])) break;
      return { type: "security", security: candidate.security };
    case "count":
      if (
        hasExactKeys(value, ["count", "type"]) &&
        Number.isSafeInteger(candidate.count) &&
        (candidate.count as number) >= 0
      ) {
        return { type: "count", count: candidate.count as number };
      }
      break;
    case "complete":
      if (hasExactKeys(value, ["type"])) return { type: "complete" };
      break;
    case "signed_out":
      if (
        hasExactKeys(value, ["authorization_revoked", "type"]) &&
        typeof candidate.authorization_revoked === "boolean"
      ) {
        return {
          type: "signed_out",
          authorization_revoked: candidate.authorization_revoked,
        };
      }
      break;
    case "error":
      if (
        hasExactKeys(value, ["message", "type"]) &&
        typeof candidate.message === "string" &&
        candidate.message.length <= 160
      ) {
        return { type: "error", message: candidate.message };
      }
      break;
  }
  throw new Error("invalid remote security response");
}

function validateDirectFileResponse(value: unknown): DirectFileResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid direct file signaling response");
  }
  const candidate = value as Record<string, unknown>;
  if (!directFileIdentity(candidate)) throw new Error("invalid direct file signaling response");
  const common = [
    "browser_peer_generation",
    "circuit_generation",
    "request_id",
    "type",
  ];
  switch (candidate.type) {
    case "opened":
      if (
        hasExactKeys(value, [
          ...common,
          "answer",
          "candidates",
          "file_length",
          "host_peer_generation",
          "max_chunk_bytes",
        ]) &&
        positiveSafeInteger(candidate.host_peer_generation) &&
        decimalU64(candidate.file_length) &&
        positiveSafeInteger(candidate.max_chunk_bytes) &&
        (candidate.max_chunk_bytes as number) <= 64 * 1024 &&
        directSessionDescription(candidate.answer, "answer") &&
        Array.isArray(candidate.candidates) &&
        candidate.candidates.length <= 32 &&
        candidate.candidates.every(directIceCandidate)
      ) {
        return value as DirectFileResponse;
      }
      break;
    case "candidate":
      if (
        hasExactKeys(value, [...common, "candidate", "host_peer_generation"]) &&
        positiveSafeInteger(candidate.host_peer_generation) &&
        directIceCandidate(candidate.candidate)
      ) {
        return value as DirectFileResponse;
      }
      break;
    case "end_of_candidates":
      if (
        hasExactKeys(value, [...common, "host_peer_generation"]) &&
        positiveSafeInteger(candidate.host_peer_generation)
      ) {
        return value as DirectFileResponse;
      }
      break;
    case "status":
      if (
        hasExactKeys(value, [
          ...common,
          "bytes_sent",
          "candidate_class",
          "host_peer_generation",
          "state",
        ]) &&
        positiveSafeInteger(candidate.host_peer_generation) &&
        decimalU64(candidate.bytes_sent) &&
        oneOf(candidate.state, ["negotiating", "connected", "transferring", "complete"]) &&
        (candidate.candidate_class === null ||
          oneOf(candidate.candidate_class, ["host", "server_reflexive", "peer_reflexive"]))
      ) {
        return value as DirectFileResponse;
      }
      break;
    case "rejected":
      if (
        hasExactKeys(value, [...common, "reason"]) &&
        oneOf(candidate.reason, [
          "disabled",
          "busy",
          "unsupported",
          "invalid_request",
          "file_unavailable",
          "signaling_limit",
          "direct_unavailable",
          "cancelled",
          "circuit_closed",
          "internal",
        ])
      ) {
        return value as DirectFileResponse;
      }
      break;
    case "closed":
      if (
        hasExactKeys(value, [...common, "host_peer_generation", "outcome"]) &&
        (candidate.host_peer_generation === null ||
          positiveSafeInteger(candidate.host_peer_generation)) &&
        oneOf(candidate.outcome, ["complete", "cancelled", "sink_failed"])
      ) {
        return value as DirectFileResponse;
      }
      break;
  }
  throw new Error("invalid direct file signaling response");
}

function directFileIdentity(candidate: Record<string, unknown>): boolean {
  return (
    positiveSafeInteger(candidate.request_id) &&
    positiveSafeInteger(candidate.circuit_generation) &&
    positiveSafeInteger(candidate.browser_peer_generation)
  );
}

function directSessionDescription(value: unknown, kind: "offer" | "answer"): boolean {
  return (
    hasExactKeys(value, ["sdp", "type"]) &&
    (value as Record<string, unknown>).type === kind &&
    typeof (value as Record<string, unknown>).sdp === "string" &&
    ((value as Record<string, unknown>).sdp as string).length > 0
  );
}

function directIceCandidate(value: unknown): boolean {
  if (!hasExactKeys(value, [
    "candidate",
    "sdp_m_line_index",
    "sdp_mid",
    "username_fragment",
  ])) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.candidate === "string" &&
    candidate.candidate.length > 0 &&
    candidate.candidate.length <= 4_096 &&
    nullableSignalingString(candidate.sdp_mid) &&
    (candidate.sdp_m_line_index === null ||
      (nonnegativeSafeInteger(candidate.sdp_m_line_index) &&
        (candidate.sdp_m_line_index as number) <= 0xffff)) &&
    nullableSignalingString(candidate.username_fragment)
  );
}

function decimalU64(value: unknown): boolean {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)) return false;
  return BigInt(value) <= 0xffff_ffff_ffff_ffffn;
}

function positiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonnegativeSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullableSignalingString(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length <= 256);
}

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

function directFileFailureMessage(reason: Extract<DirectFileResponse, { type: "rejected" }>["reason"]): string {
  switch (reason) {
    case "disabled": return "direct file transfers are disabled on the host";
    case "busy": return "another direct file transfer is already active";
    case "unsupported": return "this host does not support direct file transfers";
    case "file_unavailable": return "the completed file is no longer available";
    case "direct_unavailable": return "a direct connection could not be established";
    case "cancelled": return "the direct file transfer was cancelled";
    case "circuit_closed": return "the remote connection closed";
    default: return "the direct file transfer request was rejected";
  }
}

function rejectUnsupportedApplicationBreadth(encoded: string): void {
  let frame: unknown;
  try {
    frame = JSON.parse(encoded);
  } catch {
    throw new Error("remote application frame is invalid JSON");
  }
  if (typeof frame !== "object" || frame === null) return;
  const candidate = frame as { type?: unknown; operation?: { type?: unknown } };
  if (candidate.type === "begin_torrent_upload") {
    throw new Error("remote torrent byte attachments are unsupported");
  }
  if (candidate.type === "call" && candidate.operation?.type === "create_media_url") {
    throw new Error("remote media capabilities are unsupported");
  }
}

function validateOptions(options: RemoteConnectionOptions): void {
  encodeClientSelect(options.username);
  const identity = expectedIdentity(options);
  if (
    identity !== undefined &&
    (identity.relayId.byteLength !== 32 ||
      identity.hostId.byteLength !== 32 ||
      identity.hostPin.byteLength !== 64)
  ) {
    throw new Error("remote host identity has invalid lengths");
  }
  if (options.authentication.type === "resume") {
    const authorization = options.authentication.authorization;
    if (
      authorization.username !== options.username ||
      authorization.hostResumePublicKey.byteLength !== 65 ||
      authorization.clientId.byteLength !== 16 ||
      authorization.clientPublicKey.byteLength !== 65 ||
      authorization.authorizationGeneration < 1n ||
      authorization.clientGeneration < 1n ||
      authorization.protocolFloor < 1
    ) {
      throw new Error("remote authorization is invalid");
    }
  } else if (options.authentication.choice.type === "private") {
    const credential = options.authentication.choice.credential;
    if (credential.clientId.byteLength !== 16 || credential.clientPublicKey.byteLength !== 65) {
      throw new Error("private browser credential is invalid");
    }
  }
}

function encodeClientSelect(username: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(username);
  if (
    encoded.byteLength < 3 ||
    encoded.byteLength > 32 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(username)
  ) {
    throw new Error("invalid remote username");
  }
  const message = new Uint8Array(5 + encoded.byteLength);
  message.set(CLIENT_SELECT_MAGIC);
  message[4] = encoded.byteLength;
  message.set(encoded, 5);
  return message;
}

function clientRelayUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("remote relay URL must use WebSocket transport");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = "/client";
  return url.href;
}

function payload(message: Uint8Array, magic: Uint8Array): Uint8Array {
  if (message.byteLength <= magic.byteLength) throw new Error("invalid message");
  if (!equalBytes(message.subarray(0, magic.byteLength), magic)) {
    throw new Error("invalid message");
  }
  return message.subarray(magic.byteLength);
}

function framed(magic: Uint8Array, body: Uint8Array): Uint8Array<ArrayBuffer> {
  return concatenate(magic, body);
}

function concatenate(...values: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function binaryMessage(data: unknown): Uint8Array {
  if (!(data instanceof ArrayBuffer)) throw new Error("relay message is not binary");
  return new Uint8Array(data);
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

function encodeId(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeId(value: string, length: number, label: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`invalid ${label}`);
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error(`invalid ${label}`);
  }
  const decodedBytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (decodedBytes.byteLength !== length) throw new Error(`invalid ${label}`);
  return decodedBytes;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is unavailable`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

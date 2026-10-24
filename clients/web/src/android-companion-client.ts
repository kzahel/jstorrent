import { message as localizedMessage } from "./localization/runtime";
import type {
  AddTorrentBytesRequest,
  ApiBackendIdentity,
  ApiHello,
  ChooseDownloadRootRequest,
  OpenViewSetRequest,
  OpenViewSetResponse,
  RequestEnvelope,
  ResponseEnvelope,
  StorageRootSnapshot,
  UpdateBatch,
  UpdateViewSetRequest,
} from "./api/generated/v1";
import type {
  ApplicationUpdateStream,
  ApplicationViewClient,
} from "./api/client";
import { ApplicationViewError } from "./api/client";
import { clientIdentity, extensionVersion } from "./client-identity";
import { decodeChooseDownloadRootResponse } from "./validation";
import {
  WebSocketApplicationViewClient,
  type ApplicationWebSocketPlatformClient,
} from "./websocket-view-client";

const PORTS = [3030, 3031, 3032, 3033, 3034] as const;
const ENDPOINTS = [
  "http://100.115.92.2:3030",
  "http://100.115.92.2:3031",
  "http://100.115.92.2:3032",
  "http://100.115.92.2:3033",
  "http://100.115.92.2:3034",
] as const;
const API_ROOT = "/rstorrent/companion/v1";
// Discovery only: never pair with, authenticate to or control the legacy daemon.
const LEGACY_PORTS = [7800, 7805, 7814, 7827, 7844] as const;
const STORAGE_KEY = "rstorrentAndroidCompanionV1";
const EXTENSION_ORIGINS = [
  "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc",
  "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk",
] as const;
const PROBE_TIMEOUT_MILLIS = 2_000;
const PROBE_INTERVAL_MILLIS = 2_000;
const DISCOVERY_TIMEOUT_MILLIS = 20_000;
const MAX_BOOTSTRAP_RESPONSE_BYTES = 64 * 1024;
const REQUIRED_PROFILE = [
  "android_saf_acquisition",
  "retained_storage_roots",
  "one_current_root",
  "joined_platform_root_removal",
] as const;

interface CompanionHello {
  readonly product: string;
  readonly backend: string;
  readonly protocol_min: number;
  readonly protocol_max: number;
  readonly port: number;
  readonly nonce: string;
  readonly paired: boolean;
}

interface PairingPending {
  readonly request_id: string;
  readonly expires_in_seconds: number;
}

interface PairingPoll {
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly credential?: string;
}

interface StoredCompanion {
  readonly installationId: string;
  readonly credential?: string;
  readonly backend?: ApiBackendIdentity;
}

interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface ChromeApi {
  readonly storage: { readonly local: ChromeStorageArea };
}

export interface AndroidCompanionConnection {
  readonly client: ApplicationViewClient;
  readonly hello: ApiHello;
  readonly endpoint: string;
  readonly disconnected: Promise<void>;
}

export type AndroidConnectionStage = "discovery" | "pairing" | "authentication";
export type AndroidCompanionStatus = (message: string, stage?: AndroidConnectionStage) => void;

export class AndroidCompanionUnavailable extends Error {
  public constructor() {
    super(localizedMessage("android.companion.unreachable"));
  }
}

export class AndroidCompanionPairingFailed extends Error {
  public constructor(public readonly outcome: "rejected" | "expired") {
    super(outcome === "rejected"
      ? localizedMessage("android.companion.pairing-rejected")
      : localizedMessage("android.companion.pairing-expired"));
  }
}

export class AndroidCompanionUpdateRequired extends Error {
  public constructor(public readonly component: "android" | "extension") {
    super(component === "android"
      ? localizedMessage("android.companion.update-android")
      : localizedMessage("android.companion.update-extension"));
  }
}

export async function connectAndroidCompanion(
  status: AndroidCompanionStatus,
  signal?: AbortSignal,
): Promise<AndroidCompanionConnection> {
  const stored = await readStoredCompanion();
  const installationId = stored?.installationId ?? randomIdentifier();
  const discovery = AbortSignal.timeout(DISCOVERY_TIMEOUT_MILLIS);
  let endpoint: string;
  try {
    endpoint = await probeUntilAvailable(installationId, status,
      signal === undefined ? discovery : AbortSignal.any([signal, discovery]));
  } catch (error) {
    if (!signal?.aborted && discovery.aborted) throw new AndroidCompanionUnavailable();
    throw error;
  }
  let credential = stored?.credential;
  if (credential === undefined) {
    credential = await pair(endpoint, installationId, status, signal);
  }
  let connected: {
    readonly client: ApplicationViewClient;
    readonly hello: ApiHello;
    readonly disconnected: Promise<void>;
  };
  try {
    status(localizedMessage("android.companion.authenticating"), "authentication");
    connected = await openApplication(
      endpoint,
      installationId,
      credential,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    // Lost transport, busy services and invalid frames do not establish that
    // saved authority was rejected. Keep them retryable without a new prompt.
    if (stored?.credential === undefined || !(error instanceof ApplicationViewError) ||
        error.code !== "authentication_failed") throw error;
    status(localizedMessage("android.companion.client.the.saved.pairing.is.no.longer.accepted"));
    credential = await pair(endpoint, installationId, status, signal);
    connected = await openApplication(endpoint, installationId, credential, signal);
  }
  const backend = validateAndroidBackend(connected.hello);
  if (stored?.backend !== undefined && !sameBackendIdentity(stored.backend, backend)) {
    await connected.client.close();
    await clearCredential(installationId);
    throw new Error(
      "The Android backend identity changed. Select Connect Android app again and approve a new pairing.",
    );
  }
  await writeStoredCompanion({ installationId, credential, backend });
  return { ...connected, endpoint };
}

export async function forgetAndroidCompanion(): Promise<void> {
  await chromeApi().storage.local.remove(STORAGE_KEY);
}

async function probeUntilAvailable(
  installationId: string,
  status: AndroidCompanionStatus,
  signal?: AbortSignal,
): Promise<string> {
  while (!signal?.aborted) {
    status(localizedMessage("android.companion.unavailable-guidance"), "discovery");
    const current = await Promise.allSettled(ENDPOINTS.map(async (endpoint) => {
      await hello(endpoint, installationId, signal);
      return endpoint;
    }));
    if (signal?.aborted) throw signal.reason;
    // A usable current service takes precedence over any stale listener.
    const available = current.find((result) => result.status === "fulfilled");
    if (available?.status === "fulfilled") return available.value;
    for (const result of current) {
      if (result.status === "rejected" && result.reason instanceof AndroidCompanionUpdateRequired) throw result.reason;
    }
    const legacy = await Promise.allSettled(LEGACY_PORTS.map(async (port) => {
        const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MILLIS);
        const response = await companionText(new URL(`http://100.115.92.2:${port}/status`), {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
        return isLegacyAndroidStatus(JSON.parse(response), port);
    }));
    if (signal?.aborted) throw signal.reason;
    if (legacy.some((result) => result.status === "fulfilled" && result.value)) {
      throw new AndroidCompanionUpdateRequired("android");
    }
    await delay(PROBE_INTERVAL_MILLIS, signal);
  }
  throw signal.reason ?? new Error("Android companion connection canceled");
}

async function pair(
  endpoint: string,
  installationId: string,
  status: AndroidCompanionStatus,
  signal?: AbortSignal,
): Promise<string> {
  const greeting = await hello(endpoint, installationId, signal);
  const extensionNonce = randomIdentifier();
  const pending =
    (await companionJson(endpoint, "/pairing/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hello_nonce: greeting.nonce,
        installation_id: installationId,
        extension_nonce: extensionNonce,
      }),
      ...(signal === undefined ? {} : { signal }),
    })) as PairingPending;
  boundedIdentifier(pending.request_id, "pairing request ID");
  if (!Number.isInteger(pending.expires_in_seconds) || pending.expires_in_seconds < 1 || pending.expires_in_seconds > 120) {
    throw new Error("Invalid Android pairing expiration");
  }
  const approvalExpires = performance.now() + pending.expires_in_seconds * 1000;
  status(localizedMessage("android.companion.client.approve.the.jstorrent.beta.pairing.request.in"), "pairing");
  while (!signal?.aborted) {
    await delay(Math.min(500, Math.max(0, approvalExpires - performance.now())), signal);
    if (performance.now() >= approvalExpires) throw new AndroidCompanionPairingFailed("expired");
    let poll: PairingPoll;
    try {
      poll = (await companionJson(endpoint, "/pairing/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: pending.request_id,
          installation_id: installationId,
          extension_nonce: extensionNonce,
        }),
        ...(signal === undefined ? {} : { signal }),
      })) as PairingPoll;
    } catch (error) {
      if (!signal?.aborted && performance.now() >= approvalExpires) throw new AndroidCompanionPairingFailed("expired");
      throw error;
    }
    if (poll.status === "pending") continue;
    if (poll.status === "approved" && typeof poll.credential === "string") {
      boundedCredential(poll.credential);
      return poll.credential;
    }
    if (poll.status === "rejected" || poll.status === "expired") {
      throw new AndroidCompanionPairingFailed(poll.status);
    }
    throw new Error("Invalid Android pairing response");
  }
  throw signal.reason ?? new Error("Android pairing canceled");
}

async function hello(
  endpoint: string,
  installationId: string,
  signal?: AbortSignal,
): Promise<CompanionHello> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MILLIS);
  const combined =
    signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const value =
    (await companionJson(endpoint, "/hello", {
      headers: { "X-JSTorrent-Installation": installationId },
      signal: combined,
    })) as CompanionHello;
  if (value.product !== "rstorrent" || value.backend !== "android" ||
      !Number.isSafeInteger(value.protocol_min) || value.protocol_min < 1 ||
      !Number.isSafeInteger(value.protocol_max) || value.protocol_max < value.protocol_min ||
      !PORTS.includes(value.port as (typeof PORTS)[number]) ||
      value.port !== Number(new URL(endpoint).port) || typeof value.paired !== "boolean") {
    throw new Error("The ARC endpoint is not a compatible JSTorrent Android service");
  }
  boundedIdentifier(value.nonce, "hello nonce");
  if (value.protocol_min > 1 || value.protocol_max < 1) {
    throw new AndroidCompanionUpdateRequired("extension");
  }
  return value;
}

export function isLegacyAndroidStatus(value: unknown, port: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const capabilities = record.capabilities as Record<string, unknown> | null;
  return LEGACY_PORTS.includes(port as (typeof LEGACY_PORTS)[number]) &&
    record.port === port && record.protocolVersion === 1 &&
    record.behaviorVersion === 1 && typeof record.version === "string" &&
    record.version.length > 0 && record.version.length <= 64 &&
    typeof record.paired === "boolean" &&
    typeof capabilities === "object" && capabilities !== null &&
    capabilities.ioWebSocket === true && capabilities.controlEvents === true &&
    capabilities.rootsRead === true && capabilities.fileOps === true;
}

async function openApplication(
  endpoint: string,
  installationId: string,
  credential: string,
  signal?: AbortSignal,
): Promise<{
  readonly client: ApplicationViewClient;
  readonly hello: ApiHello;
  readonly disconnected: Promise<void>;
}> {
  const platform = new AndroidPlatformClient(
    endpoint,
    installationId,
    credential,
  );
  let connected = false;
  let resolveDisconnected: (() => void) | undefined;
  const disconnected = new Promise<void>((resolve) => {
    resolveDisconnected = resolve;
  });
  const socket = new WebSocketApplicationViewClient(
    endpoint,
    credential,
    undefined,
    installationId,
    {
      connectPath: `${API_ROOT}/connect`,
      client: clientIdentity("extension", { version: extensionVersion() }),
      platformClient: platform,
      onConnectionState: (active) => {
        if (active) {
          connected = true;
        } else if (connected) {
          resolveDisconnected?.();
        }
      },
    },
  );
  const client = new AndroidCompanionApplicationClient(socket);
  try {
    const greeting = await client.hello(signal);
    return { client, hello: greeting, disconnected };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export class AndroidPlatformClient implements ApplicationWebSocketPlatformClient {
  public constructor(
    private readonly endpoint: string,
    private readonly installationId: string,
    private readonly credential: string,
  ) {}

  public async chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
    signal?: AbortSignal,
  ): Promise<StorageRootSnapshot | null> {
    const source = await companionText(
      new URL(`${API_ROOT}/platform/download-root`, this.endpoint),
      {
        method: "POST",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.credential}`,
          "Content-Type": "application/json",
          "X-JSTorrent-Installation": this.installationId,
        },
        body: JSON.stringify(request),
        ...(signal === undefined ? {} : { signal }),
      },
    ).catch((error: unknown) => {
      if (error instanceof CompanionHttpError && error.status === 408) {
        throw new Error(localizedMessage("android.companion.folder-selection-timeout"));
      }
      throw error;
    });
    return decodeChooseDownloadRootResponse(source).root;
  }

  public async close(): Promise<void> {}
}

class AndroidCompanionApplicationClient implements ApplicationViewClient {
  public constructor(private readonly client: WebSocketApplicationViewClient) {}

  public hello(signal?: AbortSignal): Promise<ApiHello> {
    return this.client.hello(signal);
  }

  public dispatch(
    request: RequestEnvelope,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    return this.client.dispatch(request, signal);
  }

  public addTorrentBytes(
    request: AddTorrentBytesRequest,
    source: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    return this.client.addTorrentBytes(request, source, signal);
  }

  public chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
    signal?: AbortSignal,
  ): Promise<StorageRootSnapshot | null> {
    return this.client.chooseDownloadRoot(request, signal);
  }

  public openViewSet(
    request: OpenViewSetRequest,
    signal?: AbortSignal,
  ): Promise<OpenViewSetResponse> {
    return this.client.openViewSet(request, signal);
  }

  public updateViewSet(
    viewSetId: string,
    request: UpdateViewSetRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.client.updateViewSet(viewSetId, request, signal);
  }

  public streamUpdates(
    viewSetId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<ApplicationUpdateStream> {
    return this.client.streamUpdates(viewSetId, after, signal);
  }

  public closeViewSet(viewSetId: string, signal?: AbortSignal): Promise<void> {
    return this.client.closeViewSet(viewSetId, signal);
  }

  public close(): Promise<void> {
    return this.client.close();
  }
}

export function validateAndroidBackend(hello: ApiHello): ApiBackendIdentity {
  const backend = hello.backend;
  if (backend?.kind !== "android") {
    throw new Error("The authenticated application did not identify as Android");
  }
  boundedIdentifier(backend.instance_id, "backend instance ID");
  boundedText(backend.profile_id, "profile ID", 128);
  boundedText(backend.product_version, "product version", 64);
  if (
    !REQUIRED_PROFILE.every((capability) =>
      backend.capability_profile.includes(capability),
    )
  ) {
    throw new Error("The Android application capability profile is incomplete");
  }
  if (hello.capabilities.includes("torrent_media")) {
    throw new Error("The Android companion unexpectedly advertised media delivery");
  }
  return backend;
}

export function sameBackendIdentity(
  left: ApiBackendIdentity,
  right: ApiBackendIdentity,
): boolean {
  return (
    left.kind === right.kind &&
    left.instance_id === right.instance_id &&
    left.profile_id === right.profile_id
  );
}

async function companionJson(
  endpoint: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const source = await companionText(new URL(`${API_ROOT}${path}`, endpoint), {
    ...init,
    signal: init.signal == null ? AbortSignal.timeout(PROBE_TIMEOUT_MILLIS)
      : AbortSignal.any([init.signal, AbortSignal.timeout(PROBE_TIMEOUT_MILLIS)]),
    credentials: "omit",
    headers: { Accept: "application/json", ...init.headers },
  });
  return JSON.parse(source) as unknown;
}

class CompanionHttpError extends Error {
  public constructor(public readonly status: number) {
    super(`Android companion request failed (${status})`);
  }
}

async function companionText(url: URL, init: RequestInit): Promise<string> {
  const response = await fetch(
    url,
    withCompanionOrigin({ ...init, redirect: "error" }, globalThis.location.origin),
  );
  if (response.body === null) throw new Error("Android companion response is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BOOTSTRAP_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Android companion response exceeds its bound");
      }
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) {
    throw new CompanionHttpError(response.status);
  }
  return source;
}

export function withCompanionOrigin(
  init: RequestInit,
  pageOrigin: string,
): RequestInit {
  if (!EXTENSION_ORIGINS.includes(pageOrigin as (typeof EXTENSION_ORIGINS)[number])) {
    throw new Error("Android companion requests require a recognized extension origin");
  }
  const headers = new Headers(init.headers);
  headers.set("Origin", pageOrigin);
  return { ...init, headers };
}

async function readStoredCompanion(): Promise<StoredCompanion | undefined> {
  const value = (await chromeApi().storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.installationId !== "string") return undefined;
  boundedIdentifier(record.installationId, "installation ID");
  if (record.credential !== undefined) boundedCredential(record.credential);
  return record as unknown as StoredCompanion;
}

async function writeStoredCompanion(value: StoredCompanion): Promise<void> {
  await chromeApi().storage.local.set({ [STORAGE_KEY]: value });
}

async function clearCredential(installationId: string): Promise<void> {
  await writeStoredCompanion({ installationId });
}

function chromeApi(): ChromeApi {
  const api = (globalThis as typeof globalThis & { chrome?: ChromeApi }).chrome;
  if (api?.storage?.local === undefined) {
    throw new Error("Chrome extension storage is unavailable");
  }
  return api;
}

function randomIdentifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function boundedIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 64 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function boundedCredential(value: unknown): asserts value is string {
  boundedText(value, "pairing credential", 128);
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} is invalid`);
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = window.setTimeout(finish, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Android companion connection canceled"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

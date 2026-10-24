import type { ApplicationViewClient } from "./api/client";
import type {
  DesktopRemoteAccess,
  RemoteSecurityView,
} from "./inspection/remote-access/types";
import type {
  RemoteApplicationWebSocket,
  RemoteControlOperation,
  RemoteControlOutcome,
} from "./remote-application-websocket";
import type { RemoteClientStore } from "./remote-client-store";
import { prepareDirectFileSink, saveDirectFile } from "./direct-file-save";

export interface RemoteSecurityClientOptions {
  readonly username: string;
  readonly currentClientId?: string;
  readonly transport: () => RemoteApplicationWebSocket | undefined;
  readonly application: ApplicationViewClient;
  readonly store: RemoteClientStore;
  readonly reload?: () => void;
}

export function createRemoteSecurityClient(
  options: RemoteSecurityClientOptions,
): DesktopRemoteAccess {
  const control = async (
    operation: RemoteControlOperation,
  ): Promise<RemoteControlOutcome> => {
    const transport = options.transport();
    if (transport === undefined) {
      throw new Error("remote security connection is unavailable");
    }
    return transport.remoteControl(operation);
  };
  return {
    scope: "remote",
    currentClientId: options.currentClientId,
    state: async () => {
      const outcome = await control({ type: "inspect" });
      if (outcome.type !== "security" || !isSecurityView(outcome.security)) {
        throw new Error("remote host returned an invalid security view");
      }
      return { configured: true, security: outcome.security };
    },
    enable: async () => localOnly(),
    recover: async () => localOnly(),
    changePassphrase: async () => localOnly(),
    disable: async () => localOnly(),
    rename: async (clientId, label) => {
      expectComplete(
        await control({ type: "rename", client_id: clientId, label }),
      );
    },
    revoke: async (clientId) => {
      expectComplete(await control({ type: "revoke", client_id: clientId }));
    },
    revokeAllOther: async (retainedClientId) =>
      expectCount(
        await control({
          type: "revoke_all_other",
          retained_client_id: retainedClientId,
        }),
      ),
    closeCircuit: async (circuitId) => {
      expectComplete(
        await control({ type: "close_circuit", circuit_id: circuitId }),
      );
    },
    requirePasswordEverywhere: async () =>
      expectCount(await control({ type: "require_password_everywhere" })),
    setDirectFileTransfersEnabled: async (enabled) => {
      expectComplete(await control({ type: "set_direct_file_transfers", enabled }));
      return securityView(await control({ type: "inspect" }));
    },
    stopDirectFileTransfers: async () => {
      expectComplete(await control({ type: "stop_direct_file_transfers" }));
      return securityView(await control({ type: "inspect" }));
    },
    directFileSupported: () => options.transport()?.directFileSupported() ?? false,
    saveCompletedFile: (request) => {
      const transport = options.transport();
      if (transport === undefined) {
        return Promise.reject(new Error("remote file connection is unavailable"));
      }
      let expectedLength: bigint;
      try {
        expectedLength = BigInt(request.lengthBytes);
      } catch {
        return Promise.reject(new Error("remote file length is invalid"));
      }
      const sink = prepareDirectFileSink(request.fileName, expectedLength);
      return saveDirectFile(
        transport,
        {
          torrentId: request.torrentId,
          fileIndex: request.fileIndex,
          fileName: request.fileName,
          expectedLength,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
        },
        sink,
      );
    },
    playCompletedFile: async request => {
      const transport = options.transport();
      if (!transport) throw new Error("Remote file connection is unavailable.");
      const { playDirectFile } = await import("./direct-file-playback");
      return playDirectFile(transport, request);
    },
    clearHistory: async () => {
      expectComplete(await control({ type: "clear_history" }));
      return true;
    },
    signOutThisBrowser: async () => {
      try {
        const outcome = await control({ type: "sign_out_this_browser" });
        if (outcome.type !== "signed_out") {
          throw new Error("remote host returned the wrong sign-out result");
        }
      } finally {
        await options.store.clearAuthorization(options.username);
        await options.application.close();
        (options.reload ?? (() => window.location.reload()))();
      }
    },
  };
}

function expectComplete(outcome: RemoteControlOutcome): void {
  if (outcome.type !== "complete") {
    throw new Error("remote host returned the wrong operation result");
  }
}

function expectCount(outcome: RemoteControlOutcome): number {
  if (outcome.type !== "count") {
    throw new Error("remote host returned the wrong operation result");
  }
  return outcome.count;
}

function securityView(outcome: RemoteControlOutcome): RemoteSecurityView {
  if (outcome.type !== "security" || !isSecurityView(outcome.security)) {
    throw new Error("remote host returned an invalid security view");
  }
  return outcome.security;
}

function isSecurityView(value: unknown): value is RemoteSecurityView {
  if (!hasExactKeys(value, [
    "authority",
    "direct_file",
    "enabled",
    "host_pin",
    "live_circuits",
    "relay_id",
    "retained_history",
    "route",
    "username",
  ])) return false;
  const candidate = value as unknown as RemoteSecurityView;
  return (
    typeof candidate.enabled === "boolean" &&
    nullableString(candidate.username) &&
    nullableString(candidate.route) &&
    nullableString(candidate.relay_id) &&
    nullableString(candidate.host_pin) &&
    nullableSnapshot(candidate.authority) &&
    nullableSnapshot(candidate.retained_history) &&
    Array.isArray(candidate.live_circuits) &&
    candidate.live_circuits.every(isLiveCircuit)
    && isDirectFileSecurity(candidate.direct_file)
  );
}

function isDirectFileSecurity(value: unknown): boolean {
  if (!hasExactKeys(value, [
    "active_circuit_id", "active_requests", "active_tasks", "bytes_sent",
    "candidate_class", "compiled", "enabled", "open_sockets", "queued_bytes", "state",
  ])) return false;
  const direct = value as Record<string, unknown>;
  return typeof direct.compiled === "boolean" && typeof direct.enabled === "boolean" &&
    typeof direct.state === "string" && nullableString(direct.active_circuit_id) &&
    nullableString(direct.candidate_class) && numbers(direct, [
      "bytes_sent", "active_tasks", "open_sockets", "active_requests", "queued_bytes",
    ]);
}

function nullableSnapshot(value: unknown): boolean {
  if (value === null) return true;
  if (!hasExactKeys(value, [
    "authorization_generation",
    "clients",
    "events",
    "failed_attempts",
    "generation",
    "tombstones",
  ])) return false;
  const snapshot = value as RemoteSecurityView["authority"] & object;
  return (
    nonnegativeInteger(snapshot.generation) &&
    nonnegativeInteger(snapshot.authorization_generation) &&
    Array.isArray(snapshot.clients) && snapshot.clients.every(isAuthorizedClient) &&
    Array.isArray(snapshot.tombstones) && snapshot.tombstones.every(isTombstone) &&
    Array.isArray(snapshot.events) && snapshot.events.every(isSecurityEvent) &&
    Array.isArray(snapshot.failed_attempts) &&
    snapshot.failed_attempts.every(isFailedAttempt)
  );
}

function isAuthorizedClient(value: unknown): boolean {
  if (!hasExactKeys(value, [
    "absolute_expires", "browser_observation", "client_build", "client_id",
    "created", "fingerprint", "idle_expires", "label", "last_full_login",
    "last_resume", "last_seen", "route_observation", "state",
  ])) return false;
  const client = value as Record<string, unknown>;
  return strings(client, ["client_id", "label", "fingerprint"]) &&
    numbers(client, ["created", "last_full_login", "last_seen", "idle_expires", "absolute_expires"]) &&
    nullableNumber(client.last_resume) && nullableString(client.client_build) &&
    nullableString(client.route_observation) && nullableString(client.browser_observation) &&
    oneOf(client.state, ["current", "revoked", "expired"]);
}

function isTombstone(value: unknown): boolean {
  if (!hasExactKeys(value, [
    "client_id", "created", "ended", "fingerprint", "label", "last_seen", "state",
  ])) return false;
  const tombstone = value as Record<string, unknown>;
  return strings(tombstone, ["client_id", "label", "fingerprint"]) &&
    numbers(tombstone, ["created", "last_seen", "ended"]) &&
    oneOf(tombstone.state, ["current", "revoked", "expired"]);
}

function isSecurityEvent(value: unknown): boolean {
  if (!hasExactKeys(value, [
    "authentication_method", "circuit_id", "client_build", "client_id", "event_id",
    "direct_file", "kind", "reason_class", "result", "route", "timestamp",
  ])) return false;
  const event = value as Record<string, unknown>;
  return strings(event, ["event_id", "kind"]) && nonnegativeInteger(event.timestamp) &&
    oneOf(event.result, ["succeeded", "rejected"]) && nullableString(event.client_id) &&
    nullableString(event.circuit_id) &&
    (event.authentication_method === null || oneOf(event.authentication_method, ["password", "resume"])) &&
    nullableString(event.route) && nullableString(event.client_build) &&
    nullableString(event.reason_class) && nullableDirectFileAudit(event.direct_file);
}

function nullableDirectFileAudit(value: unknown): boolean {
  if (value === null) return true;
  if (!hasExactKeys(value, ["byte_count", "candidate_class", "file_index", "torrent_id"])) {
    return false;
  }
  const audit = value as Record<string, unknown>;
  return typeof audit.torrent_id === "string" && nonnegativeInteger(audit.file_index) &&
    nonnegativeInteger(audit.byte_count) && nullableString(audit.candidate_class);
}

function isFailedAttempt(value: unknown): boolean {
  if (!hasExactKeys(value, ["attempts", "bucket_start", "kind", "route_class"])) return false;
  const attempt = value as Record<string, unknown>;
  return nonnegativeInteger(attempt.bucket_start) &&
    oneOf(attempt.kind, ["password", "resume", "rate_limited"]) &&
    typeof attempt.route_class === "string" && nonnegativeInteger(attempt.attempts);
}

function isLiveCircuit(value: unknown): boolean {
  if (!hasExactKeys(value, [
    "authentication_method", "circuit_id", "client_id", "connection_generation",
    "last_activity", "route", "started",
  ])) return false;
  const circuit = value as Record<string, unknown>;
  return strings(circuit, ["circuit_id", "route"]) && nullableString(circuit.client_id) &&
    oneOf(circuit.authentication_method, ["password", "resume"]) &&
    numbers(circuit, ["connection_generation", "started", "last_activity"]);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): boolean {
  return value === null || nonnegativeInteger(value);
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function strings(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof record[key] === "string");
}

function numbers(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => nonnegativeInteger(record[key]));
}

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

function localOnly(): never {
  throw new Error("this remote security operation requires local host access");
}

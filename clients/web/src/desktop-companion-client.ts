import { message } from "./localization/runtime";
import { ApplicationViewError, type ApplicationViewClient } from "./api/client";
import type { ApiHello } from "./api/generated/v1";
import { ContractError } from "./validation";
import { clientIdentity, extensionVersion } from "./client-identity";
import { WebSocketApplicationViewClient } from "./websocket-view-client";

interface Ready {
  kind: "ready";
  endpoint: string;
  credential: string;
  instanceId: string;
  profileId: string;
}
interface BootstrapResponse {
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}
interface ChromeRuntime {
  sendMessage(message: unknown): Promise<BootstrapResponse>;
}

export class DesktopCompanionUnavailable extends Error {}

export function desktopRuntime(): ChromeRuntime {
  const runtime = (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (!runtime) throw new Error(message("desktop.companion.extension-only"));
  return runtime;
}

export function validateDesktopReady(value: unknown): Ready {
  const ready = value as Partial<Ready> | null;
  if (!ready || ready.kind !== "ready" || typeof ready.endpoint !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(ready.endpoint) ||
      Number(new URL(ready.endpoint).port) > 65535 ||
      typeof ready.credential !== "string" || !/^[0-9a-f]{64}$/.test(ready.credential) ||
      typeof ready.instanceId !== "string" || !/^[0-9a-f]{32}$/.test(ready.instanceId) ||
      ready.profileId !== "default") {
    throw new ApplicationViewError("invalid_version", message("desktop.companion.incompatible"));
  }
  return ready as Ready;
}

export function desktopBootstrapFailure(response: BootstrapResponse): Error {
  if (response.error?.code === "native_host_unavailable") {
    return new DesktopCompanionUnavailable(message("desktop.companion.setup-required"));
  }
  if (["unsupported_protocol", "unsupported_operation", "invalid_native_response"].includes(response.error?.code ?? "")) {
    return new ApplicationViewError("invalid_version", message("desktop.companion.incompatible"));
  }
  return new Error(response.error?.message ?? message("desktop.companion.stopped"));
}

export async function connectDesktopCompanion(signal: AbortSignal): Promise<{
  client: ApplicationViewClient; hello: ApiHello; disconnected: Promise<void>;
}> {
  // Always attach-only. Only the separate user Open/Start action can launch.
  const response = await desktopRuntime().sendMessage({ type: "nativeBootstrap", op: "attach_control" });
  if (signal.aborted) throw signal.reason;
  if (!response.ok) throw desktopBootstrapFailure(response);
  const ready = validateDesktopReady(response.result);
  let wasConnected = false;
  let disconnected!: () => void;
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  const socket = new WebSocketApplicationViewClient(ready.endpoint, ready.credential, undefined, undefined, {
    client: clientIdentity("extension", { version: extensionVersion() }),
    desktopRootPicker: true,
    platformClient: {
      async chooseDownloadRoot() { throw new Error(message("desktop.companion.native-folder")); },
      async close() {},
    },
    onConnectionState(active) {
      if (active) wasConnected = true;
      else if (wasConnected) disconnected();
    },
  });
  // Deliberately omit media/open-file authority until its desktop extension gate.
  const client: ApplicationViewClient = {
    hello: socket.hello.bind(socket), dispatch: socket.dispatch.bind(socket),
    addTorrentBytes: socket.addTorrentBytes.bind(socket),
    chooseDownloadRoot: socket.chooseDownloadRoot.bind(socket),
    openViewSet: socket.openViewSet.bind(socket), updateViewSet: socket.updateViewSet.bind(socket),
    streamUpdates: socket.streamUpdates.bind(socket), closeViewSet: socket.closeViewSet.bind(socket),
    close: socket.close.bind(socket),
  };
  try {
    const hello = await client.hello(signal);
    if (hello.backend?.kind !== "desktop" || hello.backend.instance_id !== ready.instanceId ||
        hello.backend.profile_id !== ready.profileId) {
      throw new ApplicationViewError("authentication_failed", message("desktop.companion.identity-changed"));
    }
    if (!hello.backend.capability_profile.includes("desktop_control_v1")) {
      throw new ApplicationViewError("invalid_version", message("desktop.companion.incompatible"));
    }
    return { client, hello, disconnected: closed };
  } catch (error) {
    await client.close();
    if (error instanceof ContractError) {
      throw new ApplicationViewError("invalid_version", message("desktop.companion.incompatible"));
    }
    throw error;
  }
}

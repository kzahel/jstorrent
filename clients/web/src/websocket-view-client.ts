import { message } from "./localization/runtime";
import type {
  AddTorrentBytesRequest,
  ApiClientInfo,
  ApiHello,
  ApplicationCall,
  ApplicationCallResult,
  ApplicationClientFrame,
  ApplicationServerFrame,
  ChooseDownloadRootRequest,
  CreateMediaUrlRequest,
  MediaUrlResponse,
  OpenViewSetRequest,
  OpenViewSetResponse,
  RequestEnvelope,
  ResponseEnvelope,
  StorageRootSnapshot,
  TorrentListImportReport,
  TorrentListImportTarget,
  UpdateBatch,
  UpdateViewSetRequest,
} from "./api";
import {
  ApplicationViewError,
  HttpApplicationClient,
  type ApplicationUpdateStream,
  type ApplicationViewClient,
  type MediaOpenTarget,
  validateTorrentByteUpload,
} from "./api/client";
import { UNSUPPORTED_CALL_MESSAGE } from "./api";
import { CompatibilityObservations, operationName } from "./compatibility-observations";
import { ContractError, decodeApplicationServerFrame } from "./validation";

const MAX_PENDING_CALLS = 16;
/** Aborted calls whose late reply is still expected and ignored. */
const MAX_ABANDONED_CALLS = 64;
const MAX_ATTACHMENTS = 8;
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
const INITIAL_RECONNECT_MILLIS = 250;
const MAXIMUM_RECONNECT_MILLIS = 2_000;
const NORMAL_CLOSE_MILLIS = 1_000;
const SOCKET_OPEN = 1;
const INVALID_APPLICATION_FRAME_CLOSE_CODE = 4_002;
const APPLICATION_CONNECTION_REJECTED_CLOSE_CODE = 4_008;

export interface ApplicationWebSocket {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type ApplicationWebSocketFactory = (
  url: string,
) => ApplicationWebSocket;

export interface ApplicationWebSocketPlatformClient {
  chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
    signal?: AbortSignal,
  ): Promise<StorageRootSnapshot | null>;
  prepareMediaOpen?(): MediaOpenTarget;
  exportTorrentList?(signal?: AbortSignal): Promise<boolean>;
  importTorrentBundle?(
    target: TorrentListImportTarget,
    chooseFile: () => Promise<ArrayBuffer | null>,
    signal?: AbortSignal,
  ): Promise<TorrentListImportReport | null>;
  close(): Promise<void>;
}

export interface ApplicationWebSocketClientOptions {
  readonly connectPath?: string;
  /** Sent in `connect`; hosts released before it ignore it. */
  readonly client?: ApiClientInfo;
  readonly platformClient?: ApplicationWebSocketPlatformClient;
  readonly desktopRootPicker?: boolean;
  readonly onConnectionState?: (connected: boolean) => void;
}

interface PendingCorrelation {
  /** What the call asked for, for compatibility observations. */
  readonly operation: string;
  readonly resolve: (frame: ApplicationServerFrame) => void;
  readonly reject: (error: Error) => void;
  readonly removeAbort: () => void;
  readonly upload?: {
    readonly uploadId: string;
    readonly source: ArrayBuffer;
    sent: boolean;
  };
}

type QueuedStreamItem =
  | { readonly type: "batch"; readonly batch: UpdateBatch }
  | { readonly type: "error"; readonly error: Error };

export class WebSocketApplicationViewClient
  implements ApplicationViewClient
{
  private readonly clientInstanceId: string;
  private readonly socketUrl: string;
  private readonly platformClient: ApplicationWebSocketPlatformClient;
  private readonly pending = new Map<string, PendingCorrelation>();
  // Calls aborted before their reply; the host still answers them.
  private readonly abandoned = new Set<string>();
  /** What this client saw from each host version; see Tactical 370. */
  public readonly compatibility = new CompatibilityObservations();
  private readonly streams = new Map<string, WebSocketUpdateStream>();
  private socket: ApplicationWebSocket | undefined;
  private connection: Promise<void> | undefined;
  private connectedHello: ApiHello | undefined;
  private connected = false;
  private closing = false;
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectNotBefore = 0;
  private nextCallId = 1;
  private nextUploadId = 1;
  private nextStreamId = 1;
  /** Present only when the platform client carries the bundle over HTTP. */
  public readonly exportTorrentList?: (signal?: AbortSignal) => Promise<boolean>;
  public readonly importTorrentBundle?: (
    target: TorrentListImportTarget,
    chooseFile: () => Promise<ArrayBuffer | null>,
    signal?: AbortSignal,
  ) => Promise<TorrentListImportReport | null>;

  public constructor(
    baseUrl: string,
    private readonly token: string | null,
    private readonly socketFactory: ApplicationWebSocketFactory = (url) =>
      new WebSocket(url),
    clientInstanceId: string = generateClientInstanceId(),
    private readonly options: ApplicationWebSocketClientOptions = {},
  ) {
    if (token !== null && (token.length === 0 || token.length > 128)) {
      throw new Error("gateway token must be 1..=128 characters");
    }
    if (!/^[0-9a-f]{32}$/.test(clientInstanceId)) {
      throw new Error(
        "gateway client instance ID must be 32 lowercase hexadecimal characters",
      );
    }
    this.clientInstanceId = clientInstanceId;
    const endpoint = new URL(options.connectPath ?? "/api/v1/connect", baseUrl);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.username = "";
    endpoint.password = "";
    endpoint.search = "";
    endpoint.hash = "";
    this.socketUrl = endpoint.href;
    this.platformClient =
      options.platformClient ??
      new HttpApplicationClient(
        baseUrl,
        token,
        globalThis.location?.origin ?? new URL(baseUrl).origin,
        undefined,
        undefined,
        clientInstanceId,
      );
    const platform = this.platformClient;
    const exportTorrentList = platform.exportTorrentList;
    if (exportTorrentList !== undefined) {
      this.exportTorrentList = async (signal) => {
        this.ensureOpen();
        return exportTorrentList.call(platform, signal);
      };
    }
    const importTorrentBundle = platform.importTorrentBundle;
    if (importTorrentBundle !== undefined) {
      this.importTorrentBundle = async (target, chooseFile, signal) => {
        this.ensureOpen();
        return importTorrentBundle.call(platform, target, chooseFile, signal);
      };
    }
  }

  public async hello(signal?: AbortSignal): Promise<ApiHello> {
    this.ensureOpen();
    if (this.connectedHello !== undefined) return this.connectedHello;
    await this.ensureConnected(signal);
    if (this.connectedHello === undefined) {
      throw new ContractError("connected frame did not include API hello");
    }
    return this.connectedHello;
  }

  public async dispatch(
    request: RequestEnvelope,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    const result = await this.call({ type: "dispatch", request }, signal);
    if (result.type !== "command_response") {
      throw new ContractError("dispatch returned the wrong result type");
    }
    return result.response;
  }

  public async addTorrentBytes(
    request: AddTorrentBytesRequest,
    source: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    this.ensureOpen();
    validateTorrentByteUpload(request, source);
    await this.ensureConnected(signal);
    if (this.pending.size >= MAX_PENDING_CALLS) {
      throw new ApplicationViewError(
        "resource_limit",
        "application connection pending call limit reached",
      );
    }
    const callId = this.allocateCallId();
    const uploadId = `upload-${this.nextUploadId++}`;
    const response = await new Promise<ApplicationServerFrame>((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(callId);
        this.pending.delete(callId);
        pending?.removeAbort();
        reject(new Error("torrent upload was aborted"));
        if (pending !== undefined) {
          this.socket?.close(1000, "torrent upload aborted");
        }
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(callId, {
        operation: "begin_torrent_upload",
        resolve,
        reject,
        removeAbort: () => signal?.removeEventListener("abort", abort),
        upload: { uploadId, source, sent: false },
      });
      try {
        this.send({
          type: "begin_torrent_upload",
          call_id: callId,
          upload_id: uploadId,
          request,
        });
      } catch (error) {
        const pending = this.pending.get(callId);
        this.pending.delete(callId);
        pending?.removeAbort();
        reject(asError(error));
      }
    });
    if (response.type !== "result" || response.result.type !== "command_response") {
      throw new ContractError("torrent upload returned the wrong result type");
    }
    return response.result.response;
  }

  public async chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
    signal?: AbortSignal,
  ): Promise<StorageRootSnapshot | null> {
    this.ensureOpen();
    if (this.options.desktopRootPicker) {
      await this.ensureConnected(signal);
      if (!this.connectedHello?.backend?.capability_profile.includes("desktop_root_picker_v1")) {
        throw new ApplicationViewError("invalid_call", message("desktop.companion.native-folder"));
      }
      const callId = this.allocateCallId();
      // Aborting this platform request closes its connection owner. OS Cancel
      // is an ordinary null result and leaves the connection intact.
      const abort = () => this.socket?.close(1000, "folder request aborted");
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const frame = await this.correlate(callId, { type: "choose_download_root", call_id: callId, request }, signal);
        if (frame.type !== "download_root_chosen") throw new ContractError("folder selection returned the wrong result type");
        return frame.response.root;
      } finally { signal?.removeEventListener("abort", abort); }
    }
    return this.platformClient.chooseDownloadRoot(request, signal);
  }

  public async createMediaUrl(
    request: CreateMediaUrlRequest,
    signal?: AbortSignal,
  ): Promise<MediaUrlResponse> {
    const result = await this.call(
      {
        type: "create_media_url",
        torrent_id: request.torrent_id,
        file_index: request.file_index,
      },
      signal,
    );
    if (result.type !== "media_url") {
      throw new ContractError("create media URL returned the wrong result type");
    }
    return result.response;
  }

  public prepareMediaOpen(): MediaOpenTarget {
    const prepare = this.platformClient.prepareMediaOpen;
    if (prepare === undefined) {
      throw new ApplicationViewError(
        "unsupported_capability",
        "opening files is unavailable on this connection",
      );
    }
    return prepare.call(this.platformClient);
  }

  public async openViewSet(
    request: OpenViewSetRequest,
    signal?: AbortSignal,
  ): Promise<OpenViewSetResponse> {
    const result = await this.call({ type: "open_view_set", request }, signal);
    if (result.type !== "view_set_opened") {
      throw new ContractError("open view set returned the wrong result type");
    }
    return result.response;
  }

  public async updateViewSet(
    viewSetId: string,
    request: UpdateViewSetRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.call(
      { type: "update_view_set", view_set_id: viewSetId, request },
      signal,
    );
    if (result.type !== "view_set_updated") {
      throw new ContractError("update view set returned the wrong result type");
    }
  }

  public async streamUpdates(
    viewSetId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<ApplicationUpdateStream> {
    this.ensureOpen();
    if (this.streams.size >= MAX_ATTACHMENTS) {
      throw new ApplicationViewError(
        "resource_limit",
        "application connection attachment limit reached",
      );
    }
    await this.ensureConnected(signal);
    const callId = this.allocateCallId();
    const streamId = `view-${this.nextStreamId++}`;
    const stream = new WebSocketUpdateStream(
      this,
      streamId,
      () => this.streams.delete(streamId),
      signal,
    );
    this.streams.set(streamId, stream);
    try {
      const response = await this.correlate(
        callId,
        {
          type: "attach",
          call_id: callId,
          stream_id: streamId,
          view_set_id: viewSetId,
          after,
        },
        signal,
      );
      if (response.type !== "attached" || response.stream_id !== streamId) {
        throw new ContractError("attach returned the wrong response type");
      }
      stream.markAttached();
      return stream;
    } catch (error) {
      stream.fail(asError(error));
      await stream.close();
      throw error;
    }
  }

  public async closeViewSet(
    viewSetId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.call(
      { type: "close_view_set", view_set_id: viewSetId },
      signal,
    );
    if (result.type !== "view_set_closed") {
      throw new ContractError("close view set returned the wrong result type");
    }
  }

  public async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    await Promise.all([...this.streams.values()].map((stream) => stream.close()));
    this.rejectPending(new Error("application WebSocket client is closing"));
    const socket = this.socket;
    if (socket !== undefined && socket.readyState === SOCKET_OPEN) {
      const closed = new Promise<void>((resolve) => {
        const previous = socket.onclose;
        socket.onclose = (event) => {
          previous?.(event);
          resolve();
        };
      });
      socket.close(1000, "application client closed");
      await Promise.race([
        closed,
        delay(NORMAL_CLOSE_MILLIS),
      ]);
    }
    this.closed = true;
    this.closing = false;
    this.connected = false;
    this.socket = undefined;
    await this.platformClient.close();
  }

  public sendAcknowledgement(streamId: string, cursor: string): void {
    this.send({ type: "ack", stream_id: streamId, cursor });
  }

  public async detach(streamId: string): Promise<void> {
    if (!this.connected || this.socket?.readyState !== SOCKET_OPEN) return;
    const callId = this.allocateCallId();
    const response = await this.correlate(
      callId,
      { type: "detach", call_id: callId, stream_id: streamId },
      undefined,
    );
    if (response.type !== "detached" || response.stream_id !== streamId) {
      throw new ContractError("detach returned the wrong response type");
    }
  }

  private async call(
    operation: ApplicationCall,
    signal?: AbortSignal,
  ): Promise<ApplicationCallResult> {
    this.ensureOpen();
    await this.ensureConnected(signal);
    const callId = this.allocateCallId();
    const response = await this.correlate(
      callId,
      { type: "call", call_id: callId, operation },
      signal,
    );
    if (response.type !== "result") {
      throw new ContractError("application call returned the wrong response type");
    }
    return response.result;
  }

  private correlate(
    callId: string,
    frame: ApplicationClientFrame,
    signal: AbortSignal | undefined,
  ): Promise<ApplicationServerFrame> {
    if (this.pending.size >= MAX_PENDING_CALLS) {
      return Promise.reject(
        new ApplicationViewError(
          "resource_limit",
          "application connection pending call limit reached",
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (this.pending.delete(callId)) this.abandon(callId);
        reject(new Error("application call was aborted"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(callId, {
        operation: operationName(frame),
        resolve,
        reject,
        removeAbort: () => signal?.removeEventListener("abort", abort),
      });
      try {
        this.send(frame);
      } catch (error) {
        const pending = this.pending.get(callId);
        this.pending.delete(callId);
        pending?.removeAbort();
        reject(asError(error));
      }
    });
  }

  private async ensureConnected(signal?: AbortSignal): Promise<void> {
    this.ensureOpen();
    if (this.connected && this.socket?.readyState === SOCKET_OPEN) return;
    if (this.connection !== undefined) return abortable(this.connection, signal);
    const connection = (async () => {
      const wait = Math.max(0, this.reconnectNotBefore - Date.now());
      if (wait > 0) await abortable(delay(wait), signal);
      await this.connectOnce(signal);
    })();
    this.connection = connection;
    try {
      await connection;
    } finally {
      if (this.connection === connection) this.connection = undefined;
    }
  }

  private connectOnce(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socketFactory(this.socketUrl);
      this.socket = socket;
      socket.binaryType = "arraybuffer";
      this.abandoned.clear();
      this.compatibility.connecting();
      let handshakeComplete = false;
      const failHandshake = (error: Error) => {
        if (handshakeComplete) return;
        handshakeComplete = true;
        reject(error);
      };
      const abort = () => {
        socket.close(1000, "connection attempt aborted");
        failHandshake(new Error("application connection was aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      socket.onopen = () => {
        try {
          this.send({
            type: "connect",
            api_version: 1,
            encoding: "json",
            client_instance_id: this.clientInstanceId,
            ...(this.token === null ? {} : { token: this.token }),
            ...(this.options.client === undefined ? {} : { client: this.options.client }),
          });
        } catch (error) {
          failHandshake(asError(error));
        }
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          this.protocolFailure(new ContractError("application frame is not text"));
          failHandshake(new ContractError("application frame is not text"));
          return;
        }
        let frame: ApplicationServerFrame;
        try {
          frame = decodeApplicationServerFrame(event.data);
        } catch (error) {
          this.compatibility.decodeFailure(handshakeComplete ? "frame" : "handshake");
          const failure = asError(error);
          this.protocolFailure(failure);
          failHandshake(failure);
          return;
        }
        if (!handshakeComplete) {
          if (frame.type === "connection_error") {
            const failure = connectionError(frame.error);
            failHandshake(failure);
            socket.close(
              APPLICATION_CONNECTION_REJECTED_CLOSE_CODE,
              "application connection rejected",
            );
            return;
          }
          if (frame.type !== "connected") {
            const failure = new ContractError(
              "connected must be the first server frame",
            );
            this.protocolFailure(failure);
            failHandshake(failure);
            return;
          }
          handshakeComplete = true;
          signal?.removeEventListener("abort", abort);
          this.connected = true;
          this.options.onConnectionState?.(true);
          this.connectedHello = frame.hello;
          this.compatibility.connected(frame.hello);
          this.reconnectAttempt = 0;
          this.reconnectNotBefore = 0;
          resolve();
          return;
        }
        this.route(frame);
      };
      socket.onerror = () => {
        failHandshake(new Error("application WebSocket connection failed"));
      };
      socket.onclose = () => {
        signal?.removeEventListener("abort", abort);
        if (this.socket !== socket) return;
        this.socket = undefined;
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this.options.onConnectionState?.(false);
        this.recordReconnectDelay();
        const failure = new ApplicationViewError(
          "connection_closed",
          "application WebSocket connection closed",
        );
        this.rejectPending(failure);
        for (const stream of this.streams.values()) stream.fail(failure);
        failHandshake(failure);
      };
    });
  }

  private route(frame: ApplicationServerFrame): void {
    switch (frame.type) {
      case "result": {
        const pending = this.pending.get(frame.call_id);
        if (pending?.upload !== undefined && !pending.upload.sent) {
          this.protocolFailure(
            new ContractError("torrent upload completed before binary transfer"),
          );
          return;
        }
        this.resolveCorrelation(frame.call_id, frame);
        break;
      }
      case "attached":
      case "detached":
      case "download_root_chosen":
        this.resolveCorrelation(frame.call_id, frame);
        break;
      case "call_error":
        this.rejectCorrelation(frame.call_id, connectionError(frame.error));
        break;
      case "torrent_upload_ready": {
        const pending = this.pending.get(frame.call_id);
        if (
          pending?.upload === undefined ||
          pending.upload.uploadId !== frame.upload_id ||
          pending.upload.sent
        ) {
          this.protocolFailure(
            new ContractError("torrent upload readiness has no matching call"),
          );
          return;
        }
        pending.upload.sent = true;
        try {
          this.sendBytes(pending.upload.source);
        } catch (error) {
          this.rejectCorrelation(frame.call_id, asError(error));
        }
        break;
      }
      case "view_batch": {
        const stream = this.streams.get(frame.stream_id);
        if (stream === undefined) {
          this.protocolFailure(
            new ContractError("view batch belongs to an unknown stream"),
          );
          return;
        }
        stream.push(frame.batch);
        break;
      }
      case "stream_error": {
        const stream = this.streams.get(frame.stream_id);
        stream?.fail(connectionError(frame.error));
        break;
      }
      case "connection_error":
        this.protocolFailure(connectionError(frame.error));
        break;
      case "connected":
        this.protocolFailure(new ContractError("connected frame was repeated"));
        break;
    }
  }

  private resolveCorrelation(
    callId: string,
    frame: ApplicationServerFrame,
  ): void {
    const pending = this.pending.get(callId);
    if (pending === undefined) {
      if (this.abandoned.delete(callId)) return;
      this.protocolFailure(new ContractError("response has no pending call"));
      return;
    }
    this.pending.delete(callId);
    pending.removeAbort();
    pending.resolve(frame);
  }

  private rejectCorrelation(callId: string, error: Error): void {
    const pending = this.pending.get(callId);
    if (pending === undefined) {
      if (this.abandoned.delete(callId)) return;
      this.protocolFailure(new ContractError("error has no pending call"));
      return;
    }
    if (
      error instanceof ApplicationViewError &&
      error.code === "invalid_call" &&
      error.detail === UNSUPPORTED_CALL_MESSAGE
    ) {
      this.compatibility.refusedCall(pending.operation);
    }
    this.pending.delete(callId);
    pending.removeAbort();
    pending.reject(error);
  }

  private abandon(callId: string): void {
    if (this.abandoned.size >= MAX_ABANDONED_CALLS) {
      const oldest = this.abandoned.values().next().value;
      if (oldest !== undefined) this.abandoned.delete(oldest);
    }
    this.abandoned.add(callId);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.removeAbort();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private protocolFailure(error: Error): void {
    this.rejectPending(error);
    for (const stream of this.streams.values()) stream.fail(error);
    this.socket?.close(
      INVALID_APPLICATION_FRAME_CLOSE_CODE,
      "invalid application frame",
    );
  }

  private send(frame: ApplicationClientFrame): void {
    const socket = this.socket;
    if (!this.connected && frame.type !== "connect") {
      throw new ApplicationViewError(
        "connection_closed",
        "application WebSocket is not connected",
      );
    }
    if (socket === undefined || socket.readyState !== SOCKET_OPEN) {
      throw new ApplicationViewError(
        "connection_closed",
        "application WebSocket is not open",
      );
    }
    const encoded = JSON.stringify(frame);
    if (new TextEncoder().encode(encoded).byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      throw new ApplicationViewError(
        "invalid_call",
        "application message exceeds the client bound",
      );
    }
    socket.send(encoded);
  }

  private sendBytes(source: ArrayBuffer): void {
    const socket = this.socket;
    if (!this.connected || socket === undefined || socket.readyState !== SOCKET_OPEN) {
      throw new ApplicationViewError(
        "connection_closed",
        "application WebSocket is not open",
      );
    }
    socket.send(source);
  }

  private allocateCallId(): string {
    return `call-${this.nextCallId++}`;
  }

  private recordReconnectDelay(): void {
    if (this.closed || this.closing) return;
    const backoff = Math.min(
      INITIAL_RECONNECT_MILLIS * 2 ** this.reconnectAttempt,
      MAXIMUM_RECONNECT_MILLIS,
    );
    this.reconnectAttempt += 1;
    this.reconnectNotBefore = Date.now() + backoff;
  }

  private ensureOpen(): void {
    if (this.closed || this.closing) {
      throw new Error("application WebSocket client is closed");
    }
  }
}

export class WebSocketUpdateStream implements ApplicationUpdateStream {
  private readonly queue: QueuedStreamItem[] = [];
  private waiter:
    | ((result: IteratorResult<QueuedStreamItem>) => void)
    | undefined;
  private previousCursor: string | undefined;
  private attached = false;
  private closed = false;

  public constructor(
    private readonly client: WebSocketApplicationViewClient,
    private readonly streamId: string,
    private readonly onClose: () => void,
    signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => void this.close(), { once: true });
  }

  public markAttached(): void {
    this.attached = true;
  }

  public push(batch: UpdateBatch): void {
    this.enqueue({ type: "batch", batch });
  }

  public fail(error: Error): void {
    this.enqueue({ type: "error", error });
  }

  public [Symbol.asyncIterator](): AsyncIterator<UpdateBatch> {
    return {
      next: () => this.next(),
      return: async () => {
        await this.close();
        return { done: true, value: undefined };
      },
    };
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    this.waiter?.({ done: true, value: undefined });
    this.waiter = undefined;
    this.onClose();
    if (this.attached) {
      try {
        await this.client.detach(this.streamId);
      } catch (error) {
        const failure = asError(error);
        if (
          !(failure instanceof ApplicationViewError) ||
          (failure.code !== "unknown_stream" &&
            failure.code !== "view_set_closed" &&
            failure.code !== "connection_closed")
        ) {
          throw failure;
        }
      }
    }
  }

  private enqueue(item: QueuedStreamItem): void {
    if (this.closed) return;
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter({ done: false, value: item });
      return;
    }
    if (this.queue.length >= 1) {
      this.queue.length = 0;
      this.queue.push({
        type: "error",
        error: new ContractError(
          "WebSocket stream delivered more than one unacknowledged event",
        ),
      });
      return;
    }
    this.queue.push(item);
  }

  private async next(): Promise<IteratorResult<UpdateBatch>> {
    if (this.closed) return { done: true, value: undefined };
    if (this.previousCursor !== undefined) {
      this.client.sendAcknowledgement(this.streamId, this.previousCursor);
      this.previousCursor = undefined;
    }
    const item = await this.take();
    if (item.done) return { done: true, value: undefined };
    if (item.value.type === "error") throw item.value.error;
    this.previousCursor = item.value.batch.cursor;
    return { done: false, value: item.value.batch };
  }

  private take(): Promise<IteratorResult<QueuedStreamItem>> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve({ done: false, value: queued });
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiter !== undefined) {
      return Promise.reject(
        new Error("WebSocket stream already has a waiting consumer"),
      );
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

function connectionError(error: {
  readonly code: string;
  readonly message: string;
}): ApplicationViewError {
  return new ApplicationViewError(error.code, error.message);
}

function generateClientInstanceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function delay(millis: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, millis));
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(new Error("operation was aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("operation was aborted"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

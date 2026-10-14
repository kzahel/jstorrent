import {
  Channel,
  invoke,
  type InvokeArgs,
  type InvokeOptions,
} from "@tauri-apps/api/core";

import type {
  AddTorrentBytesRequest,
  ApiHello,
  ChooseDownloadRootRequest,
  CreateMediaUrlRequest,
  ExternalTorrentAddRequest,
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
  type ApplicationUpdateStream,
  type ApplicationViewClient,
  type MediaOpenTarget,
  validateTorrentByteUpload,
} from "./api/client";
import {
  ContractError,
  decodeApiHello,
  decodeOpenViewSetResponse,
  decodeMediaUrlResponse,
  decodeResponseEnvelope,
  decodeUpdateBatch,
  validateTorrentListImportReport,
} from "./validation";

const MAX_STREAM_ID_BYTES = 128;
const MAX_ERROR_BYTES = 1_024;
const STREAM_ID = /^[A-Za-z0-9._-]+$/;

interface TauriChannel<T> {
  onmessage: (message: T) => void;
}

export interface TauriViewBridge {
  invoke<T>(
    command: string,
    arguments_?: InvokeArgs,
    options?: InvokeOptions,
  ): Promise<T>;
  createChannel<T>(): TauriChannel<T>;
}

type DesktopStreamEvent =
  | { readonly type: "batch"; readonly batch: unknown }
  | { readonly type: "error"; readonly error: unknown };

type QueuedStreamItem =
  | { readonly type: "batch"; readonly batch: UpdateBatch }
  | { readonly type: "error"; readonly error: Error };

const defaultBridge: TauriViewBridge = {
  invoke: <T>(command: string, arguments_?: InvokeArgs, options?: InvokeOptions) =>
    invoke<T>(command, arguments_, options),
  createChannel: <T>() => new Channel<T>(),
};

export class TauriApplicationViewClient implements ApplicationViewClient {
  private readonly streams = new Set<TauriUpdateStream>();
  private closed = false;

  public constructor(private readonly bridge: TauriViewBridge = defaultBridge) {}

  public async hello(): Promise<ApiHello> {
    this.ensureOpen();
    return decodeStructured(
      await this.invoke<unknown>("application_view_hello"),
      decodeApiHello,
      "Tauri API hello",
    );
  }

  public async dispatch(request: RequestEnvelope): Promise<ResponseEnvelope> {
    this.ensureOpen();
    return decodeStructured(
      await this.invoke<unknown>("application_dispatch", { request }),
      decodeResponseEnvelope,
      "Tauri command response",
    );
  }

  public async addTorrentBytes(
    request: AddTorrentBytesRequest,
    source: ArrayBuffer,
  ): Promise<ResponseEnvelope> {
    this.ensureOpen();
    validateTorrentByteUpload(request, source);
    const headers: Record<string, string> = {
      "x-rstorrent-request-id": request.request_id,
      "x-rstorrent-storage-root": request.storage_root,
      "x-rstorrent-start-content": String(request.start_content),
      "x-rstorrent-await-file-selection": String(
        request.await_file_selection,
      ),
      "x-rstorrent-selection":
        request.selection.type === "wanted_ranges"
          ? "ranges"
          : request.selection.type,
    };
    if (request.expected_revision != null) {
      headers["x-rstorrent-expected-revision"] = request.expected_revision;
    }
    if (request.selection.type === "wanted_ranges") {
      headers["x-rstorrent-wanted-ranges"] = request.selection.ranges
        .map((range) => `${range.start}-${range.end_exclusive}`)
        .join(",");
    }
    return decodeStructured(
      await this.invoke<unknown>(
        "application_add_torrent_bytes",
        source,
        { headers },
      ),
      decodeResponseEnvelope,
      "Tauri torrent intake response",
    );
  }

  public async addExternalTorrent(
    request: ExternalTorrentAddRequest,
  ): Promise<ResponseEnvelope> {
    this.ensureOpen();
    return decodeStructured(
      await this.invoke<unknown>("application_add_external_torrent", {
        activationId: request.activation_id,
        requestId: request.request_id,
        storageRoot: request.storage_root,
        startContent: request.start_content,
        awaitFileSelection: request.await_file_selection,
      }),
      decodeResponseEnvelope,
      "Tauri external torrent intake response",
    );
  }

  public async chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
  ): Promise<StorageRootSnapshot | null> {
    this.ensureOpen();
    return this.invoke<StorageRootSnapshot | null>("choose_download_root", {
      repairRoot: request.repair_root ?? null,
    });
  }

  public async createMediaUrl(
    request: CreateMediaUrlRequest,
  ): Promise<MediaUrlResponse> {
    this.ensureOpen();
    return decodeStructured(
      await this.invoke<unknown>("application_create_media_url", {
        torrentId: request.torrent_id,
        fileIndex: request.file_index,
      }),
      decodeMediaUrlResponse,
      "Tauri media URL response",
    );
  }

  public prepareMediaOpen(): MediaOpenTarget {
    this.ensureOpen();
    let active = true;
    return {
      open: async (url) => {
        if (!active) throw new Error("media open target is no longer available");
        active = false;
        await this.invoke("application_open_media_url", { url });
      },
      cancel: () => {
        active = false;
      },
    };
  }

  public async openViewSet(
    request: OpenViewSetRequest,
    _signal?: AbortSignal,
  ): Promise<OpenViewSetResponse> {
    this.ensureOpen();
    return decodeStructured(
      await this.invoke<unknown>("application_view_open", { request }),
      decodeOpenViewSetResponse,
      "Tauri open view-set response",
    );
  }

  public async updateViewSet(
    viewSetId: string,
    request: UpdateViewSetRequest,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.ensureOpen();
    await this.invoke("application_view_update", { viewSetId, request });
  }

  public async streamUpdates(
    viewSetId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<ApplicationUpdateStream> {
    this.ensureOpen();
    const channel = this.bridge.createChannel<unknown>();
    const stream = new TauriUpdateStream(
      this.bridge,
      channel,
      () => this.streams.delete(stream),
      signal,
    );
    channel.onmessage = (message) => stream.push(message);
    let streamId: string;
    try {
      streamId = await this.invoke<string>("application_view_stream", {
        viewSetId,
        after,
        updates: channel,
      });
      validateStreamId(streamId);
      await stream.attach(streamId);
    } catch (error) {
      await stream.close();
      throw normalizeTauriError(error);
    }
    if (signal?.aborted) {
      await stream.close();
      throw new Error("application update stream was aborted");
    }
    this.streams.add(stream);
    return stream;
  }

  public async closeViewSet(
    viewSetId: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.ensureOpen();
    await this.invoke("application_view_close", { viewSetId });
  }

  /** Rust shows the save dialog and writes the file; no bytes cross IPC. */
  public async exportTorrentList(): Promise<boolean> {
    this.ensureOpen();
    const saved = await this.invoke<unknown>("desktop_export_torrent_list");
    if (typeof saved !== "boolean") {
      throw new ContractError("Tauri torrent list export result is invalid");
    }
    return saved;
  }

  /** Rust shows the open dialog and reads the file, so `chooseFile` is unused. */
  public async importTorrentBundle(
    target: TorrentListImportTarget,
  ): Promise<TorrentListImportReport | null> {
    this.ensureOpen();
    const report = await this.invoke<unknown>("desktop_import_torrent_bundle", {
      target: {
        storage_root: target.storage_root,
        keep_matching_locations: target.keep_matching_locations,
      },
    });
    return report === null ? null : validateTorrentListImportReport(report);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.streams].map((stream) => stream.close()));
    this.streams.clear();
  }

  private async invoke<T>(
    command: string,
    arguments_?: InvokeArgs,
    options?: InvokeOptions,
  ): Promise<T> {
    try {
      return await this.bridge.invoke<T>(command, arguments_, options);
    } catch (error) {
      throw normalizeTauriError(error);
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("Tauri application client is closed");
  }
}

export class TauriUpdateStream implements ApplicationUpdateStream {
  private readonly queue: QueuedStreamItem[] = [];
  private waiter:
    | ((result: IteratorResult<QueuedStreamItem>) => void)
    | undefined;
  private streamId: string | undefined;
  private previousCursor: string | undefined;
  private closed = false;
  private remoteClosed = false;

  public constructor(
    private readonly bridge: TauriViewBridge,
    private readonly channel: TauriChannel<unknown>,
    private readonly onClose: () => void,
    signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => void this.close(), { once: true });
  }

  public async attach(streamId: string): Promise<void> {
    if (this.streamId !== undefined) {
      throw new Error("Tauri view stream is already attached");
    }
    validateStreamId(streamId);
    this.streamId = streamId;
    if (this.closed) await this.closeRemote();
  }

  public push(message: unknown): void {
    if (this.closed) return;
    let item: QueuedStreamItem;
    try {
      const event = decodeDesktopStreamEvent(message);
      item =
        event.type === "batch"
          ? {
              type: "batch",
              batch: decodeStructured(
                event.batch,
                decodeUpdateBatch,
                "Tauri view batch",
              ),
            }
          : { type: "error", error: decodeDesktopError(event.error) };
    } catch (error) {
      item = { type: "error", error: asError(error) };
    }
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
          "Tauri stream delivered more than one unacknowledged event",
        ),
      });
      return;
    }
    this.queue.push(item);
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
    if (!this.closed) {
      this.closed = true;
      this.channel.onmessage = () => {};
      this.queue.length = 0;
      this.waiter?.({ done: true, value: undefined });
      this.waiter = undefined;
      this.onClose();
    }
    await this.closeRemote();
  }

  private async next(): Promise<IteratorResult<UpdateBatch>> {
    if (this.closed) return { done: true, value: undefined };
    if (this.previousCursor !== undefined) {
      const cursor = this.previousCursor;
      const streamId = this.requireStreamId();
      try {
        await this.bridge.invoke("application_view_stream_ack", {
          streamId,
          cursor,
        });
      } catch (error) {
        throw normalizeTauriError(error);
      }
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
      return Promise.reject(new Error("Tauri stream already has a waiting consumer"));
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private async closeRemote(): Promise<void> {
    if (this.remoteClosed || this.streamId === undefined) return;
    this.remoteClosed = true;
    try {
      await this.bridge.invoke("application_view_stream_close", {
        streamId: this.streamId,
      });
    } catch (error) {
      const failure = normalizeTauriError(error);
      if (
        !(failure instanceof ApplicationViewError) ||
        (failure.code !== "unknown_view_stream" &&
          failure.code !== "view_set_closed")
      ) {
        throw failure;
      }
    }
  }

  private requireStreamId(): string {
    if (this.streamId === undefined) {
      throw new Error("Tauri view stream is not attached");
    }
    return this.streamId;
  }
}

function decodeDesktopStreamEvent(value: unknown): DesktopStreamEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError("Tauri stream event is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.type === "batch" && "batch" in record) {
    return { type: "batch", batch: record.batch };
  }
  if (record.type === "error" && "error" in record) {
    return { type: "error", error: record.error };
  }
  throw new ContractError("Tauri stream event has an unknown type");
}

function decodeDesktopError(value: unknown): ApplicationViewError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError("Tauri adapter error is not an object");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    record.code.length === 0 ||
    record.code.length > 64 ||
    !/^[a-z0-9_]+$/.test(record.code) ||
    typeof record.message !== "string" ||
    record.message.length === 0 ||
    new TextEncoder().encode(record.message).byteLength > MAX_ERROR_BYTES
  ) {
    throw new ContractError("Tauri adapter error is invalid");
  }
  return new ApplicationViewError(record.code, record.message);
}

function normalizeTauriError(value: unknown): Error {
  if (value instanceof Error) return value;
  try {
    return decodeDesktopError(value);
  } catch {
    return new Error(typeof value === "string" ? value : "Tauri invocation failed");
  }
}

function decodeStructured<T>(
  value: unknown,
  decoder: (source: string) => T,
  label: string,
): T {
  let source: string | undefined;
  try {
    source = JSON.stringify(value);
  } catch {
    throw new ContractError(`${label} is not JSON-compatible`);
  }
  if (source === undefined) {
    throw new ContractError(`${label} is missing`);
  }
  return decoder(source);
}

function validateStreamId(streamId: string): void {
  if (
    streamId.length === 0 ||
    new TextEncoder().encode(streamId).byteLength > MAX_STREAM_ID_BYTES ||
    !STREAM_ID.test(streamId)
  ) {
    throw new ContractError("Tauri view stream ID is invalid");
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

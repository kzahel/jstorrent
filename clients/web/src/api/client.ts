import type {
  AddTorrentBytesRequest,
  ApiHello,
  ChooseDownloadRootRequest,
  CreateMediaUrlRequest,
  MediaUrlResponse,
  StorageRootSnapshot,
  TorrentListImportReport,
  TorrentListImportTarget,
  OpenViewSetRequest,
  OpenViewSetResponse,
  RequestEnvelope,
  ResponseEnvelope,
  UpdateBatch,
  UpdateViewSetRequest,
} from "./generated/v1";
import type { CompatibilityObservations } from "../compatibility-observations";
import { JsonApiCodec, type ApiCodec } from "./codec";
import {
  isAbortError,
  prepareBrowserFileSink,
  type BrowserFileSink,
} from "../browser-file-save";
import {
  decodeApiErrorEnvelope,
  decodeApiHello,
  decodeChooseDownloadRootResponse,
  decodeMediaUrlResponse,
  decodeOpenViewSetResponse,
  decodeResponseEnvelope,
  decodeTorrentListImportReport,
  decodeUpdateBatch,
} from "../validation";

import {
  ApplicationViewError,
  HttpApiError,
  MAX_TORRENT_LIST_BUNDLE_BYTES,
} from "./errors";

export { ApplicationViewError, HttpApiError, MAX_TORRENT_LIST_BUNDLE_BYTES };

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const TORRENT_LIST_FILE_NAME = "jstorrent-torrents.zip";

export interface ApplicationViewClient {
  /** Native shell already supplies the update UI controller. */
  readonly nativeUpdateUi?: boolean;
  productUpdate?(request: import("./generated/v1").HostUpdateRequest): Promise<import("./generated/v1").HostUpdateSnapshot>;
  /** Mismatch observations, on transports that keep them (Tactical 370). */
  readonly compatibility?: CompatibilityObservations;
  hello(signal?: AbortSignal): Promise<ApiHello>;
  dispatch(
    request: RequestEnvelope,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope>;
  addTorrentBytes?(
    request: AddTorrentBytesRequest,
    source: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope>;
  addExternalTorrent?(
    request: ExternalTorrentAddRequest,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope>;
  chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
    signal?: AbortSignal,
  ): Promise<StorageRootSnapshot | null>;
  createMediaUrl?(
    request: CreateMediaUrlRequest,
    signal?: AbortSignal,
  ): Promise<MediaUrlResponse>;
  prepareMediaOpen?(): MediaOpenTarget;
  openViewSet(
    request: OpenViewSetRequest,
    signal?: AbortSignal,
  ): Promise<OpenViewSetResponse>;
  updateViewSet(
    viewSetId: string,
    request: UpdateViewSetRequest,
    signal?: AbortSignal,
  ): Promise<void>;
  nextUpdates?(
    viewSetId: string,
    after: string,
    waitMillis: number,
    signal?: AbortSignal,
  ): Promise<UpdateBatch>;
  streamUpdates?(
    viewSetId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<ApplicationUpdateStream>;
  closeViewSet(viewSetId: string, signal?: AbortSignal): Promise<void>;
  /**
   * Saves the whole torrent list as a bundle where the user chooses.
   * Resolves false when the user cancels. Call from a user activation.
   */
  exportTorrentList?(signal?: AbortSignal): Promise<boolean>;
  /**
   * Imports a bundle. `chooseFile` asks the user for the bundle bytes where
   * the page reads the file itself; clients with a native picker ignore it.
   * Resolves null when the user cancels.
   */
  importTorrentBundle?(
    target: TorrentListImportTarget,
    chooseFile: () => Promise<ArrayBuffer | null>,
    signal?: AbortSignal,
  ): Promise<TorrentListImportReport | null>;
  close(): Promise<void>;
}

export interface ExternalTorrentAddRequest {
  readonly activation_id: string;
  readonly request_id: string;
  readonly storage_root: string;
  readonly start_content: boolean;
  readonly await_file_selection: boolean;
}

export interface MediaOpenTarget {
  open(url: string): Promise<void>;
  cancel(): void;
}

export interface ApplicationUpdateStream extends AsyncIterable<UpdateBatch> {
  close(): Promise<void>;
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class HttpApplicationClient implements ApplicationViewClient {
  private closed = false;
  private readonly ownerId: string;

  public constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly origin: string,
    private readonly fetchImplementation: FetchImplementation = (input, init) =>
      globalThis.fetch(input, init),
    private readonly codec: ApiCodec = new JsonApiCodec(),
    ownerId: string = generateOwnerId(),
  ) {
    if (token !== null && (token.length === 0 || token.length > 128)) {
      throw new Error("gateway token must be 1..=128 characters");
    }
    if (origin.length === 0 || origin.length > 512) {
      throw new Error("gateway origin must be 1..=512 characters");
    }
    if (!/^[0-9a-f]{32}$/.test(ownerId)) {
      throw new Error("gateway owner ID must be 32 lowercase hexadecimal characters");
    }
    this.ownerId = ownerId;
  }

  public async hello(signal?: AbortSignal): Promise<ApiHello> {
    return this.request("GET", "/api/v1/hello", undefined, decodeApiHello, signal);
  }

  public async dispatch(
    request: RequestEnvelope,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    return this.request(
      "POST",
      "/api/v1/commands",
      request,
      decodeResponseEnvelope,
      signal,
    );
  }

  public async addTorrentBytes(
    request: AddTorrentBytesRequest,
    source: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    validateTorrentByteUpload(request, source);
    const query = new URLSearchParams({
      request_id: request.request_id,
      storage_root: request.storage_root,
      start_content: String(request.start_content),
    });
    if (request.expected_revision != null) {
      query.set("expected_revision", request.expected_revision);
    }
    query.set(
      "selection",
      request.selection.type === "wanted_ranges"
        ? "ranges"
        : request.selection.type,
    );
    if (request.selection.type === "wanted_ranges") {
      query.set(
        "wanted_ranges",
        request.selection.ranges
          .map((range) => `${range.start}-${range.end_exclusive}`)
          .join(","),
      );
    }
    const response = await this.sendRaw(
      "POST",
      `/api/v1/torrents?${query}`,
      source,
      signal,
    );
    const encoded = await boundedResponseText(response);
    if (!response.ok) throw decodeHttpError(response.status, encoded);
    return this.codec.decodeResponse(encoded, decodeResponseEnvelope);
  }

  public async chooseDownloadRoot(
    request: ChooseDownloadRootRequest,
    signal?: AbortSignal,
  ): Promise<StorageRootSnapshot | null> {
    const response = await this.request(
      "POST",
      "/api/v1/platform/download-root",
      request,
      decodeChooseDownloadRootResponse,
      signal,
    );
    return response.root;
  }

  public async createMediaUrl(
    request: CreateMediaUrlRequest,
    signal?: AbortSignal,
  ): Promise<MediaUrlResponse> {
    return this.request(
      "POST",
      "/api/v1/media-urls",
      request,
      decodeMediaUrlResponse,
      signal,
    );
  }

  public prepareMediaOpen(): MediaOpenTarget {
    return prepareBrowserMediaOpen();
  }

  public async openViewSet(
    request: OpenViewSetRequest,
    signal?: AbortSignal,
  ): Promise<OpenViewSetResponse> {
    return this.request(
      "POST",
      "/api/v1/view-sets",
      request,
      decodeOpenViewSetResponse,
      signal,
    );
  }

  public async updateViewSet(
    viewSetId: string,
    request: UpdateViewSetRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestWithoutBody(
      "PUT",
      `/api/v1/view-sets/${encodeURIComponent(viewSetId)}/views`,
      request,
      signal,
    );
  }

  public async nextUpdates(
    viewSetId: string,
    after: string,
    waitMillis: number,
    signal?: AbortSignal,
  ): Promise<UpdateBatch> {
    const query = new URLSearchParams({
      after,
      wait_ms: String(waitMillis),
    });
    return this.request(
      "GET",
      `/api/v1/view-sets/${encodeURIComponent(viewSetId)}/updates?${query}`,
      undefined,
      decodeUpdateBatch,
      signal,
    );
  }

  public async closeViewSet(
    viewSetId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestWithoutBody(
      "DELETE",
      `/api/v1/view-sets/${encodeURIComponent(viewSetId)}`,
      undefined,
      signal,
    );
  }

  public async exportTorrentList(signal?: AbortSignal): Promise<boolean> {
    if (this.closed) throw new Error("gateway client is closed");
    // The picker opens before the download, while the click still counts as
    // a user activation.
    let sink: BrowserFileSink;
    try {
      sink = await prepareBrowserFileSink(TORRENT_LIST_FILE_NAME, null, {
        blobLimit: MAX_TORRENT_LIST_BUNDLE_BYTES,
        tooLarge: () => new Error("torrent list exceeds the client bound"),
        types: [
          {
            description: "ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
    } catch (error) {
      if (isAbortError(error)) return false;
      throw error;
    }
    try {
      const response = await this.fetchImplementation(
        new URL("/api/v1/torrent-list/export", this.baseUrl),
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/zip, application/json",
            Origin: this.origin,
            "X-RSTorrent-Owner": this.ownerId,
            ...(this.token === null
              ? {}
              : { Authorization: `Bearer ${this.token}` }),
          },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (!response.ok) {
        throw decodeHttpError(response.status, await boundedResponseText(response));
      }
      if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/zip") {
        throw new Error("torrent list export did not return a ZIP file");
      }
      await sink.write(
        await boundedResponseBytes(response, MAX_TORRENT_LIST_BUNDLE_BYTES),
      );
      await sink.close();
      return true;
    } catch (error) {
      await sink.abort();
      throw error;
    }
  }

  public async importTorrentBundle(
    target: TorrentListImportTarget,
    chooseFile: () => Promise<ArrayBuffer | null>,
    signal?: AbortSignal,
  ): Promise<TorrentListImportReport | null> {
    if (this.closed) throw new Error("gateway client is closed");
    const bundle = await chooseFile();
    if (bundle === null) return null;
    validateTorrentListBundle(bundle);
    const query = new URLSearchParams({
      storage_root: target.storage_root,
      keep_matching_locations: String(target.keep_matching_locations),
    });
    const response = await this.sendRaw(
      "POST",
      `/api/v1/torrent-list/import?${query}`,
      bundle,
      signal,
      "application/zip",
    );
    const source = await boundedResponseText(response);
    if (!response.ok) throw decodeHttpError(response.status, source);
    return this.codec.decodeResponse(source, decodeTorrentListImportReport);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    decoder: (source: string) => T,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const response = await this.send(method, path, body, signal);
    const source = await boundedResponseText(response);
    if (!response.ok) throw decodeHttpError(response.status, source);
    return this.codec.decodeResponse(source, decoder);
  }

  private async requestWithoutBody(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const response = await this.send(method, path, body, signal);
    const source = await boundedResponseText(response);
    if (!response.ok) throw decodeHttpError(response.status, source);
    if (source.length !== 0) {
      throw new Error("no-content API response unexpectedly carried a body");
    }
  }

  private send(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    if (this.closed) return Promise.reject(new Error("gateway client is closed"));
    const encoded = body === undefined ? undefined : this.codec.encodeRequest(body);
    return this.fetchImplementation(new URL(path, this.baseUrl), {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        Origin: this.origin,
        "X-RSTorrent-Owner": this.ownerId,
        ...(this.token === null
          ? {}
          : { Authorization: `Bearer ${this.token}` }),
        ...(encoded === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(encoded === undefined ? {} : { body: encoded }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private sendRaw(
    method: string,
    path: string,
    body: ArrayBuffer,
    signal: AbortSignal | undefined,
    contentType = "application/x-bittorrent",
  ): Promise<Response> {
    if (this.closed) return Promise.reject(new Error("gateway client is closed"));
    return this.fetchImplementation(new URL(path, this.baseUrl), {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        Origin: this.origin,
        "X-RSTorrent-Owner": this.ownerId,
        "Content-Type": contentType,
        ...(this.token === null
          ? {}
          : { Authorization: `Bearer ${this.token}` }),
      },
      body,
      ...(signal === undefined ? {} : { signal }),
    });
  }
}

export function prepareBrowserMediaOpen(): MediaOpenTarget {
  const popup = globalThis.window?.open("about:blank", "_blank");
  if (popup === undefined || popup === null) {
    throw new ApplicationViewError(
      "popup_blocked",
      "Allow pop-ups to open this file in a new tab",
    );
  }
  popup.opener = null;
  let active = true;
  return {
    open: async (url) => {
      if (!active) throw new Error("media tab is no longer available");
      active = false;
      popup.location.replace(url);
    },
    cancel: () => {
      if (!active) return;
      active = false;
      popup.close();
    },
  };
}

export function validateTorrentByteUpload(
  request: AddTorrentBytesRequest,
  source: ArrayBuffer,
): void {
  const maximumSourceBytes = 64 * 1024 * 1024;
  if (source.byteLength === 0 || source.byteLength > maximumSourceBytes) {
    throw new ApplicationViewError(
      "resource_limit",
      "torrent source must contain 1..=67108864 bytes",
    );
  }
  if (request.source_length !== source.byteLength) {
    throw new ApplicationViewError(
      "invalid_call",
      "torrent source length does not match the request",
    );
  }
}

export function validateTorrentListBundle(bundle: ArrayBuffer): void {
  if (bundle.byteLength === 0 || bundle.byteLength > MAX_TORRENT_LIST_BUNDLE_BYTES) {
    throw new ApplicationViewError(
      "resource_limit",
      "torrent list must contain 1..=268435456 bytes",
    );
  }
}

function generateOwnerId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new Error("gateway response exceeds the client bound");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("gateway response exceeds the client bound");
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function boundedResponseBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximum) {
    throw new Error("gateway response exceeds the client bound");
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error("gateway response exceeds the client bound");
    }
    chunks.push(chunk.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeHttpError(status: number, source: string): Error {
  try {
    const envelope = decodeApiErrorEnvelope(source);
    return new HttpApiError(status, envelope.error.code, envelope.error.message);
  } catch (error) {
    return new HttpApiError(
      status,
      "invalid_error_response",
      error instanceof Error ? error.message : String(error),
    );
  }
}

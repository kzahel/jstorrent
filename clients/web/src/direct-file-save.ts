import { prepareBrowserFileSink, type BrowserFileSink } from "./browser-file-save";
import { openDirectFileConnection } from "./direct-file-connection";
import { negotiateRangeStream, type RangeStreamOptions } from "./direct-file-range-stream";
import type {
  RemoteApplicationWebSocket,
} from "./remote-application-websocket";

const BLOB_FALLBACK_LIMIT = 32 * 1024 * 1024;
const MAX_RANGE_LENGTH = 0xffff_ffffn;
const PROTOCOL_VERSION = 1;
const RANGE_REQUEST = 0x01;
const CANCEL_REQUEST = 0x02;
const CHUNK_ACK = 0x03;
const RANGE_ACCEPTED = 0x81;
const RANGE_CHUNK = 0x82;
const RANGE_COMPLETE = 0x83;
const RANGE_ERROR = 0xff;
// Independent defense against a faulty host, including queued control frames.
// The host's four-chunk send window normally holds at most 64 KiB of payload.
const MAX_PENDING_FILE_BYTES = 128 * 1024;
const MAX_PENDING_FILE_FRAMES = 16;
const MAX_FILE_FRAME_BYTES = 16 * 1024 + 14;

export type DirectFileSaveState =
  | "choosing_destination"
  | "connecting"
  | "transferring"
  | "complete";

export interface DirectFileSaveProgress {
  readonly state: DirectFileSaveState;
  readonly bytesWritten: bigint;
  readonly fileLength: bigint;
}

export interface DirectFileSaveRequest {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly fileName: string;
  readonly expectedLength: bigint;
  readonly signal?: AbortSignal;
  readonly rangeStreamOptions?: RangeStreamOptions;
  readonly onProgress?: (progress: DirectFileSaveProgress) => void;
}

type DirectFileSink = BrowserFileSink;

class SinkWriteFailed extends Error {}

/**
 * Starts destination selection immediately. Call this directly from a user
 * activation and pass the returned promise to `saveDirectFile`.
 */
export function prepareDirectFileSink(
  fileName: string,
  fileLength: bigint,
): Promise<DirectFileSink> {
  return prepareBrowserFileSink(fileName, fileLength, {
    blobLimit: BLOB_FALLBACK_LIMIT,
    tooLarge: () => fileLength > BigInt(BLOB_FALLBACK_LIMIT)
      ? new Error("This browser can save remote files up to 32 MiB. Use a browser with streaming file saves for larger files.")
      : new Error("remote file exceeded the browser save limit"),
  });
}

export async function saveDirectFile(
  transport: RemoteApplicationWebSocket,
  request: DirectFileSaveRequest,
  preparedSink: Promise<DirectFileSink>,
): Promise<void> {
  progress(request, "choosing_destination", 0n);
  const sink = await preparedSink;
  try {
    abortIfRequested(request.signal);
    if (!transport.directFileSupported()) {
      throw new Error("This remote host does not support direct file saves.");
    }
  } catch (error) {
    await sink.abort();
    throw error;
  }

  let connection: Awaited<ReturnType<typeof openDirectFileConnection>> | undefined;
  let terminalOutcome: "complete" | "cancelled" | "sink_failed" = "cancelled";
  try {
    progress(request, "connecting", 0n);
    connection = await openDirectFileConnection(transport, request);
    const { channel, peer, fileLength } = connection;
    const ranges = await negotiateRangeStream(channel, peer, fileLength, request.signal, request.rangeStreamOptions);
    if (ranges) {
      try {
        await ranges.read(0n, fileLength, {
          signal: request.signal,
          write: async (bytes) => {
            try { await sink.write(bytes); }
            catch (error) { throw new SinkWriteFailed(errorMessage(error)); }
          },
          onConsumed: (offset) => progress(request, "transferring", offset),
        });
      } finally { ranges.close(); }
    } else await streamRanges(channel, sink, request, fileLength, connection.maximumChunkBytes);
    await sink.close().catch((error: unknown) => {
      throw new SinkWriteFailed(errorMessage(error));
    });
    terminalOutcome = "complete";
    progress(request, "complete", fileLength);
  } catch (error) {
    if (error instanceof SinkWriteFailed) terminalOutcome = "sink_failed";
    await sink.abort();
    throw error;
  } finally {
    await connection?.close(terminalOutcome);
  }
}

async function streamRanges(
  channel: RTCDataChannel,
  sink: DirectFileSink,
  request: DirectFileSaveRequest,
  fileLength: bigint,
  maximumChunkBytes: number,
): Promise<void> {
  let offset = 0n;
  let rangeId = 1;
  while (offset < fileLength) {
    abortIfRequested(request.signal);
    const length = Number((fileLength - offset) < MAX_RANGE_LENGTH ? fileLength - offset : MAX_RANGE_LENGTH);
    const rangeEnd = offset + BigInt(length);
    await receiveRange(
      channel,
      sink,
      request,
      rangeId,
      offset,
      length,
      fileLength,
      maximumChunkBytes,
    );
    offset = rangeEnd;
    rangeId = rangeId === 0xffff_ffff ? 1 : rangeId + 1;
  }
}

function receiveRange(
  channel: RTCDataChannel,
  sink: DirectFileSink,
  request: DirectFileSaveRequest,
  rangeId: number,
  rangeOffset: bigint,
  rangeLength: number,
  fileLength: bigint,
  maximumChunkBytes: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    let nextOffset = rangeOffset;
    const rangeEnd = rangeOffset + BigInt(rangeLength);
    let processing = Promise.resolve();
    let settled = false;
    let pendingBytes = 0;
    let pendingFrames = 0;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      trySend(channel, encodeCancel(rangeId));
      cleanup();
      reject(error instanceof Error || error instanceof DOMException ? error : new Error(errorMessage(error)));
    };
    const abort = () => {
      fail(new DOMException("The remote file save was cancelled.", "AbortError"));
    };
    const cleanup = () => {
      channel.onmessage = null;
      channel.onerror = null;
      channel.onclose = null;
      request.signal?.removeEventListener("abort", abort);
    };
    channel.onerror = () => fail(new Error("direct file data channel failed"));
    channel.onclose = () => fail(new Error("direct file data channel closed"));
    channel.onmessage = (event) => {
      if (settled) return;
      const frameBytes = event.data instanceof ArrayBuffer ? event.data.byteLength
        : event.data instanceof Blob ? event.data.size : -1;
      if (frameBytes < 6 || frameBytes > MAX_FILE_FRAME_BYTES ||
        pendingBytes + frameBytes > MAX_PENDING_FILE_BYTES ||
        pendingFrames >= MAX_PENDING_FILE_FRAMES) {
        fail(new Error("host exceeded the direct file receive queue limit"));
        return;
      }
      pendingBytes += frameBytes;
      pendingFrames += 1;
      processing = processing.then(async () => {
        if (settled) return;
        const bytes = await binaryData(event.data);
        if (settled) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.byteLength < 6 || view.getUint8(0) !== PROTOCOL_VERSION) {
          throw new Error("host sent a malformed direct file frame");
        }
        const messageRangeId = view.getUint32(2);
        if (messageRangeId !== rangeId) throw new Error("host sent a stale direct file frame");
        switch (view.getUint8(1)) {
          case RANGE_ACCEPTED: {
            if (bytes.byteLength !== 26 || accepted) throw new Error("host sent an invalid range acknowledgement");
            const acceptedFileLength = view.getBigUint64(6);
            const acceptedOffset = view.getBigUint64(14);
            const acceptedLength = view.getUint32(22);
            if (
              acceptedFileLength !== fileLength ||
              acceptedOffset !== rangeOffset ||
              acceptedLength !== rangeLength
            ) throw new Error("host accepted a different file range");
            accepted = true;
            return;
          }
          case RANGE_CHUNK: {
            if (!accepted || bytes.byteLength <= 14) throw new Error("host sent an unexpected file chunk");
            const chunkOffset = view.getBigUint64(6);
            const payload = bytes.subarray(14);
            if (
              payload.byteLength > maximumChunkBytes ||
              chunkOffset !== nextOffset ||
              nextOffset + BigInt(payload.byteLength) > rangeEnd
            ) throw new Error("host sent an invalid file chunk");
            try {
              await sink.write(payload.slice());
            } catch (error) {
              throw new SinkWriteFailed(errorMessage(error));
            }
            if (settled) return;
            nextOffset += BigInt(payload.byteLength);
            progress(request, "transferring", nextOffset);
            trySend(channel, encodeAck(rangeId, nextOffset));
            return;
          }
          case RANGE_COMPLETE:
            if (bytes.byteLength !== 6 || !accepted || nextOffset !== rangeEnd) {
              throw new Error("host completed an incomplete file range");
            }
            settled = true;
            cleanup();
            resolve();
            return;
          case RANGE_ERROR:
            if (bytes.byteLength !== 7) throw new Error("host sent a malformed range error");
            throw new Error(`host rejected the file range (code ${view.getUint8(6)})`);
          default:
            throw new Error("host sent an unknown direct file frame");
        }
      }).catch(fail).finally(() => {
        pendingBytes -= frameBytes;
        pendingFrames -= 1;
      });
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted === true) {
      abort();
      return;
    }
    trySend(channel, encodeRangeRequest(rangeId, rangeOffset, rangeLength));
  });
}

function encodeRangeRequest(requestId: number, offset: bigint, length: number): ArrayBuffer {
  const buffer = new ArrayBuffer(18);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, RANGE_REQUEST);
  view.setUint32(2, requestId);
  view.setBigUint64(6, offset);
  view.setUint32(14, length);
  return buffer;
}

function encodeCancel(requestId: number): ArrayBuffer {
  const buffer = new ArrayBuffer(6);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, CANCEL_REQUEST);
  view.setUint32(2, requestId);
  return buffer;
}

function encodeAck(requestId: number, nextOffset: bigint): ArrayBuffer {
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, CHUNK_ACK);
  view.setUint32(2, requestId);
  view.setBigUint64(6, nextOffset);
  return buffer;
}

function trySend(channel: RTCDataChannel, buffer: ArrayBuffer): void {
  if (channel.readyState !== "open") throw new Error("direct file data channel is not open");
  channel.send(buffer);
}

async function binaryData(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new Error("host sent a non-binary direct file frame");
}

function progress(request: DirectFileSaveRequest, state: DirectFileSaveState, bytesWritten: bigint): void {
  request.onProgress?.({ state, bytesWritten, fileLength: request.expectedLength });
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new DOMException("The remote file save was cancelled.", "AbortError");
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

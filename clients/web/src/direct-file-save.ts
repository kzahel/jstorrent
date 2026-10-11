import { negotiateRangeStream, type RangeStreamOptions } from "./direct-file-range-stream";
import type {
  DirectFileResponse,
  RemoteApplicationWebSocket,
} from "./remote-application-websocket";

const DATA_CHANNEL_LABEL = "rstorrent-direct-file-v1";
const PUBLIC_STUN_URL = "stun:stun.cloudflare.com:3478";
const BLOB_FALLBACK_LIMIT = 32 * 1024 * 1024;
const MAX_RANGE_LENGTH = 0xffff_ffffn;
const CONNECTION_TIMEOUT_MILLIS = 20_000;
const ICE_GATHERING_TIMEOUT_MILLIS = 8_000;
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

interface DirectFileSink {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
}

class SinkWriteFailed extends Error {}

let nextTransferId = 1;

/**
 * Starts destination selection immediately. Call this directly from a user
 * activation and pass the returned promise to `saveDirectFile`.
 */
export function prepareDirectFileSink(
  fileName: string,
  fileLength: bigint,
): Promise<DirectFileSink> {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (picker !== undefined) {
    const handle = picker.call(window, { suggestedName: safeFileName(fileName) });
    return handle.then(async (file) => {
      const writable = await file.createWritable();
      return {
        write: async (bytes) => writable.write(bytes),
        close: async () => writable.close(),
        abort: async () => writable.abort().catch(() => undefined),
      };
    });
  }
  if (fileLength > BigInt(BLOB_FALLBACK_LIMIT)) {
    return Promise.reject(
      new Error("This browser can save remote files up to 32 MiB. Use a browser with streaming file saves for larger files."),
    );
  }
  const chunks: ArrayBuffer[] = [];
  let bytesWritten = 0;
  return Promise.resolve({
    write: async (bytes) => {
      if (bytesWritten + bytes.byteLength > BLOB_FALLBACK_LIMIT) {
        throw new Error("remote file exceeded the browser save limit");
      }
      chunks.push(bytes.slice().buffer);
      bytesWritten += bytes.byteLength;
    },
    close: async () => {
      const url = URL.createObjectURL(new Blob(chunks));
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = safeFileName(fileName);
        anchor.style.display = "none";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    },
    abort: async () => {
      chunks.length = 0;
      bytesWritten = 0;
    },
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

  const circuitGeneration = transport.directFileConnectionGeneration();
  const requestId = allocateTransferId();
  const browserPeerGeneration = randomGeneration();
  const identity = {
    request_id: requestId,
    circuit_generation: circuitGeneration,
    browser_peer_generation: browserPeerGeneration,
  } as const;
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: PUBLIC_STUN_URL }],
    iceTransportPolicy: "all",
  });
  const channel = peer.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
  channel.binaryType = "arraybuffer";
  let opened = false;
  let terminalOutcome: "complete" | "cancelled" | "sink_failed" = "cancelled";
  try {
    progress(request, "connecting", 0n);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, request.signal);
    abortIfRequested(request.signal);
    const local = peer.localDescription;
    if (local === null || local.type !== "offer") throw new Error("browser did not create a direct offer");
    const directOfferSdp = directOnlySdp(local.sdp);
    const response = await transport.directFile({
      ...identity,
      type: "open",
      torrent_id: request.torrentId,
      file_index: request.fileIndex,
      offer: { type: "offer", sdp: directOfferSdp },
    });
    if (response.type !== "opened") throw new Error("host returned an invalid direct offer result");
    opened = true;
    const fileLength = parseU64(response.file_length);
    if (fileLength !== request.expectedLength) {
      throw new Error("remote file length changed before the save began");
    }
    if (response.max_chunk_bytes < 1 || response.max_chunk_bytes > 16 * 1024) {
      throw new Error("host offered an unsafe direct-file chunk size");
    }
    ensureDirectSdp(response.answer.sdp);
    await peer.setRemoteDescription({ type: "answer", sdp: response.answer.sdp });
    await addHostCandidates(peer, response, response.answer.sdp);
    await expectSignalResponse(
      transport.directFile({ ...identity, type: "end_of_candidates" }),
      "end_of_candidates",
    );
    await waitForDataChannel(channel, peer, request.signal);
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
    } else await streamRanges(channel, sink, request, fileLength, response.max_chunk_bytes);
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
    if (opened) {
      await transport.directFile({ ...identity, type: "close", outcome: terminalOutcome }).catch(
        () => undefined,
      );
    }
    channel.close();
    peer.close();
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

async function addHostCandidates(
  peer: RTCPeerConnection,
  opened: Extract<DirectFileResponse, { type: "opened" }>,
  answerSdp: string,
): Promise<void> {
  for (const candidate of opened.candidates) {
    ensureDirectCandidate(candidate.candidate);
    if (answerSdp.includes(candidate.candidate)) continue;
    await peer.addIceCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.sdp_mid,
      sdpMLineIndex: candidate.sdp_m_line_index,
      usernameFragment: candidate.username_fragment,
    });
  }
}

function waitForIceGathering(peer: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return waitForPeerEvent(
    peer,
    () => peer.iceGatheringState === "complete",
    "icegatheringstatechange",
    ICE_GATHERING_TIMEOUT_MILLIS,
    signal,
    true,
  );
}

function waitForDataChannel(
  channel: RTCDataChannel,
  peer: RTCPeerConnection,
  signal?: AbortSignal,
): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("direct connection timed out")), CONNECTION_TIMEOUT_MILLIS);
    const abort = () => finish(new DOMException("The remote file save was cancelled.", "AbortError"));
    const state = () => {
      if (channel.readyState === "open") finish();
      else if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "closed") {
        finish(new Error("a direct connection could not be established"));
      }
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.removeEventListener("open", state);
      peer.removeEventListener("iceconnectionstatechange", state);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve(); else reject(error);
    };
    channel.addEventListener("open", state);
    peer.addEventListener("iceconnectionstatechange", state);
    signal?.addEventListener("abort", abort, { once: true });
    state();
  });
}

function waitForPeerEvent(
  peer: RTCPeerConnection,
  complete: () => boolean,
  event: "icegatheringstatechange",
  timeoutMillis: number,
  signal: AbortSignal | undefined,
  timeoutIsSuccess: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(timeoutIsSuccess ? undefined : new Error("direct connection timed out")), timeoutMillis);
    const changed = () => {
      if (complete()) finish();
    };
    const abort = () => finish(new DOMException("The remote file save was cancelled.", "AbortError"));
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener(event, changed);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve(); else reject(error);
    };
    peer.addEventListener(event, changed);
    signal?.addEventListener("abort", abort, { once: true });
    changed();
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

function ensureDirectSdp(sdp: string): void {
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith("a=candidate:")) continue;
    ensureDirectCandidate(line.slice(2));
  }
}

function ensureDirectCandidate(candidate: string): void {
  if (!isDirectCandidate(candidate)) {
    throw new Error("host offered a prohibited relay or TCP candidate");
  }
}

function directOnlySdp(sdp: string): string {
  const newline = sdp.includes("\r\n") ? "\r\n" : "\n";
  const terminalNewline = sdp.endsWith("\n");
  const lines = sdp.split(/\r?\n/).filter((line) => {
    if (!line.startsWith("a=candidate:")) return true;
    return isDirectCandidate(line.slice(2));
  });
  if (terminalNewline && lines.at(-1) === "") lines.pop();
  return `${lines.join(newline)}${terminalNewline ? newline : ""}`;
}

function isDirectCandidate(candidate: string): boolean {
  const fields = candidate.split(/\s+/);
  const typeIndex = fields.findIndex((field) => field.toLocaleLowerCase() === "typ");
  return (
    fields.length >= 8 &&
    fields[2]?.toLocaleLowerCase() === "udp" &&
    typeIndex >= 0 &&
    ["host", "srflx", "prflx"].includes(fields[typeIndex + 1]?.toLocaleLowerCase() ?? "")
  );
}

async function expectSignalResponse(
  response: Promise<DirectFileResponse>,
  type: DirectFileResponse["type"],
): Promise<void> {
  if ((await response).type !== type) throw new Error("host returned an invalid signaling result");
}

function progress(request: DirectFileSaveRequest, state: DirectFileSaveState, bytesWritten: bigint): void {
  request.onProgress?.({ state, bytesWritten, fileLength: request.expectedLength });
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new DOMException("The remote file save was cancelled.", "AbortError");
}

function allocateTransferId(): number {
  const id = nextTransferId;
  nextTransferId = id === 0xffff_ffff ? 1 : id + 1;
  return id;
}

function randomGeneration(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] === 0 ? 1 : values[0]!;
}

function parseU64(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error("host returned an invalid file length");
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) throw new Error("host returned an invalid file length");
  return parsed;
}

function safeFileName(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1)?.trim() ?? "";
  return leaf.length > 0 ? leaf.slice(0, 255) : "download";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import type {
  DirectFileResponse,
  RemoteApplicationWebSocket,
} from "./remote-application-websocket";
const DATA_CHANNEL_LABEL = "rstorrent-direct-file-v1";
const PUBLIC_STUN_URL = "stun:stun.cloudflare.com:3478";
const CONNECTION_TIMEOUT_MILLIS = 20_000;
const ICE_GATHERING_TIMEOUT_MILLIS = 8_000;
let nextTransferId = 1;
export interface DirectFileConnectionRequest {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly expectedLength: bigint;
  readonly signal?: AbortSignal | undefined;
}
export interface DirectFileConnection {
  readonly peer: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  readonly fileLength: bigint;
  readonly maximumChunkBytes: number;
  close(outcome?: "complete" | "cancelled" | "sink_failed"): Promise<void>;
}
/** Authenticated, capability-bound direct-only peer shared by Save and Play. */
export async function openDirectFileConnection(
  transport: RemoteApplicationWebSocket,
  request: DirectFileConnectionRequest,
): Promise<DirectFileConnection> {
  abortIfRequested(request.signal);
  if (!transport.directFileSupported())
    throw new Error("This remote host does not support direct file transfers.");
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
  const cancelOpening = () => {
    channel.close();
    peer.close();
  };
  request.signal?.addEventListener("abort", cancelOpening, { once: true });
  const unsubscribeCircuit =
    transport.onCircuitClosed?.(cancelOpening) ?? (() => {});
  let opened = false;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, request.signal);
    abortIfRequested(request.signal);
    const local = peer.localDescription;
    if (local === null || local.type !== "offer")
      throw new Error("browser did not create a direct offer");
    const directOfferSdp = directOnlySdp(local.sdp);
    const response = await transport.directFile({
      ...identity,
      type: "open",
      torrent_id: request.torrentId,
      file_index: request.fileIndex,
      offer: { type: "offer", sdp: directOfferSdp },
    });
    if (response.type !== "opened")
      throw new Error("host returned an invalid direct offer result");
    opened = true;
    abortIfRequested(request.signal);
    const fileLength = parseU64(response.file_length);
    if (fileLength !== request.expectedLength) {
      throw new Error("remote file length changed before opening");
    }
    if (response.max_chunk_bytes < 1 || response.max_chunk_bytes > 16 * 1024) {
      throw new Error("host offered an unsafe direct-file chunk size");
    }
    ensureDirectSdp(response.answer.sdp);
    await peer.setRemoteDescription({
      type: "answer",
      sdp: response.answer.sdp,
    });
    await addHostCandidates(peer, response, response.answer.sdp);
    await expectSignalResponse(
      transport.directFile({ ...identity, type: "end_of_candidates" }),
      "end_of_candidates",
    );
    await waitForDataChannel(channel, peer, request.signal);
    abortIfRequested(request.signal);
    request.signal?.removeEventListener("abort", cancelOpening);
    return {
      peer,
      channel,
      fileLength,
      maximumChunkBytes: response.max_chunk_bytes,
      close: async (outcome = "cancelled") => {
        unsubscribeCircuit();
        channel.close();
        peer.close();
        if (!opened) return;
        opened = false;
        await transport
          .directFile({ ...identity, type: "close", outcome })
          .catch(() => undefined);
      },
    };
  } catch (error) {
    unsubscribeCircuit();
    request.signal?.removeEventListener("abort", cancelOpening);
    channel.close();
    peer.close();
    if (opened)
      await transport
        .directFile({ ...identity, type: "close", outcome: "cancelled" })
        .catch(() => undefined);
    throw error;
  }
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

function waitForIceGathering(
  peer: RTCPeerConnection,
  signal?: AbortSignal,
): Promise<void> {
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
  abortIfRequested(signal);
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("direct connection timed out")),
      CONNECTION_TIMEOUT_MILLIS,
    );
    const abort = () =>
      finish(
        new DOMException("The remote file save was cancelled.", "AbortError"),
      );
    const state = () => {
      if (channel.readyState === "open") finish();
      else if (
        peer.iceConnectionState === "failed" ||
        peer.iceConnectionState === "closed"
      ) {
        finish(new Error("a direct connection could not be established"));
      }
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.removeEventListener("open", state);
      peer.removeEventListener("iceconnectionstatechange", state);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
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
    const timer = setTimeout(
      () =>
        finish(
          timeoutIsSuccess
            ? undefined
            : new Error("direct connection timed out"),
        ),
      timeoutMillis,
    );
    const changed = () => {
      if (complete()) finish();
    };
    const abort = () =>
      finish(
        new DOMException("The remote file save was cancelled.", "AbortError"),
      );
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener(event, changed);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    };
    peer.addEventListener(event, changed);
    signal?.addEventListener("abort", abort, { once: true });
    changed();
  });
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
  const typeIndex = fields.findIndex(
    (field) => field.toLocaleLowerCase() === "typ",
  );
  return (
    fields.length >= 8 &&
    fields[2]?.toLocaleLowerCase() === "udp" &&
    typeIndex >= 0 &&
    ["host", "srflx", "prflx"].includes(
      fields[typeIndex + 1]?.toLocaleLowerCase() ?? "",
    )
  );
}

async function expectSignalResponse(
  response: Promise<DirectFileResponse>,
  type: DirectFileResponse["type"],
): Promise<void> {
  if ((await response).type !== type)
    throw new Error("host returned an invalid signaling result");
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted === true)
    throw new DOMException("The remote file save was cancelled.", "AbortError");
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
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new Error("host returned an invalid file length");
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn)
    throw new Error("host returned an invalid file length");
  return parsed;
}

// Appended to the transformed production save module by the local benchmark.
window.runDirectBenchmark = async ({ sink: sinkKind, ackDelayMs, rangeStreamOptions }) => {
  const fixture = await fetch("/fixture").then((response) => response.json());
  const NativePeer = window.RTCPeerConnection;
  let received = 0;
  let written = 0;
  let pendingHighWater = 0;
  let writeMs = 0;
  let firstWrite;
  let connected;
  let closed;
  let activePeer;
  let selectedPair;
  const timers = new Set();
  // Keep discovery local. Host experiment also disables public STUN.
  window.RTCPeerConnection = class extends NativePeer {
    constructor(options) { super({ ...options, iceServers: [] }); activePeer = this; }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      channel.addEventListener("open", () => { connected = performance.now(); });
      channel.addEventListener("message", (event) => {
        const bytes = new Uint8Array(event.data);
        if (bytes[1] === 0x82) {
          received += bytes.length - 14;
          pendingHighWater = Math.max(pendingHighWater, received - written);
        }
      });
      if (ackDelayMs) {
        const send = channel.send.bind(channel);
        channel.send = (frame) => {
          if (new Uint8Array(frame)[1] !== 3) return send(frame);
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (channel.readyState === "open") send(frame);
          }, ackDelayMs);
          timers.add(timer);
        };
      }
      return channel;
    }
  };
  const directory = await navigator.storage.getDirectory();
  const file = await directory.getFileHandle("direct-benchmark.bin", { create: true });
  const nativeWritable = sinkKind === "opfs" ? await file.createWritable() : undefined;
  const writable = {
    async write(bytes) {
      firstWrite ??= performance.now();
      const start = performance.now();
      if (nativeWritable) await nativeWritable.write(bytes);
      else {
        for (let index = 0; index < bytes.length; index++) {
          const position = written + index;
          if (bytes[index] !== ((position * 31 + (position >>> 8) * 17) & 255)) {
            throw new Error(`incorrect drain byte at ${position}`);
          }
        }
      }
      writeMs += performance.now() - start;
      written += bytes.length;
    },
    async close() {
      await nativeWritable?.close();
      closed = performance.now();
      const stats = await activePeer.getStats();
      const transport = [...stats.values()].find((stat) => stat.type === "transport" && stat.selectedCandidatePairId);
      const pair = transport && stats.get(transport.selectedCandidatePairId);
      if (!pair) throw new Error("no selected direct candidate pair");
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      selectedPair = { local: local.candidateType, remote: remote.candidateType,
        protocol: local.protocol, rttSeconds: pair.currentRoundTripTime };
      if (selectedPair.local === "relay" || selectedPair.remote === "relay") throw new Error("unexpected relay");
    },
    async abort() { await nativeWritable?.abort(); },
  };
  // Exercise the real picker branch and prepareDirectFileSink/createWritable seam.
  window.showSaveFilePicker = async () => ({ createWritable: async () => writable });
  const transport = {
    directFileSupported: () => true,
    directFileConnectionGeneration: () => 1,
    async directFile(request) {
      if (request.type === "open") {
        const response = await fetch("/offer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.offer) });
        if (!response.ok) throw new Error(await response.text());
        const answer = await response.json();
        return { ...request, type: "opened", host_peer_generation: 1, file_length: String(fixture.length),
          max_chunk_bytes: 16384, answer: answer.answer,
          candidates: answer.local_candidates.map((candidate) => ({ candidate: candidate.candidate,
            sdp_mid: candidate.sdpMid ?? null, sdp_m_line_index: candidate.sdpMLineIndex ?? null,
            username_fragment: candidate.usernameFragment ?? null })) };
      }
      if (request.type === "close") {
        const response = await fetch("/close", { method: "POST" });
        if (!response.ok) throw new Error(await response.text());
        return { ...request, type: "closed", host_peer_generation: 1 };
      }
      if (request.type === "end_of_candidates") return { ...request, host_peer_generation: 1 };
      throw new Error(`unexpected signaling ${request.type}`);
    },
  };
  try {
    const start = performance.now();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 90_000);
    timers.add(timeout);
    await saveDirectFile(transport, { torrentId: "fixture", fileIndex: 0, fileName: fixture.file_name,
      expectedLength: BigInt(fixture.length), rangeStreamOptions, signal: abort.signal }, prepareDirectFileSink(fixture.file_name, BigInt(fixture.length)));
    clearTimeout(timeout);
    timers.delete(timeout);
    const end = performance.now();
    const transferMs = closed - firstWrite;
    // Large verification buffer is allocated only after transfer and writer close.
    let sha256;
    if (nativeWritable) {
      const bytes = await (await file.getFile()).arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return { bytes: written, sha256, selectedPair, connectionMs: connected - start, transferMs,
      totalMs: end - start, writeMs, throughputMiBs: written / 1048576 / (transferMs / 1000),
      browserPendingPayloadHighWater: pendingHighWater,
      snapshot: await fetch("/status").then((response) => response.json()) };
  } finally {
    for (const timer of timers) clearTimeout(timer);
    window.RTCPeerConnection = NativePeer;
    delete window.showSaveFilePicker;
    await directory.removeEntry("direct-benchmark.bin");
  }
};

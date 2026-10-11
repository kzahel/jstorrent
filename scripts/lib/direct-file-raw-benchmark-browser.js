// Experiment-only receive ceiling: no range protocol, save writer or payload retention.
window.runDirectBenchmark = async ({ cancelAfterMiB = 0, peerKind = "raw" }) => {
  const fixture = await fetch("/fixture").then((response) => response.json());
  const peer = new RTCPeerConnection({ iceServers: [] });
  const channel = peer.createDataChannel("rstorrent-direct-file-v1", { ordered: true });
  channel.binaryType = "arraybuffer";
  let bytes = 0;
  let messages = 0;
  let checkMs = 0;
  let first;
  let last;
  let connected;
  let offered = false;
  let finished = false;
  let senderPeer;
  let senderHighWater = 0;
  const start = performance.now();
  let timeout;
  try {
    const received = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("raw transfer timed out")), 90_000);
      channel.addEventListener("open", () => { connected = performance.now(); });
      channel.addEventListener("error", () => reject(new Error("raw channel error")));
      channel.addEventListener("close", () => reject(new Error("raw channel closed early")));
      channel.addEventListener("message", (event) => {
        if (finished) return;
        try {
          first ??= performance.now();
          const payload = new Uint8Array(event.data);
          if (!payload.length || payload.length > 16384 || bytes + payload.length > fixture.length) {
            throw new Error("invalid raw payload length");
          }
          const checkStart = performance.now();
          for (let index = 0; index < payload.length; index++) {
            const position = bytes + index;
            if (payload[index] !== ((position * 31 + (position >>> 8) * 17) & 255)) {
              throw new Error(`incorrect raw byte at ${position}`);
            }
          }
          checkMs += performance.now() - checkStart;
          bytes += payload.length;
          messages++;
          last = performance.now();
          if (bytes === fixture.length || (cancelAfterMiB && bytes >= cancelAfterMiB * 1048576)) {
            finished = true;
            if (cancelAfterMiB && bytes < fixture.length) channel.close();
            resolve();
          }
        } catch (error) { reject(error); }
      });
    });
    // Attach a rejection handler before negotiation so startup failure cannot
    // leave a later timeout as an unhandled promise rejection.
    received.catch(() => {});
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise((resolve, reject) => {
      if (peer.iceGatheringState === "complete") return resolve();
      const timer = setTimeout(() => reject(new Error("raw ICE gathering timed out")), 8000);
      peer.addEventListener("icegatheringstatechange", () => {
        if (peer.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
      });
    });
    if (peerKind === "browser") {
      senderPeer = new RTCPeerConnection({ iceServers: [] });
      // The fixture pattern repeats every 64 KiB. Prepare only four messages.
      const pattern = Array.from({ length: 4 }, (_, chunk) => {
        const payload = new Uint8Array(16384);
        for (let index = 0; index < payload.length; index++) {
          const position = chunk * 16384 + index;
          payload[index] = (position * 31 + (position >>> 8) * 17) & 255;
        }
        return payload;
      });
      senderPeer.addEventListener("datachannel", (event) => {
        const sender = event.channel;
        let sent = 0;
        sender.bufferedAmountLowThreshold = 256 * 1024;
        const pump = () => {
          while (sender.readyState === "open" && sent < fixture.length && sender.bufferedAmount + 16384 <= 512 * 1024) {
            sender.send(pattern[(sent / 16384) % 4]);
            sent += 16384;
            senderHighWater = Math.max(senderHighWater, sender.bufferedAmount);
          }
        };
        sender.addEventListener("open", pump);
        sender.addEventListener("bufferedamountlow", pump);
      });
      await senderPeer.setRemoteDescription(peer.localDescription);
      await senderPeer.setLocalDescription(await senderPeer.createAnswer());
      await new Promise((resolve, reject) => {
        if (senderPeer.iceGatheringState === "complete") return resolve();
        const timer = setTimeout(() => reject(new Error("control ICE gathering timed out")), 8000);
        senderPeer.addEventListener("icegatheringstatechange", () => {
          if (senderPeer.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
        });
      });
      await peer.setRemoteDescription(senderPeer.localDescription);
    } else {
      offered = true;
      const response = await fetch("/offer", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(peer.localDescription) });
      if (!response.ok) throw new Error(await response.text());
      const answer = await response.json();
      await peer.setRemoteDescription(answer.answer);
      for (const candidate of answer.local_candidates) await peer.addIceCandidate(candidate);
    }
    await received;
    clearTimeout(timeout);
    const stats = await peer.getStats();
    const transport = [...stats.values()].find((stat) => stat.type === "transport" && stat.selectedCandidatePairId);
    const pair = transport && stats.get(transport.selectedCandidatePairId);
    if (!pair) throw new Error("no selected raw pair");
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const selectedPair = { local: local.candidateType, remote: remote.candidateType,
      protocol: local.protocol, rttSeconds: pair.currentRoundTripTime };
    if (selectedPair.local !== "host" || selectedPair.remote !== "host" || selectedPair.protocol !== "udp") {
      throw new Error("raw path must use direct host/host UDP");
    }
    const activeSnapshot = await fetch("/status").then((response) => response.json());
    channel.close();
    peer.close();
    senderPeer?.close();
    const close = await fetch("/close", { method: "POST" });
    if (!close.ok) throw new Error(await close.text());
    offered = false;
    return { bytes, messages, checkMs, senderHighWater, selectedPair, connectionMs: connected - start,
      transferMs: last - first, totalMs: performance.now() - start,
      throughputMiBs: bytes / 1048576 / ((last - first) / 1000),
      cancelled: Boolean(cancelAfterMiB && bytes < fixture.length), shutdownMs: performance.now() - last, activeSnapshot,
      snapshot: await fetch("/status").then((response) => response.json()) };
  } finally {
    clearTimeout(timeout);
    channel.close();
    peer.close();
    senderPeer?.close();
    if (offered) await fetch("/close", { method: "POST" });
  }
};

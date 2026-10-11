import { negotiateRangeStream } from "/ranges.js";
window.runV2Checks = async () => {
  const fixture = await fetch("/fixture").then(r => r.json());
  let count = 0;
  const snapshots = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  async function connect() {
    const peer = new RTCPeerConnection({ iceServers: [] });
    const control = peer.createDataChannel("rstorrent-direct-file-v1", { ordered: true });
    control.binaryType = "arraybuffer";
    try {
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete") await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ICE timeout")), 8000);
        peer.addEventListener("icegatheringstatechange", () => { if (peer.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); } });
      });
      const response = await fetch("/offer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(peer.localDescription) });
      assert(response.ok, "offer failed"); const answer = await response.json();
      await peer.setRemoteDescription(answer.answer);
      for (const candidate of answer.local_candidates) await peer.addIceCandidate(candidate);
      if (control.readyState !== "open") await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("control timeout")), 20000);
        control.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
      const stream = await negotiateRangeStream(control, peer, BigInt(fixture.length), undefined,
        { budgetBytes: 1024 * 1024, transportBytes: 65536, writeBatchBytes: 65536 });
      assert(stream, "v2 not selected");
      return { peer, control, stream };
    } catch (error) { peer.close(); throw error; }
  }
  async function close(connection) {
    connection.stream.close(); connection.control.close(); connection.peer.close();
    await fetch("/close", { method: "POST" });
    const snapshot = await fetch("/status").then(r => r.json());
    assert(snapshot.active_tasks === 0 && snapshot.open_sockets === 0 && snapshot.active_requests === 0
      && snapshot.queued_bytes === 0 && snapshot.transport_buffered_bytes === 0, "terminal resources survived");
    assert(snapshot.queue_high_water <= 524288 && snapshot.transport_high_water <= 65586, "queue bound exceeded");
    snapshots.push(snapshot);
  }
  function consumer(start, extra = {}) {
    let offset = Number(start);
    return { windowBytes: 262144, async write(bytes) {
      for (let i = 0; i < bytes.length; i++, offset++) assert(bytes[i] === ((offset * 31 + (offset >>> 8) * 17) & 255), `bad byte at ${offset}`);
      count += bytes.length;
    }, ...extra };
  }
  console.log("concurrent ranges");
  let c = await connect();
  try {
    await Promise.all([
      c.stream.read(7n, 600007n, consumer(7n)),
      c.stream.read(33000n, 44001n, consumer(33000n, { priority: 1 })),
      c.stream.read(BigInt(fixture.length - 7), BigInt(fixture.length), consumer(BigInt(fixture.length - 7))),
      c.stream.read(0n, 0n, consumer(0n, { windowBytes: 1 })),
    ]);
    await c.stream.read(19n, 24n, consumer(19n));
  } finally { await close(c); }
  // Cancellation while a sink holds data; other ranges continue. Reservation
  // cannot be recycled until queued data and the producer's barrier drain.
  console.log("next case");
  c = await connect();
  try {
    const abort = new AbortController(); let release; let began;
    const started = new Promise(r => { began = r; }); const hold = new Promise(r => { release = r; });
    const read = c.stream.read(0n, BigInt(fixture.length), consumer(0n, { signal: abort.signal,
      async write() { began(); await hold; } }));
    const cancelled = read.then(() => { throw new Error("cancel succeeded"); }, error => assert(error.name === "AbortError", "cancel failed"));
    await started;
    const stale = new Uint8Array(22); stale.set([2,3]); const staleView = new DataView(stale.buffer);
    staleView.setUint32(2,1); staleView.setBigUint64(6,0n); staleView.setBigUint64(14,262144n);
    for (let i = 0; i < 100; i++) c.control.send(stale);
    abort.abort(); await cancelled; release();
    await c.stream.read(999n, 2000n, consumer(999n, { priority: 1 }));
    await sleep(100);
  } finally { await close(c); }
  // Faulty future credit closes the connection rather than granting memory.
  console.log("next case");
  c = await connect();
  try {
    const blocked = c.stream.read(0n, BigInt(fixture.length), consumer(0n, { async write() { await sleep(100); } }));
    const failed = blocked.then(() => { throw new Error("future credit accepted"); }, () => undefined);
    const bytes = new Uint8Array(22); bytes.set([2,3]); const view = new DataView(bytes.buffer);
    view.setUint32(2,1); view.setBigUint64(6, BigInt(fixture.length + 1)); view.setBigUint64(14, BigInt(fixture.length + 1));
    c.control.send(bytes);
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await fetch("/status").then(r => r.json());
      if (status.active_tasks === 0) break;
      await sleep(20);
    }
    c.stream.close(); await failed;
  } finally { await close(c); }
  assert(snapshots.at(-1).terminal_reason === "invalid_consumption_credit", "future credit terminal mismatch");
  // No consumption: producer cannot send more than the negotiated range window.
  console.log("next case");
  c = await connect();
  try {
    const blocked = c.stream.read(0n, BigInt(fixture.length), consumer(0n, { windowBytes: 65536, async write() { await new Promise(() => {}); } }));
    const failed = blocked.then(() => { throw new Error("withheld write succeeded"); }, () => undefined);
    await sleep(250);
    const snapshot = await fetch("/status").then(r => r.json());
    assert(snapshot.bytes_sent === 65536, "withheld consumption exceeded credit");
    c.stream.close(); await failed;
  } finally { await close(c); }
  return { ok: true, checkedBytes: count, snapshots };
};

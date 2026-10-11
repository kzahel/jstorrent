const VERSION = 1;
const RANGE_REQUEST = 0x01;
const CANCEL_REQUEST = 0x02;
const CHUNK_ACK = 0x03;
const RANGE_ACCEPTED = 0x81;
const RANGE_CHUNK = 0x82;
const RANGE_COMPLETE = 0x83;
const RANGE_ERROR = 0xff;

const phase = document.querySelector("#phase");
const result = document.querySelector("#result");
const startButton = document.querySelector("#start");
const cancelButton = document.querySelector("#cancel");
const closeButton = document.querySelector("#close");

let peer = null;
let channel = null;
let nextRequestId = 1;
let activeCancel = null;
const requests = new Map();

function setPhase(value) {
  phase.textContent = value;
}

function postJson(path, value) {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`${path}: ${response.status} ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  });
}

function requestFrame(requestId, offset, length) {
  const bytes = new ArrayBuffer(18);
  const view = new DataView(bytes);
  view.setUint8(0, VERSION);
  view.setUint8(1, RANGE_REQUEST);
  view.setUint32(2, requestId);
  view.setBigUint64(6, BigInt(offset));
  view.setUint32(14, length);
  return bytes;
}

function idFrame(kind, requestId) {
  const bytes = new ArrayBuffer(6);
  const view = new DataView(bytes);
  view.setUint8(0, VERSION);
  view.setUint8(1, kind);
  view.setUint32(2, requestId);
  return bytes;
}

function ackFrame(requestId, nextOffset) {
  const bytes = new ArrayBuffer(14);
  const view = new DataView(bytes);
  view.setUint8(0, VERSION);
  view.setUint8(1, CHUNK_ACK);
  view.setUint32(2, requestId);
  view.setBigUint64(6, BigInt(nextOffset));
  return bytes;
}

class Sha256 {
  constructor() {
    this.h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buffer = new Uint8Array(64);
    this.buffered = 0;
    this.length = 0;
  }

  update(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.length += bytes.length;
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(64 - this.buffered, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + take), this.buffered);
      this.buffered += take;
      offset += take;
      if (this.buffered === 64) {
        this.compress(this.buffer);
        this.buffered = 0;
      }
    }
  }

  digestHex() {
    const bitLength = BigInt(this.length) * 8n;
    this.buffer[this.buffered++] = 0x80;
    if (this.buffered > 56) {
      this.buffer.fill(0, this.buffered);
      this.compress(this.buffer);
      this.buffered = 0;
    }
    this.buffer.fill(0, this.buffered, 56);
    const tail = new DataView(this.buffer.buffer);
    tail.setUint32(56, Number((bitLength >> 32n) & 0xffffffffn));
    tail.setUint32(60, Number(bitLength & 0xffffffffn));
    this.compress(this.buffer);
    return Array.from(this.h, (word) => word.toString(16).padStart(8, "0")).join("");
  }

  compress(block) {
    const k = Sha256.k;
    const words = new Uint32Array(64);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + sum1 + choose + k[index] + words[index]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }
}

Sha256.k = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotate(value, count) {
  return (value >>> count) | (value << (32 - count));
}

async function connect() {
  peer = new RTCPeerConnection({ iceServers: [] });
  channel = peer.createDataChannel("rstorrent-direct-file-v1", { ordered: true });
  channel.binaryType = "arraybuffer";
  const queuedCandidates = [];
  let signalingReady = false;
  peer.addEventListener("icecandidate", (event) => {
    if (!event.candidate) return;
    const candidate = event.candidate.toJSON();
    if (!candidate.candidate) return;
    if (!directUdpCandidate(candidate.candidate)) return;
    if (signalingReady) {
      postJson("/candidate", candidate).catch(fail);
    } else {
      queuedCandidates.push(candidate);
    }
  });
  channel.addEventListener("message", onMessage);
  const opened = new Promise((resolve, reject) => {
    channel.addEventListener("open", resolve, { once: true });
    channel.addEventListener("error", () => reject(new Error("DataChannel error")), { once: true });
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const exchange = await postJson("/offer", { type: offer.type, sdp: offer.sdp });
  await peer.setRemoteDescription(exchange.answer);
  signalingReady = true;
  await Promise.all(queuedCandidates.map((candidate) => postJson("/candidate", candidate)));
  await Promise.race([
    opened,
    new Promise((_, reject) => setTimeout(() => reject(new Error("DataChannel open timeout")), 20_000)),
  ]);
  closeButton.disabled = false;
  return exchange;
}

function directUdpCandidate(candidate) {
  const fields = candidate.split(/\s+/);
  const typeIndex = fields.findIndex((field) => field.toLowerCase() === "typ");
  return fields.length >= 8 &&
    fields[2]?.toLowerCase() === "udp" &&
    typeIndex >= 0 &&
    ["host", "srflx", "prflx"].includes(fields[typeIndex + 1]?.toLowerCase());
}

function onMessage(event) {
  const bytes = new Uint8Array(event.data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || view.getUint8(0) !== VERSION) {
    fail(new Error("malformed response frame"));
    return;
  }
  const kind = view.getUint8(1);
  const requestId = view.getUint32(2);
  const request = requests.get(requestId);
  if (!request) return;
  if (kind === RANGE_ACCEPTED && bytes.length === 26) {
    request.accepted = true;
    request.fileLength = Number(view.getBigUint64(6));
    return;
  }
  if (kind === RANGE_CHUNK && bytes.length > 14) {
    const offset = Number(view.getBigUint64(6));
    const payload = bytes.slice(14);
    request.chain = request.chain.then(async () => {
      if (requests.get(requestId) !== request) return;
      if (offset !== request.nextOffset) throw new Error("non-contiguous range chunk");
      request.hash.update(payload);
      request.bytes += payload.length;
      request.maxChunkBytes = Math.max(request.maxChunkBytes, payload.length);
      if (request.write) await request.write(offset - request.offset, payload);
      request.nextOffset += payload.length;
      if (request.cancelAfterFirstChunk) {
        channel.send(idFrame(CANCEL_REQUEST, requestId));
        requests.delete(requestId);
        request.reject(new Error("cancelled as requested"));
        return;
      }
      if (request.delayMillis) {
        await new Promise((resolve) => setTimeout(resolve, request.delayMillis));
      }
      if (requests.get(requestId) !== request) return;
      if (request.invalidAck) {
        if (!request.invalidAckSent) {
          request.invalidAckSent = true;
          const next = request.invalidAck === "future" ? request.nextOffset + 65536 : request.nextOffset;
          const count = request.invalidAck === "flood" ? 10 : request.invalidAck === "duplicate" ? 2 : 1;
          for (let index = 0; index < count; index++) channel.send(ackFrame(requestId, next));
        }
        return;
      }
      if (request.withholdAck) return;
      channel.send(ackFrame(requestId, request.nextOffset));
    }).catch(request.reject);
    return;
  }
  if (kind === RANGE_COMPLETE && bytes.length === 6) {
    request.chain.then(async () => {
      requests.delete(requestId);
      if (request.close) await request.close();
      request.resolve({
        digest: request.hash.digestHex(),
        bytes: request.bytes,
        maxChunkBytes: request.maxChunkBytes,
        fileLength: request.fileLength,
      });
    }).catch(request.reject);
    return;
  }
  if (kind === RANGE_ERROR && bytes.length === 7) {
    requests.delete(requestId);
    request.reject(new Error(`range error ${view.getUint8(6)}`));
    return;
  }
  request.reject(new Error(`unexpected response frame ${kind}`));
}

function range(offset, length, options = {}) {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    requests.set(requestId, {
      offset,
      nextOffset: offset,
      accepted: false,
      bytes: 0,
      maxChunkBytes: 0,
      fileLength: null,
      hash: new Sha256(),
      chain: Promise.resolve(),
      write: options.write,
      close: options.close,
      delayMillis: options.delayMillis || 0,
      cancelAfterFirstChunk: options.cancelAfterFirstChunk || false,
      invalidAck: options.invalidAck,
      withholdAck: options.withholdAck || false,
      resolve,
      reject,
    });
    channel.send(requestFrame(requestId, offset, length));
    activeCancel = () => channel.send(idFrame(CANCEL_REQUEST, requestId));
    cancelButton.disabled = false;
  }).finally(() => {
    activeCancel = null;
    cancelButton.disabled = true;
  });
}

async function streamToOpfs(fixture) {
  if (!navigator.storage?.getDirectory) throw new Error("OPFS is unavailable");
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(fixture.file_name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  return range(0, fixture.length, {
    write: (position, data) => writable.write({ type: "write", position, data }),
    close: () => writable.close(),
  });
}

async function run() {
  const startedAt = performance.now();
  startButton.disabled = true;
  setPhase("Connecting");
  const fixture = await fetch("/fixture").then((response) => response.json());
  const exchange = await connect();
  const connectElapsedMillis = performance.now() - startedAt;
  setPhase("Checking concurrent ranges");
  const checks = [
    [fixture.head_offset, fixture.head_length, fixture.head_sha256],
    [fixture.tail_offset, fixture.tail_length, fixture.tail_sha256],
    [fixture.seek_offset, fixture.seek_length, fixture.seek_sha256],
    [fixture.overlap_offset, fixture.overlap_length, fixture.overlap_sha256],
  ];
  const verified = await Promise.all(checks.map(async ([offset, length, expected]) => {
    const received = await range(offset, length, { delayMillis: 5 });
    if (received.digest !== expected) throw new Error(`range digest mismatch at ${offset}`);
    return received;
  }));

  // Prove that one oversized hostile control frame and a stale ACK do not
  // disturb subsequent valid requests. The server reports the former on the
  // reserved request id 0, which the experiment intentionally ignores.
  channel.send(new Uint8Array(4097));
  channel.send(ackFrame(0xffffffff, 0));

  let outOfRangeRejected = false;
  try {
    await range(fixture.length, 1);
  } catch (error) {
    outOfRangeRejected = error.message.startsWith("range error ");
  }
  if (!outOfRangeRejected) throw new Error("out-of-range request was not rejected");

  setPhase("Checking cancellation");
  let cancellationObserved = false;
  try {
    await range(0, fixture.length, { cancelAfterFirstChunk: true });
  } catch (error) {
    cancellationObserved = error.message === "cancelled as requested";
  }
  if (!cancellationObserved) throw new Error("range cancellation was not observed");

  const invalidAcksRejected = [];
  for (const invalidAck of ["future", "duplicate", "flood"]) {
    let rejected = false;
    try { await range(0, fixture.length, { invalidAck }); }
    catch (error) { rejected = error.message === "range error 1"; }
    if (!rejected) throw new Error(`${invalidAck} ACK was not rejected`);
    invalidAcksRejected.push(invalidAck);
  }

  // A consumer that never releases write credit must stop at the bounded
  // window, with no continuing reads or accumulating payload.
  const beforeStall = await fetch("/status").then((response) => response.json());
  const stalled = range(0, fixture.length, { withholdAck: true });
  const stalledRequestId = nextRequestId - 1;
  await new Promise((resolve) => setTimeout(resolve, 100));
  const stalledStatus = await fetch("/status").then((response) => response.json());
  const stalledBytes = stalledStatus.bytes_sent - beforeStall.bytes_sent;
  if (stalledBytes <= 0 || stalledBytes > 65536) throw new Error(`unbounded stalled bytes: ${stalledBytes}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const stillStalled = await fetch("/status").then((response) => response.json());
  if (stillStalled.bytes_sent !== stalledStatus.bytes_sent) throw new Error("stalled producer kept sending");
  const stalledRejected = stalled.catch((error) => error.message);
  let inactivityObserved = false;
  if (window.__checkInactivity) {
    inactivityObserved = await stalledRejected === "range error 7";
    if (!inactivityObserved) throw new Error("stalled range did not time out");
  } else {
    channel.send(idFrame(CANCEL_REQUEST, stalledRequestId));
    requests.get(stalledRequestId).reject(new Error("stalled range cancelled"));
    requests.delete(stalledRequestId);
    await stalledRejected;
  }

  setPhase("Streaming to OPFS");
  const streamStartedAt = performance.now();
  const streamed = await streamToOpfs(fixture);
  const streamElapsedMillis = performance.now() - streamStartedAt;
  if (streamed.bytes !== fixture.length || streamed.digest !== fixture.sha256) {
    throw new Error("full streamed fixture digest mismatch");
  }
  const server = await fetch("/status").then((response) => response.json());
  const outcome = {
    ok: true,
    browser: navigator.userAgent,
    fixture,
    exchange: {
      udpAddress: exchange.udp_address,
      localFingerprint: exchange.local_fingerprint,
      remoteFingerprint: exchange.remote_fingerprint,
    },
    verifiedRanges: verified.length,
    hostileControlSurvived: true,
    outOfRangeRejected,
    cancellationObserved,
    invalidAcksRejected,
    stalledBytes,
    inactivityObserved,
    streamed,
    timing: {
      connectElapsedMillis,
      totalElapsedMillis: performance.now() - startedAt,
      streamElapsedMillis,
      streamMibPerSecond: (streamed.bytes / (1024 * 1024)) / (streamElapsedMillis / 1000),
    },
    server,
  };
  window.__result = outcome;
  result.textContent = JSON.stringify(outcome, null, 2);
  setPhase("Verified");
}

async function closeExperiment() {
  for (const request of requests.values()) request.reject(new Error("closed"));
  requests.clear();
  if (channel && channel.readyState !== "closed") channel.close();
  if (peer) peer.close();
  await fetch("/close", { method: "POST" });
  const terminal = await fetch("/status").then((response) => response.json());
  window.__terminal = terminal;
  setPhase("Closed");
}

function fail(error) {
  const outcome = {
    ok: false,
    error: String(error),
    stack: error?.stack ? String(error.stack) : null,
  };
  window.__result = outcome;
  result.textContent = JSON.stringify(outcome, null, 2);
  setPhase("Failed");
  startButton.disabled = false;
}

startButton.addEventListener("click", () => run().catch(fail));
cancelButton.addEventListener("click", () => activeCancel?.());
closeButton.addEventListener("click", () => closeExperiment().catch(fail));

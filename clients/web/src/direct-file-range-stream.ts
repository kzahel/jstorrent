/** Reliable ordered multiplexed byte ranges. No payload goes through signaling. */
const BUDGET = 8 * 1024 * 1024;
const WIRE_BYTES = 16 * 1024;
const PAYLOAD = WIRE_BYTES - 14;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const BULK_LABEL = "rstorrent-direct-file-v2-data";

export interface RangeStreamOptions {
  readonly budgetBytes?: number;
  readonly transportBytes?: number;
  readonly writeBatchBytes?: number;
}
export interface RangeConsumer {
  /** Resolution means these bytes can be released; rejection fails the range. */
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  readonly signal?: AbortSignal | undefined;
  readonly priority?: 0 | 1;
  readonly windowBytes?: number;
  readonly onConsumed?: (offset: bigint) => void;
}
interface Range {
  readonly id: number;
  readonly end: bigint;
  readonly window: number;
  readonly consumer: RangeConsumer;
  received: bigint;
  consumed: bigint;
  limit: bigint;
  chunks: Uint8Array<ArrayBuffer>[];
  queued: number;
  writing: boolean;
  cancelled?: Error;
  terminal: boolean;
  released: boolean;
  resolve(): void;
  reject(error: Error): void;
  abort(): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Probe only the legacy malformed response permits a v1 fallback. */
export async function negotiateRangeStream(
  control: RTCDataChannel, peer: RTCPeerConnection, length: bigint,
  signal?: AbortSignal, options: RangeStreamOptions = {},
): Promise<DirectFileRangeStream | undefined> {
  const budget = options.budgetBytes ?? BUDGET;
  const transport = options.transportBytes ?? BUDGET;
  const batch = options.writeBatchBytes ?? 128 * 1024;
  if (!Number.isInteger(budget) || budget < 1 || budget > BUDGET
    || !Number.isInteger(transport) || transport < 64 * 1024 || transport > BUDGET
    || !Number.isInteger(batch) || batch < 1 || batch > 256 * 1024) throw new Error("Unsafe range stream limits");
  const opened = await new Promise<Uint8Array<ArrayBuffer> | undefined>((resolve, reject) => {
    const finish = (bytes?: Uint8Array<ArrayBuffer>, error?: Error) => {
      clearTimeout(timer); control.removeEventListener("message", message);
      control.removeEventListener("close", closed); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(bytes);
    };
    const message = (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) return finish(undefined, new Error("Invalid range negotiation"));
      const bytes = new Uint8Array(event.data);
      if (bytes.length === 7 && bytes[0] === 1 && bytes[1] === 0xff
        && new DataView(bytes.buffer).getUint32(2) === 0 && bytes[6] === 1) return finish();
      if (bytes.length !== 50 || bytes[0] !== 2 || bytes[1] !== 0x80) return finish(undefined, new Error("Invalid range negotiation"));
      const view = new DataView(bytes.buffer);
      if (view.getBigUint64(2) !== length || view.getUint32(10) !== budget || view.getUint32(14) !== transport)
        return finish(undefined, new Error("Range negotiation changed file or limits"));
      finish(bytes);
    };
    const closed = () => finish(undefined, new Error("Range connection closed"));
    const abort = () => finish(undefined, aborted());
    const timer = setTimeout(() => finish(undefined, new Error("Range negotiation timed out")), 20_000);
    control.addEventListener("message", message); control.addEventListener("close", closed);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    const hello = new Uint8Array(10); const view = new DataView(hello.buffer);
    hello.set([1, 4]); view.setUint32(2, budget); view.setUint32(6, transport);
    try { control.send(hello); } catch (error) { finish(undefined, asError(error)); }
  });
  if (!opened) return undefined;
  const bulk = peer.createDataChannel(BULK_LABEL, { ordered: true });
  bulk.binaryType = "arraybuffer";
  const stream = new DirectFileRangeStream(control, bulk, length, budget, batch,
    Array.from(opened.subarray(18), b => b.toString(16).padStart(2, "0")).join(""), peer);
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); bulk.removeEventListener("open", open); bulk.removeEventListener("close", close);
        signal?.removeEventListener("abort", abort); if (error) reject(error); else resolve();
      };
      const open = () => finish(); const close = () => finish(new Error("Range connection closed"));
      const abort = () => finish(aborted());
      const timer = setTimeout(() => finish(new Error("Range channel timed out")), 20_000);
      bulk.addEventListener("open", open); bulk.addEventListener("close", close);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort(); else if (bulk.readyState === "open") open();
    });
    return stream;
  } catch (error) { stream.close(); throw error; }
}

export class DirectFileRangeStream {
  private readonly ranges = new Map<number, Range>();
  private nextId = 1;
  private reserved = 0;
  private frames = 0;
  private failure?: Error;
  constructor(private readonly control: RTCDataChannel, private readonly bulk: RTCDataChannel,
    readonly fileLength: bigint, readonly budgetBytes: number, private readonly batchBytes: number,
    /** Opaque media capability generation, not a content digest or resume promise. */
    readonly version: string,
    private readonly peer?: RTCPeerConnection,
  ) {
    if (fileLength < 0n || fileLength > U64_MAX || !Number.isInteger(budgetBytes) || budgetBytes < 1 || budgetBytes > BUDGET
      || !Number.isInteger(batchBytes) || batchBytes < 1 || batchBytes > 256 * 1024) throw new Error("Unsafe range stream limits");
    bulk.addEventListener("message", this.message);
    control.addEventListener("message", this.release);
    peer?.addEventListener("connectionstatechange", this.peerChanged);
    for (const channel of [control, bulk]) {
      channel.addEventListener("close", this.closed); channel.addEventListener("error", this.closed);
    }
  }
  read(start: bigint, end: bigint, consumer: RangeConsumer): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (start < 0n || end < start || end > this.fileLength || end > U64_MAX) return Promise.reject(new Error("Invalid byte range"));
    if (consumer.signal?.aborted) return Promise.reject(aborted());
    const available = this.budgetBytes - this.reserved;
    const window = consumer.windowBytes ?? (Math.min(available, Number((end - start) < BigInt(available) ? end - start : BigInt(available))) || 1);
    if (this.ranges.size >= 4 || this.nextId > 0xffff_ffff || !Number.isInteger(window)
      || window < 1 || window > available) return Promise.reject(new Error("Range receive budget exhausted"));
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      const abort = () => this.cancel(range, aborted());
      const range: Range = { id, end, window, consumer, received: start, consumed: start,
        limit: min(end, start + BigInt(window)), chunks: [], queued: 0, writing: false,
        terminal: false, released: false, resolve, reject, abort,
        timer: setTimeout(() => this.fail(new Error("Range inactive")), 60_000) };
      this.ranges.set(id, range); this.reserved += window;
      consumer.signal?.addEventListener("abort", abort, { once: true });
      const read = frame(1, id, 27); const view = new DataView(read.buffer);
      view.setBigUint64(6, start); view.setBigUint64(14, end); view.setUint32(22, window);
      read[26] = consumer.priority ?? 0;
      this.send(read);
    });
  }
  close(): void { this.fail(new Error("Range connection closed")); this.bulk.close(); }
  private peerChanged = () => {
    if (this.peer?.connectionState === "failed" || this.peer?.connectionState === "closed") this.fail(new Error("Range connection closed"));
  };
  private closed = () => this.fail(new Error("Range connection closed"));
  private send(bytes: Uint8Array<ArrayBuffer>): void {
    // Control queue gets its own independent small bound.
    if (this.control.bufferedAmount > 64 * 1024) return this.fail(new Error("Range control queue full"));
    try { this.control.send(bytes); } catch (error) { this.fail(asError(error)); }
  }
  private release = (event: MessageEvent<unknown>) => {
    if (this.failure) return;
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength !== 6) return this.fail(new Error("Invalid release barrier"));
    const bytes = new Uint8Array(event.data);
    const range = this.ranges.get(new DataView(bytes.buffer).getUint32(2));
    if (bytes[0] !== 2 || bytes[1] !== 0x85 || !range || range.released) return this.fail(new Error("Invalid release barrier"));
    range.released = true; void this.pump(range);
  };
  private message = (event: MessageEvent<unknown>) => {
    if (this.failure) return;
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 7 || event.data.byteLength > WIRE_BYTES)
      return this.fail(new Error("Invalid range frame"));
    const bytes = new Uint8Array(event.data); const view = new DataView(bytes.buffer);
    const range = this.ranges.get(view.getUint32(2));
    if (bytes[0] !== 2 || !range || range.terminal) return this.fail(new Error("Unknown or terminal range frame"));
    clearTimeout(range.timer); range.timer = setTimeout(() => this.fail(new Error("Range inactive")), 60_000);
    if (bytes[1] === 0x82) {
      const length = bytes.length - 14;
      if (length < 1 || view.getBigUint64(6) !== range.received
        || range.received + BigInt(length) > range.limit
        || ++this.frames > 2 * Math.ceil(this.budgetBytes / PAYLOAD) + 32) return this.fail(new Error("Range receive bounds exceeded"));
      range.received += BigInt(length);
      range.chunks.push(bytes.subarray(14)); range.queued += length;
    } else if (bytes[1] === 0xff && bytes.length === 7) {
      range.terminal = true;
      range.cancelled ??= new Error(`Range unavailable (${bytes[6]})`);
    } else if ((bytes[1] === 0x83 || bytes[1] === 0x84) && bytes.length === 14
      && view.getBigUint64(6) === range.received) {
      if (bytes[1] === 0x83 && range.received !== range.end) return this.fail(new Error("Incomplete range"));
      range.terminal = true;
      if (bytes[1] === 0x84) range.cancelled ??= aborted();
    } else return this.fail(new Error("Invalid range frame"));
    void this.pump(range);
  };
  private async pump(range: Range): Promise<void> {
    if (range.writing || this.failure) return;
    range.writing = true;
    try {
      while (!this.failure && range.queued > 0 && (range.cancelled || range.terminal
        || range.queued >= this.batchBytes || range.limit - range.received < BigInt(this.batchBytes))) {
        const length = Math.min(this.batchBytes, range.queued);
        const bytes = new Uint8Array(length); let offset = 0;
        while (offset < length) {
          const chunk = range.chunks[0]!; const amount = Math.min(chunk.length, length - offset);
          if (!range.cancelled) bytes.set(chunk.subarray(0, amount), offset);
          offset += amount;
          if (amount === chunk.length) { range.chunks.shift(); this.frames--; }
          else range.chunks[0] = chunk.subarray(amount);
        }
        range.queued -= length;
        if (!range.cancelled) {
          try { await range.consumer.write(bytes); }
          catch (error) { this.cancel(range, asError(error)); }
        }
        if (this.failure) return;
        range.consumed += BigInt(length);
        if (!range.cancelled) range.consumer.onConsumed?.(range.consumed);
        this.credit(range);
      }
      if (!this.failure && range.terminal && range.released && range.queued === 0) {
        this.ranges.delete(range.id); this.reserved -= range.window;
        clearTimeout(range.timer); range.consumer.signal?.removeEventListener("abort", range.abort);
        if (range.cancelled) range.reject(range.cancelled); else range.resolve();
      }
    } catch (error) { this.fail(asError(error)); }
    finally { range.writing = false; }
  }
  private credit(range: Range): void {
    if (!range.cancelled) range.limit = min(range.end, range.consumed + BigInt(range.window));
    const bytes = frame(3, range.id, 22); const view = new DataView(bytes.buffer);
    view.setBigUint64(6, range.consumed); view.setBigUint64(14, range.limit);
    this.send(bytes);
  }
  private cancel(range: Range, error: Error): void {
    if (range.cancelled || this.failure) return;
    range.cancelled = error;
    range.reject(error);
    this.send(frame(2, range.id, 6));
    void this.pump(range);
  }
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.bulk.removeEventListener("message", this.message);
    this.control.removeEventListener("message", this.release);
    this.peer?.removeEventListener("connectionstatechange", this.peerChanged);
    for (const channel of [this.control, this.bulk]) {
      channel.removeEventListener("close", this.closed); channel.removeEventListener("error", this.closed);
    }
    for (const range of this.ranges.values()) {
      clearTimeout(range.timer); range.consumer.signal?.removeEventListener("abort", range.abort);
      range.chunks = []; range.queued = 0; range.reject(error);
    }
    this.ranges.clear(); this.reserved = 0; this.frames = 0;
  }
}
function frame(tag: number, id: number, length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length); bytes.set([2, tag]); new DataView(bytes.buffer).setUint32(2, id); return bytes;
}
function min(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function aborted(): DOMException { return new DOMException("Transfer cancelled", "AbortError"); }
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }

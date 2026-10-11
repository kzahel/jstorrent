// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { DirectFileRangeStream, negotiateRangeStream } from "./direct-file-range-stream";
class Channel extends EventTarget {
  readonly sent: Uint8Array[] = [];
  bufferedAmount = 0;
  readyState = "open";
  binaryType = "arraybuffer";
  send(bytes: ArrayBuffer | ArrayBufferView): void {
    this.sent.push(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice());
  }
  close(): void { this.readyState = "closed"; this.dispatchEvent(new Event("close")); }
  receive(bytes: Uint8Array): void { this.dispatchEvent(new MessageEvent("message", { data: bytes.buffer })); }
}
function wire(tag: number, id: number, offset: bigint, payload?: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(14 + (payload?.length ?? 0));
  bytes.set([2, tag]); const view = new DataView(bytes.buffer); view.setUint32(2, id); view.setBigUint64(6, offset);
  if (payload) bytes.set(payload, 14); return bytes;
}
function release(channel: Channel, id: number): void { const bytes = new Uint8Array([2,0x85,0,0,0,0]); new DataView(bytes.buffer).setUint32(2,id); channel.receive(bytes); }
function setup(length = 1000000n, budget = 131072, batch = 65536) {
  const control = new Channel(); const bulk = new Channel();
  const stream = new DirectFileRangeStream(control as unknown as RTCDataChannel, bulk as unknown as RTCDataChannel, length, budget, batch, "version");
  return { control, bulk, stream };
}
function deliver(channel: Channel, id: number, start: bigint, length: number): void {
  for (let offset = 0; offset < length;) {
    const amount = Math.min(16370, length - offset);
    channel.receive(wire(0x82, id, start + BigInt(offset), new Uint8Array(amount).fill(7))); offset += amount;
  }
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("reliable range stream", () => {
  it("batches writes and grants credit only after consumption; END waits for writes", async () => {
    const { stream, control, bulk } = setup(); const hold = gate();
    const writes: number[] = [];
    const read = stream.read(0n, 131072n, { write: async bytes => { writes.push(bytes.length); await hold.promise; } });
    let done = false; void read.then(() => { done = true; });
    deliver(bulk, 1, 0n, 131072); bulk.receive(wire(0x83, 1, 131072n)); release(control, 1);
    expect(writes).toEqual([65536]); expect(control.sent).toHaveLength(1); expect(done).toBe(false);
    hold.resolve(); await read;
    expect(writes).toEqual([65536, 65536]); expect(control.sent.filter(b => b[1] === 3)).toHaveLength(2);
    expect(new DataView(control.sent.at(-1)!.buffer).getBigUint64(6)).toBe(131072n); stream.close();
  });
  it("allows the full shared window from bounded reads while a writer is blocked", async () => {
    const { stream, control, bulk } = setup(10000000n, 8 * 1024 * 1024, 131072);
    const hold = gate(); const write = vi.fn(async () => hold.promise);
    const read = stream.read(0n, 10000000n, { write });
    const rejected = expect(read).rejects.toThrow("closed");
    // Short read tails are legitimate messages too, independently of wire size.
    for (let offset = 0; offset < 8 * 1024 * 1024; offset += 65536) deliver(bulk, 1, BigInt(offset), 65536);
    await tick(); expect(write).toHaveBeenCalledOnce(); expect(control.sent).toHaveLength(1);
    stream.close(); await rejected; hold.resolve(); await tick(); expect(control.sent).toHaveLength(1);
  });
  it("handles overlapping arbitrary u64 ranges and empty ranges", async () => {
    const end = 0xffff_ffff_ffff_ffffn; const { stream, bulk, control } = setup(end);
    const write = vi.fn(async () => undefined);
    const a = stream.read(end - 7n, end, { write, windowBytes: 32 });
    const b = stream.read(end - 5n, end - 1n, { write, windowBytes: 32, priority: 1 });
    const c = stream.read(end, end, { write, windowBytes: 1 });
    deliver(bulk, 1, end - 7n, 7); deliver(bulk, 2, end - 5n, 4);
    bulk.receive(wire(0x83, 1, end)); bulk.receive(wire(0x83, 2, end - 1n)); bulk.receive(wire(0x83, 3, end)); [1,2,3].forEach(id => release(control,id));
    await Promise.all([a,b,c]); expect(write).toHaveBeenCalledTimes(2); stream.close();
  });
  it("retains a cancelled reservation until the queued data and barrier drain", async () => {
    const { stream, control, bulk } = setup(); const abort = new AbortController(); const hold = gate();
    const write = vi.fn(async () => hold.promise);
    const read = stream.read(0n, 200000n, { write, signal: abort.signal });
    const rejection = expect(read).rejects.toMatchObject({ name: "AbortError" });
    deliver(bulk, 1, 0n, 131072); abort.abort(); await rejection;
    await expect(stream.read(0n, 1n, { write })).rejects.toThrow("budget");
    bulk.receive(wire(0x84, 1, 131072n)); release(control,1); hold.resolve(); await tick();
    expect(write).toHaveBeenCalledOnce();
    const next = stream.read(0n, 1n, { write: async () => undefined });
    deliver(bulk, 2, 0n, 1); bulk.receive(wire(0x83, 2, 1n)); release(control,2); await next;
    expect(control.sent.filter(b => b[1] === 1).map(b => new DataView(b.buffer).getUint32(2))).toEqual([1,2]); stream.close();
  });
  it("cancels a failed sink and never writes queued later data", async () => {
    const { stream, bulk, control } = setup(); const write = vi.fn(async () => { throw new Error("disk full"); });
    const read = stream.read(0n, 131072n, { write }); const rejected = expect(read).rejects.toThrow("disk full");
    deliver(bulk, 1, 0n, 131072); bulk.receive(wire(0x83, 1, 131072n)); release(control, 1); await rejected; await tick();
    expect(write).toHaveBeenCalledOnce(); expect(control.sent.some(b => b[1] === 2)).toBe(true); stream.close();
  });
  it("fails all consumers on a future or duplicate DATA offset", async () => {
    const { stream, bulk } = setup();
    const a = stream.read(0n, 7n, { write: async () => undefined });
    const b = stream.read(3n, 9n, { write: async () => undefined });
    const rejected = Promise.all([expect(a).rejects.toThrow("bounds"), expect(b).rejects.toThrow("bounds")]);
    deliver(bulk, 1, 1n, 2); await rejected; stream.close();
  });
  it("bounds payload and frame floods independently", async () => {
    for (const kind of ["payload", "frames"] as const) {
      const { stream, bulk } = setup(1000000n, 32768, 32768);
      const read = stream.read(0n, 1000000n, { write: async () => new Promise(() => undefined) });
      const rejected = expect(read).rejects.toThrow("bounds");
      if (kind === "payload") deliver(bulk, 1, 0n, 32769);
      else for (let i = 0; i < 40; i++) deliver(bulk, 1, BigInt(i), 1);
      await rejected; stream.close();
    }
  });
  it("connection closure rejects a pending writer and sends no late credit", async () => {
    const { stream, control, bulk } = setup(); const hold = gate();
    const read = stream.read(0n, 65536n, { write: async () => hold.promise });
    const rejected = expect(read).rejects.toThrow("closed");
    deliver(bulk, 1, 0n, 65536); control.close(); await rejected;
    hold.resolve(); await tick(); expect(control.sent).toHaveLength(1); stream.close();
  });
  it("requires the exact legacy rejection for fallback", async () => {
    const control = new Channel(); const peer = {} as RTCPeerConnection;
    const legacy = negotiateRangeStream(control as unknown as RTCDataChannel, peer, 5n);
    control.receive(new Uint8Array([1, 255, 0, 0, 0, 0, 1])); expect(await legacy).toBeUndefined();
    const invalid = negotiateRangeStream(control as unknown as RTCDataChannel, peer, 5n);
    const rejected = expect(invalid).rejects.toThrow("negotiation");
    control.receive(new Uint8Array([1, 255, 0, 0, 0, 1, 1])); await rejected;
  });
});

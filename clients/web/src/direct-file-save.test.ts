// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DirectFileRequest,
  DirectFileResponse,
  RemoteApplicationWebSocket,
} from "./remote-application-websocket";
import { prepareDirectFileSink, saveDirectFile } from "./direct-file-save";

describe("remote direct file save", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockPeerConnection.channelFactory = () => new MockDataChannel();
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it("streams an accepted range into the user-selected file", async () => {
    const written: Uint8Array[] = [];
    const close = vi.fn(async () => undefined);
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(() =>
      Promise.resolve({
        createWritable: async () => ({
          write: async (bytes: Uint8Array) => written.push(bytes.slice()),
          close,
          abort: async () => undefined,
        }),
      }),
    );
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
    const requests: DirectFileRequest[] = [];
    const transport = {
      directFileSupported: () => true,
      directFileConnectionGeneration: () => 7,
      directFile: async (request: DirectFileRequest): Promise<DirectFileResponse> => {
        requests.push(request);
        if (request.type === "open") {
          return {
            type: "opened",
            request_id: request.request_id,
            circuit_generation: request.circuit_generation,
            browser_peer_generation: request.browser_peer_generation,
            host_peer_generation: 1,
            file_length: "5",
            max_chunk_bytes: 16 * 1024,
            answer: { type: "answer", sdp: "v=0\r\n" },
            candidates: [],
          };
        }
        if (request.type === "end_of_candidates") {
          return { ...request, type: "end_of_candidates", host_peer_generation: 1 };
        }
        if (request.type === "close") {
          return { ...request, type: "closed", host_peer_generation: 1 };
        }
        throw new Error("unexpected candidate");
      },
    } as unknown as RemoteApplicationWebSocket;

    const sink = prepareDirectFileSink("hello.txt", 5n);
    await saveDirectFile(
      transport,
      {
        torrentId: "torrent",
        fileIndex: 0,
        fileName: "hello.txt",
        expectedLength: 5n,
      },
      sink,
    );

    expect(new TextDecoder().decode(written[0])).toBe("hello");
    expect(close).toHaveBeenCalledOnce();
    expect(requests.map((request) => request.type)).toEqual([
      "open",
      "end_of_candidates",
      "close",
    ]);
    expect((requests.at(-1) as Extract<DirectFileRequest, { type: "close" }>).outcome).toBe(
      "complete",
    );
  });

  it("rejects a large fallback before opening a peer", async () => {
    await expect(prepareDirectFileSink("large.bin", 32n * 1024n * 1024n + 1n)).rejects.toThrow(
      "32 MiB",
    );
  });

  it("aborts a destination chosen after the request was cancelled", async () => {
    const controller = new AbortController();
    const abort = vi.fn(async () => undefined);
    const peer = vi.fn();
    vi.stubGlobal("RTCPeerConnection", peer);
    controller.abort();
    await expect(saveDirectFile(testTransport(5), { ...saveRequest(5), signal: controller.signal },
      Promise.resolve({ write: async () => undefined, close: async () => undefined, abort })))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(abort).toHaveBeenCalledOnce();
    expect(peer).not.toHaveBeenCalled();
  });

  it("serializes a window of chunks and acknowledges only completed writes", async () => {
    const channel = new BurstDataChannel();
    MockPeerConnection.channelFactory = () => channel;
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
    const gate = deferredWrite();
    const offsets: number[] = [];
    let total = 0;
    const write = vi.fn(async (bytes: Uint8Array) => {
      offsets.push(total);
      if (offsets.length === 1) await gate.promise;
      total += bytes.length;
    });
    const close = vi.fn(async () => undefined);
    const saving = saveDirectFile(testTransport(channel.length), saveRequest(channel.length),
      Promise.resolve({ write, close, abort: async () => undefined }));
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(channel.acks).toEqual([]);
    gate.resolve();
    await saving;
    expect(offsets).toEqual([0, 16384, 32768, 49152, 65536]);
    expect(channel.acks).toEqual([16384n, 32768n, 49152n, 65536n, 65543n]);
    expect(total).toBe(channel.length);
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels queued chunks without writing or acknowledging them after abort", async () => {
    const channel = new BurstDataChannel();
    MockPeerConnection.channelFactory = () => channel;
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
    const gate = deferredWrite();
    const controller = new AbortController();
    const write = vi.fn(async () => gate.promise);
    const abort = vi.fn(async () => undefined);
    const saving = saveDirectFile(testTransport(channel.length),
      { ...saveRequest(channel.length), signal: controller.signal },
      Promise.resolve({ write, close: async () => undefined, abort }));
    const rejected = expect(saving).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(channel.acks).toEqual([]);
    expect(channel.cancelled).toBe(true);
    expect(channel.readyState).toBe("closed");
  });

  it("stops the window on writer failure and reports the sink outcome", async () => {
    const channel = new BurstDataChannel();
    MockPeerConnection.channelFactory = () => channel;
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
    const outcomes: string[] = [];
    const write = vi.fn(async () => { throw new Error("disk full"); });
    const abort = vi.fn(async () => undefined);
    await expect(saveDirectFile(testTransport(channel.length, outcomes), saveRequest(channel.length),
      Promise.resolve({ write, close: async () => undefined, abort }))).rejects.toThrow("disk full");
    expect(write).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(channel.acks).toEqual([]);
    expect(channel.cancelled).toBe(true);
    expect(outcomes).toEqual(["sink_failed"]);
  });

  it("rejects an oversized frame before allocating or writing its payload", async () => {
    const channel = new BurstDataChannel();
    channel.flood = "oversized";
    await expectRejectedFlood(channel);
  });

  it("bounds queued payload while a host floods messages", async () => {
    const channel = new BurstDataChannel();
    channel.flood = "bytes";
    await expectRejectedFlood(channel);
  });

  it("bounds queued control frames independently of byte size", async () => {
    const channel = new BurstDataChannel();
    channel.flood = "frames";
    await expectRejectedFlood(channel);
  });
});

async function expectRejectedFlood(channel: BurstDataChannel): Promise<void> {
  MockPeerConnection.channelFactory = () => channel;
  vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
  const write = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  await expect(saveDirectFile(testTransport(channel.length), saveRequest(channel.length),
    Promise.resolve({ write, close: async () => undefined, abort }))).rejects.toThrow("receive queue limit");
  expect(write).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledOnce();
  expect(channel.cancelled).toBe(true);
  expect(channel.readyState).toBe("closed");
}

function saveRequest(length: number) {
  return { torrentId: "torrent", fileIndex: 0, fileName: "window.bin", expectedLength: BigInt(length) };
}

function deferredWrite(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function testTransport(length: number, outcomes: string[] = []): RemoteApplicationWebSocket {
  return {
    directFileSupported: () => true,
    directFileConnectionGeneration: () => 7,
    directFile: async (request: DirectFileRequest): Promise<DirectFileResponse> => {
      if (request.type === "open") return { ...request, type: "opened", host_peer_generation: 1,
        file_length: String(length), max_chunk_bytes: 16384,
        answer: { type: "answer", sdp: "v=0\r\n" }, candidates: [] };
      if (request.type === "end_of_candidates") return { ...request, host_peer_generation: 1 };
      if (request.type === "close") {
        outcomes.push(request.outcome);
        return { ...request, type: "closed", host_peer_generation: 1 };
      }
      throw new Error("unexpected candidate");
    },
  } as unknown as RemoteApplicationWebSocket;
}

class MockDataChannel extends EventTarget {
  public binaryType = "arraybuffer";
  public readyState: RTCDataChannelState = "connecting";
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  private requestId = 0;

  public send(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    if (view.getUint8(1) === 0x01) {
      this.requestId = view.getUint32(2);
      const offset = view.getBigUint64(6);
      const length = view.getUint32(14);
      queueMicrotask(() => this.deliver(rangeAccepted(this.requestId, 5n, offset, length)));
      queueMicrotask(() => this.deliver(rangeChunk(this.requestId, offset, new TextEncoder().encode("hello"))));
    } else if (view.getUint8(1) === 0x03) {
      queueMicrotask(() => this.deliver(rangeComplete(this.requestId)));
    }
  }

  public open(): void {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  public close(): void {
    this.readyState = "closed";
  }

  public deliver(data: ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

class BurstDataChannel extends MockDataChannel {
  public readonly length = 4 * 16384 + 7;
  public readonly acks: bigint[] = [];
  public cancelled = false;
  public flood?: "oversized" | "bytes" | "frames";
  public override send(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    const id = view.getUint32(2);
    if (view.getUint8(1) === 1) {
      queueMicrotask(() => {
        this.deliver(rangeAccepted(id, BigInt(this.length), 0n, this.length));
        if (this.flood === "oversized") this.deliver(new ArrayBuffer(16384 + 15));
        else if (this.flood === "frames") {
          for (let index = 0; index < 20; index++) this.deliver(rangeComplete(id));
        } else {
          const count = this.flood === "bytes" ? 10 : 4;
          for (let index = 0; index < count; index++) {
            this.deliver(rangeChunk(id, BigInt(index * 16384), new Uint8Array(16384)));
          }
        }
      });
    } else if (view.getUint8(1) === 3) {
      const next = view.getBigUint64(6);
      this.acks.push(next);
      if (next === 16384n) queueMicrotask(() => this.deliver(rangeChunk(id, 65536n, new Uint8Array(7))));
      if (next === BigInt(this.length)) queueMicrotask(() => this.deliver(rangeComplete(id)));
    } else if (view.getUint8(1) === 2) this.cancelled = true;
  }
}

class MockPeerConnection extends EventTarget {
  public static channelFactory = (): MockDataChannel => new MockDataChannel();
  public iceGatheringState: RTCIceGatheringState = "complete";
  public iceConnectionState: RTCIceConnectionState = "connected";
  public localDescription: RTCSessionDescription | null = null;
  private readonly channel = MockPeerConnection.channelFactory();

  public createDataChannel(): RTCDataChannel {
    const send = this.channel.send.bind(this.channel);
    this.channel.send = (buffer) => {
      const probe = new Uint8Array(buffer);
      if (probe[0] === 1 && probe[1] === 4) {
        this.channel.dispatchEvent(new MessageEvent("message", { data: new Uint8Array([1, 0xff, 0, 0, 0, 0, 1]).buffer }));
      } else send(buffer);
    };
    return this.channel as unknown as RTCDataChannel;
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "v=0\r\n" };
  }

  public async setLocalDescription(description: RTCLocalSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
  }

  public async setRemoteDescription(): Promise<void> {
    queueMicrotask(() => this.channel.open());
  }

  public async addIceCandidate(): Promise<void> {}

  public close(): void {}
}

function rangeAccepted(requestId: number, fileLength: bigint, offset: bigint, length: number): ArrayBuffer {
  const buffer = new ArrayBuffer(26);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 0x81);
  view.setUint32(2, requestId);
  view.setBigUint64(6, fileLength);
  view.setBigUint64(14, offset);
  view.setUint32(22, length);
  return buffer;
}

function rangeChunk(requestId: number, offset: bigint, payload: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(14 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 0x82);
  view.setUint32(2, requestId);
  view.setBigUint64(6, offset);
  bytes.set(payload, 14);
  return bytes.buffer;
}

function rangeComplete(requestId: number): ArrayBuffer {
  const buffer = new ArrayBuffer(6);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 0x83);
  view.setUint32(2, requestId);
  return buffer;
}

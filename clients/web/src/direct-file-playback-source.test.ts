// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});
import {
  DirectFilePlaybackSource,
  PLAYBACK_READ_LIMIT,
} from "./direct-file-playback-source";
import type { RangeConsumer } from "./direct-file-range-stream";

function fixture(
  read?: (start: bigint, end: bigint, consumer: RangeConsumer) => Promise<void>,
) {
  const ranges = {
    fileLength: 64n * 1024n * 1024n,
    budgetBytes: 8 * 1024 * 1024,
    read: vi.fn(
      read ??
        (async (start, end, consumer) => {
          const bytes = new Uint8Array(Number(end - start));
          for (let i = 0; i < bytes.length; i++)
            bytes[i] = Number(start + BigInt(i)) % 251;
          await consumer.write(bytes);
        }),
    ),
    waitForIdle: vi.fn(async () => {}),
  };
  const close = vi.fn();
  return { source: new DirectFilePlaybackSource(ranges, close), ranges, close };
}
describe("direct video source", () => {
  it("reads half-open bytes with bounded read-ahead, then serves nearby parser reads from cache", async () => {
    const { source, ranges } = fixture();
    const first = await source._read(20, 200);
    expect(first.bytes[0]).toBe(20);
    expect(first.offset).toBe(20);
    expect(first.bytes.length).toBe(256 * 1024);
    const second = await source._read(35, 75);
    expect(second.offset).toBe(20);
    expect(second.view.getUint8(15)).toBe(35);
    expect(ranges.read).toHaveBeenCalledTimes(1);
    expect(source.stats.bufferHighWater).toBe(256 * 1024);
  });
  it("rejects unsafe and oversized requests before allocation or transport", async () => {
    const { source, ranges } = fixture();
    for (const [start, end] of [
      [-1, 2],
      [1, 1],
      [0, 1.5],
      [0, PLAYBACK_READ_LIMIT + 1],
      [0, Number.MAX_SAFE_INTEGER],
    ]) {
      await expect(source._read(start!, end!)).rejects.toThrow(
        "invalid or oversized",
      );
    }
    expect(ranges.read).not.toHaveBeenCalled();
  });
  it("rejects queued reads on disposal and closes its owner only once", async () => {
    const { source, ranges, close } = fixture();
    const reads = [source._read(0, 10), source._read(100, 200)];
    source._dispose();
    source._dispose();
    const result = await Promise.allSettled(reads);
    expect(result.every((r) => r.status === "rejected")).toBe(true);
    expect(ranges.read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("cancels an active read and waits for the native release barrier", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { source, ranges } = fixture(async (_start, _end, consumer) => {
      entered();
      await new Promise((_, reject) =>
        consumer.signal!.addEventListener(
          "abort",
          () => reject(consumer.signal!.reason),
          { once: true },
        ),
      );
    });
    const controller = new AbortController();
    source.setCurrentSignal(controller.signal);
    const read = source._read(0, 200);
    await started;
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(ranges.waitForIdle).toHaveBeenCalledOnce();
    expect(source.stats.cancellations).toBe(1);
  });
  it("bounds a parser segment's cumulative retained byte requests", async () => {
    const { source } = fixture();
    source.setCurrentSignal(new AbortController().signal);
    await source._read(0, PLAYBACK_READ_LIMIT);
    await source._read(PLAYBACK_READ_LIMIT, 2 * PLAYBACK_READ_LIMIT);
    await expect(
      source._read(2 * PLAYBACK_READ_LIMIT, 2 * PLAYBACK_READ_LIMIT + 1),
    ).rejects.toThrow("memory limit");
  });
  it("propagates failed reads without caching partially received bytes", async () => {
    const { source, ranges } = fixture(async () => {
      throw new Error("verified source unavailable");
    });
    await expect(source._read(0, 200)).rejects.toThrow(
      "verified source unavailable",
    );
    await expect(source._read(0, 200)).rejects.toThrow(
      "verified source unavailable",
    );
    expect(ranges.read).toHaveBeenCalledTimes(2);
  });
});

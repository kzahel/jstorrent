import { Source } from "playsvideo";
import type { DirectFileRangeStream } from "./direct-file-range-stream";

const MIB = 1024 * 1024;
export const PLAYBACK_READ_LIMIT = 8 * MIB;
const READ_AHEAD = 256 * 1024;
const SEGMENT_READ_LIMIT = 16 * MIB;
const INITIAL_READ_LIMIT = 32 * MIB;

export interface PlaybackReadStats {
  bytesReceived: number;
  reads: number;
  cancellations: number;
  bufferHighWater: number;
}
/** Serialized random access; retained demux/segment bytes have separate limits. */
export class DirectFilePlaybackSource extends Source {
  readonly stats: PlaybackReadStats = {
    bytesReceived: 0,
    reads: 0,
    cancellations: 0,
    bufferHighWater: 0,
  };
  private readonly lifetime = new AbortController();
  private signal: AbortSignal | null = null;
  private queue = Promise.resolve();
  private pending = 0;
  private readBytes = 0;
  private cache: { offset: number; bytes: Uint8Array<ArrayBuffer> } | undefined;
  constructor(
    private readonly ranges: Pick<
      DirectFileRangeStream,
      "fileLength" | "budgetBytes" | "read" | "waitForIdle"
    >,
    private readonly close: () => void,
  ) {
    super();
    if (ranges.fileLength > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("This file is too large for video playback.");
  }
  _retrieveSize(): number {
    return Number(this.ranges.fileLength);
  }
  setCurrentSignal(signal: AbortSignal | null): void {
    if (this.signal !== signal) this.readBytes = 0;
    this.signal = signal;
  }
  _read(start: number, end: number) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > this._retrieveSize() ||
      end - start > PLAYBACK_READ_LIMIT
    ) {
      return Promise.reject(
        new Error("Video requested an invalid or oversized byte range."),
      );
    }
    if (this.pending >= 4)
      return Promise.reject(new Error("Video read queue is full."));
    const signal = this.signal
      ? AbortSignal.any([this.signal, this.lifetime.signal])
      : this.lifetime.signal;
    this.pending++;
    const read = this.queue.then(async () => {
      signal.throwIfAborted();
      this.readBytes += end - start;
      if (
        this.readBytes > (this.signal ? SEGMENT_READ_LIMIT : INITIAL_READ_LIMIT)
      ) {
        throw new Error(
          "Video metadata or segment exceeds the playback memory limit.",
        );
      }
      const cached = this.cache;
      if (
        cached &&
        start >= cached.offset &&
        end <= cached.offset + cached.bytes.length
      ) {
        return result(cached.bytes, cached.offset);
      }
      // Read-ahead eliminates one RTC round trip per MP4 sample-table field/packet.
      const readEnd = Math.min(
        this._retrieveSize(),
        Math.max(end, start + READ_AHEAD),
      );
      const bytes = new Uint8Array(readEnd - start);
      this.stats.bufferHighWater = Math.max(
        this.stats.bufferHighWater,
        bytes.length + (cached?.bytes.length ?? 0),
      );
      let offset = 0;
      this.stats.reads++;
      try {
        await this.ranges.read(BigInt(start), BigInt(readEnd), {
          signal,
          priority: 1,
          windowBytes: Math.min(1024 * 1024, this.ranges.budgetBytes),
          write: async (chunk) => {
            signal.throwIfAborted();
            bytes.set(chunk, offset);
            offset += chunk.length;
            this.stats.bytesReceived += chunk.length;
          },
        });
      } catch (error) {
        if (signal.aborted) this.stats.cancellations++;
        throw error;
      } finally {
        // An aborted read rejects early; native release still owns its reservation.
        await this.ranges.waitForIdle();
      }
      signal.throwIfAborted();
      this.cache =
        bytes.length <= READ_AHEAD ? { offset: start, bytes } : undefined;
      return result(bytes, start);
    });
    this.queue = read.then(
      () => undefined,
      () => undefined,
    );
    return read.finally(() => {
      this.pending--;
    });
  }
  _dispose(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.cache = undefined;
    this.close();
  }
}
function result(bytes: Uint8Array<ArrayBuffer>, offset: number) {
  return {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    offset,
  };
}

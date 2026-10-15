import type { RangeConsumer } from "./direct-file-range-stream";

const BUDGET = 8 * 1024 * 1024;

/**
 * Reads exact byte ranges of one file-scoped media URL with one `fetch` per
 * range. Satisfies the range interface the playback source consumes.
 */
export class HttpRangeReader {
  readonly budgetBytes = BUDGET;
  private active: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly url: string,
    readonly fileLength: bigint,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    if (fileLength < 0n) throw new Error("Invalid media file length.");
  }

  read(start: bigint, end: bigint, consumer: RangeConsumer): Promise<void> {
    if (start < 0n || end <= start || end > this.fileLength || end - start > BigInt(BUDGET)) {
      return Promise.reject(new Error("Invalid byte range"));
    }
    const read = this.fetchRange(start, end, consumer);
    this.active = read.catch(() => undefined);
    return read;
  }

  /** Resolves once the last read, including an aborted one, has settled. */
  waitForIdle(): Promise<void> {
    return this.active.then(() => undefined);
  }

  private async fetchRange(start: bigint, end: bigint, consumer: RangeConsumer): Promise<void> {
    const response = await this.fetchImplementation(this.url, {
      headers: { Range: `bytes=${start}-${end - 1n}` },
      cache: "no-store",
      credentials: "same-origin",
      ...(consumer.signal === undefined ? {} : { signal: consumer.signal }),
    });
    const expected = `bytes ${start}-${end - 1n}/${this.fileLength}`;
    if (response.status !== 206 || response.headers.get("content-range") !== expected) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        response.status === 404
          ? "The video link expired. Close the player and try again."
          : `The host answered a video read with HTTP ${response.status}.`,
      );
    }
    const body = response.body;
    if (body === null) throw new Error("The host sent an empty video range.");
    const reader = body.getReader();
    const length = Number(end - start);
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > length) throw new Error("The host sent more video bytes than requested.");
        await consumer.write(new Uint8Array(value));
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    if (received !== length) throw new Error("The host sent fewer video bytes than requested.");
  }
}

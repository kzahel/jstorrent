import { describe, expect, it, vi } from "vitest";
import { HttpRangeReader } from "./http-range-reader";

const URL_ = "http://127.0.0.1:4177/media/capability";

function rangeResponse(
  body: Uint8Array<ArrayBuffer>,
  contentRange: string | null,
  status = 206,
): Response {
  return new Response(body, {
    status,
    headers: contentRange === null ? {} : { "Content-Range": contentRange },
  });
}

async function collect(reader: HttpRangeReader, start: bigint, end: bigint) {
  const chunks: number[] = [];
  await reader.read(start, end, {
    write: async (bytes) => {
      chunks.push(...bytes);
    },
  });
  return chunks;
}

describe("HTTP range reader", () => {
  it("requests one exact range and delivers its bytes", async () => {
    const fetch = vi.fn(async () =>
      rangeResponse(new Uint8Array([4, 5, 6]), "bytes 4-6/10"),
    );
    const reader = new HttpRangeReader(URL_, 10n, fetch);
    expect(await collect(reader, 4n, 7n)).toEqual([4, 5, 6]);
    expect(fetch).toHaveBeenCalledWith(
      URL_,
      expect.objectContaining({ headers: { Range: "bytes=4-6" } }),
    );
    await reader.waitForIdle();
  });

  it("rejects a full-body response, a mismatched range and an expired link", async () => {
    const full = new HttpRangeReader(URL_, 3n, async () =>
      rangeResponse(new Uint8Array([1, 2, 3]), null, 200),
    );
    await expect(collect(full, 0n, 3n)).rejects.toThrow("HTTP 200");
    const shifted = new HttpRangeReader(URL_, 10n, async () =>
      rangeResponse(new Uint8Array([1, 2]), "bytes 0-1/10"),
    );
    await expect(collect(shifted, 2n, 4n)).rejects.toThrow("HTTP 206");
    const resized = new HttpRangeReader(URL_, 10n, async () =>
      rangeResponse(new Uint8Array([1, 2]), "bytes 0-1/11"),
    );
    await expect(collect(resized, 0n, 2n)).rejects.toThrow("HTTP 206");
    const expired = new HttpRangeReader(URL_, 10n, async () =>
      new Response(null, { status: 404 }),
    );
    await expect(collect(expired, 0n, 2n)).rejects.toThrow("expired");
  });

  it("rejects bodies longer or shorter than the requested range", async () => {
    const long = new HttpRangeReader(URL_, 10n, async () =>
      rangeResponse(new Uint8Array([1, 2, 3]), "bytes 0-1/10"),
    );
    await expect(collect(long, 0n, 2n)).rejects.toThrow("more video bytes");
    const short = new HttpRangeReader(URL_, 10n, async () =>
      rangeResponse(new Uint8Array([1]), "bytes 0-1/10"),
    );
    await expect(collect(short, 0n, 2n)).rejects.toThrow("fewer video bytes");
  });

  it("rejects invalid ranges before any request", async () => {
    const fetch = vi.fn();
    const reader = new HttpRangeReader(URL_, 10n, fetch);
    await expect(collect(reader, 4n, 4n)).rejects.toThrow("Invalid byte range");
    await expect(collect(reader, 0n, 11n)).rejects.toThrow("Invalid byte range");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes the read signal to fetch so seeks abort it", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal!.reason),
          );
        }),
    );
    const reader = new HttpRangeReader(URL_, 10n, fetch as typeof globalThis.fetch);
    const read = reader.read(0n, 2n, {
      signal: controller.signal,
      write: async () => {},
    });
    controller.abort(new Error("seek"));
    await expect(read).rejects.toThrow("seek");
    await reader.waitForIdle();
  });
});

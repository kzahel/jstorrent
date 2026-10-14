// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpApiError, HttpApplicationClient, type FetchImplementation } from "./client";
import { ContractError, decodeTorrentListImportReport } from "../validation";
import { WebSocketApplicationViewClient } from "../websocket-view-client";

const OWNER = "0123456789abcdef0123456789abcdef";
const ORIGIN = "http://127.0.0.1:3030";

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function recordingFetch(respond: (request: RecordedRequest) => Response) {
  const requests: RecordedRequest[] = [];
  const fetch: FetchImplementation = async (input, init = {}) => {
    const request = { url: String(input), init };
    requests.push(request);
    return respond(request);
  };
  return { requests, fetch };
}

function client(fetch: FetchImplementation): HttpApplicationClient {
  return new HttpApplicationClient(ORIGIN, "token", ORIGIN, fetch, undefined, OWNER);
}

function zipResponse(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="jstorrent-torrents.zip"',
    },
  });
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type PickerWindow = Window & { showSaveFilePicker?: unknown };

afterEach(() => {
  delete (window as PickerWindow).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe("torrent list export over the gateway", () => {
  it("opens the save picker first, then writes the downloaded bundle", async () => {
    const order: string[] = [];
    const written: Uint8Array[] = [];
    const writable = {
      write: vi.fn(async (bytes: Uint8Array) => { written.push(bytes); }),
      close: vi.fn(async () => { order.push("close"); }),
      abort: vi.fn(async () => {}),
    };
    const picker = vi.fn(async () => {
      order.push("picker");
      return { createWritable: async () => writable };
    });
    (window as PickerWindow).showSaveFilePicker = picker;
    const bundle = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
    const { requests, fetch } = recordingFetch(() => {
      order.push("fetch");
      return zipResponse(bundle);
    });

    await expect(client(fetch).exportTorrentList()).resolves.toBe(true);

    expect(order).toEqual(["picker", "fetch", "close"]);
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "jstorrent-torrents.zip" }),
    );
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe(`${ORIGIN}/api/v1/torrent-list/export`);
    expect(request!.init.method).toBe("POST");
    expect(request!.init.credentials).toBe("include");
    expect(request!.init.headers).toMatchObject({
      Origin: ORIGIN,
      "X-RSTorrent-Owner": OWNER,
      Authorization: "Bearer token",
    });
    expect(written).toEqual([bundle]);
  });

  it("reports a cancelled save picker without downloading", async () => {
    (window as PickerWindow).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    const { requests, fetch } = recordingFetch(() => zipResponse(new Uint8Array([1])));

    await expect(client(fetch).exportTorrentList()).resolves.toBe(false);
    expect(requests).toEqual([]);
  });

  it("falls back to a browser download without a save picker", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:bundle");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    const bundle = new Uint8Array([0x50, 0x4b, 5, 6]);
    const { fetch } = recordingFetch(() => zipResponse(bundle));

    await expect(client(fetch).exportTorrentList()).resolves.toBe(true);
    expect(downloads).toEqual(["jstorrent-torrents.zip"]);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bundle);
  });

  it("aborts the destination when the gateway refuses the export", async () => {
    const writable = {
      write: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    (window as PickerWindow).showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => writable,
    }));
    const { fetch } = recordingFetch(() =>
      jsonResponse(500, { error: { code: "internal", message: "catalog is unreadable" } }),
    );

    const failure = client(fetch).exportTorrentList();
    await expect(failure).rejects.toBeInstanceOf(HttpApiError);
    await expect(failure).rejects.toThrow("catalog is unreadable");
    expect(writable.write).not.toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
    expect(writable.abort).toHaveBeenCalledOnce();
  });
});

describe("torrent list import over the gateway", () => {
  it("returns null without a request when no file is chosen", async () => {
    const { requests, fetch } = recordingFetch(() => jsonResponse(200, {}));
    await expect(
      client(fetch).importTorrentBundle(
        { storage_root: "root_a", keep_matching_locations: true },
        async () => null,
      ),
    ).resolves.toBeNull();
    expect(requests).toEqual([]);
  });

  it("uploads the chosen bundle like a torrent upload and decodes the report", async () => {
    const bundle = new Uint8Array([0x50, 0x4b, 1, 2, 3]).buffer;
    const report = {
      added: 2,
      already_present: 1,
      failed: [{ name: "Broken", reason: "torrent file is malformed" }],
    };
    const { requests, fetch } = recordingFetch(() => jsonResponse(200, report));

    await expect(
      client(fetch).importTorrentBundle(
        { storage_root: "root b", keep_matching_locations: false },
        async () => bundle,
      ),
    ).resolves.toEqual(report);

    const [request] = requests;
    const url = new URL(request!.url);
    expect(url.pathname).toBe("/api/v1/torrent-list/import");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      storage_root: "root b",
      keep_matching_locations: "false",
    });
    expect(request!.init.method).toBe("POST");
    expect(request!.init.credentials).toBe("include");
    expect(request!.init.body).toBe(bundle);
    expect(request!.init.headers).toMatchObject({
      Accept: "application/json",
      Origin: ORIGIN,
      "X-RSTorrent-Owner": OWNER,
      Authorization: "Bearer token",
      "Content-Type": "application/zip",
    });
  });

  it("surfaces an unreadable bundle and refuses an empty file", async () => {
    const { requests, fetch } = recordingFetch(() =>
      jsonResponse(400, { error: { code: "invalid_request", message: "bundle has no manifest" } }),
    );
    const gateway = client(fetch);
    const target = { storage_root: "root_a", keep_matching_locations: true };

    await expect(
      gateway.importTorrentBundle(target, async () => new Uint8Array([1]).buffer),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(
      gateway.importTorrentBundle(target, async () => new ArrayBuffer(0)),
    ).rejects.toMatchObject({ code: "resource_limit" });
    expect(requests).toHaveLength(1);
  });

  it("is reachable through the browser WebSocket client's platform client", async () => {
    const { requests, fetch } = recordingFetch(() =>
      jsonResponse(200, { added: 0, already_present: 0, failed: [] }),
    );
    const socket = new WebSocketApplicationViewClient(
      ORIGIN,
      "token",
      () => { throw new Error("no socket in this test"); },
      OWNER,
      { platformClient: client(fetch) },
    );
    expect(socket.exportTorrentList).toBeTypeOf("function");
    await expect(
      socket.importTorrentBundle!(
        { storage_root: "root_a", keep_matching_locations: true },
        async () => new Uint8Array([1]).buffer,
      ),
    ).resolves.toEqual({ added: 0, already_present: 0, failed: [] });
    expect(requests).toHaveLength(1);

    const companion = new WebSocketApplicationViewClient(
      ORIGIN,
      "token",
      () => { throw new Error("no socket in this test"); },
      OWNER,
      { platformClient: { chooseDownloadRoot: async () => null, close: async () => {} } },
    );
    expect(companion.exportTorrentList).toBeUndefined();
    expect(companion.importTorrentBundle).toBeUndefined();
  });
});

describe("torrent list import report", () => {
  it("accepts the engine report and rejects other shapes", () => {
    expect(
      decodeTorrentListImportReport('{"added":0,"already_present":3,"failed":[]}'),
    ).toEqual({ added: 0, already_present: 3, failed: [] });
    for (const source of [
      '{"added":-1,"already_present":0,"failed":[]}',
      '{"added":1,"failed":[]}',
      '{"added":1,"already_present":0,"failed":[],"extra":true}',
      '{"added":1,"already_present":0,"failed":[{"name":"x"}]}',
      '{"added":1,"already_present":0,"failed":[{"name":"x","reason":7}]}',
      "[]",
    ]) {
      expect(() => decodeTorrentListImportReport(source)).toThrow(ContractError);
    }
  });
});

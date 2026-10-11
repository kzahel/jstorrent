import { describe, expect, it } from "vitest";
import type { InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";

import type {
  ApiHello,
  OpenViewSetResponse,
  UpdateBatch,
  ViewSpec,
} from "./api";
import { ApplicationViewError } from "./api/client";
import { ContractError } from "./validation";
import {
  TauriApplicationViewClient,
  type TauriViewBridge,
} from "./tauri-view-client";
import {
  clientSettingsFixture,
  clientSettingsRuntimeFixture,
} from "./test-support/client-settings";

const viewSetId = "vs_000102030405060708090a0b0c0d0e0f";
const listView: ViewSpec = {
  type: "torrent_list",
  view_id: "library",
  delivery: { min_interval_millis: 0 },
};

class FakeChannel<T> {
  public onmessage: (message: T) => void = () => {};

  public emit(message: T): void {
    this.onmessage(message);
  }
}

class FakeBridge implements TauriViewBridge {
  public readonly calls: Array<{
    command: string;
    arguments_: InvokeArgs | undefined;
    options?: InvokeOptions;
  }> = [];
  public channel: FakeChannel<unknown> | undefined;
  public handler: (
    command: string,
    arguments_: InvokeArgs | undefined,
    options?: InvokeOptions,
  ) => unknown | Promise<unknown> = () => undefined;

  public async invoke<T>(
    command: string,
    arguments_?: InvokeArgs,
    options?: InvokeOptions,
  ): Promise<T> {
    this.calls.push({
      command,
      arguments_,
      ...(options === undefined ? {} : { options }),
    });
    return (await this.handler(command, arguments_, options)) as T;
  }

  public createChannel<T>(): { onmessage: (message: T) => void } {
    const channel = new FakeChannel<unknown>();
    this.channel = channel;
    return channel as FakeChannel<T>;
  }
}

describe("Tauri leased view-set adapter", () => {
  it("creates a media URL and delegates opening to the native adapter", async () => {
    const bridge = new FakeBridge();
    const url =
      "http://127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    bridge.handler = (command) => {
      if (command === "application_create_media_url") {
        return {
          torrent_id: "t1-000102030405060708090a0b0c0d0e0f",
          file_index: 2,
          outcome: {
            type: "created",
            url,
            idle_timeout_millis: "1800000",
            absolute_timeout_millis: "86400000",
          },
        };
      }
      if (command === "application_open_media_url") return undefined;
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);
    const target = client.prepareMediaOpen();
    const response = await client.createMediaUrl({
      torrent_id: "t1-000102030405060708090a0b0c0d0e0f",
      file_index: 2,
    });
    expect(response.outcome.type).toBe("created");
    await target.open(url);
    expect(bridge.calls).toEqual([
      {
        command: "application_create_media_url",
        arguments_: {
          torrentId: "t1-000102030405060708090a0b0c0d0e0f",
          fileIndex: 2,
        },
      },
      { command: "application_open_media_url", arguments_: { url } },
    ]);
    await client.close();
  });

  it("passes torrent bytes as a raw IPC body with metadata headers", async () => {
    const bridge = new FakeBridge();
    const source = new Uint8Array([100, 52, 58, 105, 110, 102, 111, 100, 101]).buffer;
    bridge.handler = (command) => {
      if (command !== "application_add_torrent_bytes") {
        throw new Error(`unexpected command ${command}`);
      }
      return {
        version: 1,
        request_id: "upload-request",
        revision: "1",
        status: "success",
        snapshot: {
          profile_id: "test",
          revision: "1",
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsFixture(),
          torrents: [],
        },
      };
    };
    const client = new TauriApplicationViewClient(bridge);

    await expect(
      client.addTorrentBytes(
        {
          version: 1,
          request_id: "upload-request",
          expected_revision: "0",
          storage_root: "root-a",
          start_content: false,
          await_file_selection: false,
          selection: {
            type: "wanted_ranges",
            ranges: [
              { start: 2, end_exclusive: 3 },
              { start: 5, end_exclusive: 6 },
            ],
          },
          source_length: source.byteLength,
        },
        source,
      ),
    ).resolves.toMatchObject({ request_id: "upload-request" });
    expect(bridge.calls).toEqual([
      {
        command: "application_add_torrent_bytes",
        arguments_: source,
        options: {
          headers: {
            "x-rstorrent-request-id": "upload-request",
            "x-rstorrent-storage-root": "root-a",
            "x-rstorrent-start-content": "false",
            "x-rstorrent-await-file-selection": "false",
            "x-rstorrent-expected-revision": "0",
            "x-rstorrent-selection": "ranges",
            "x-rstorrent-wanted-ranges": "2-3,5-6",
          },
        },
      },
    ]);
    await client.close();
  });

  it("adds an external source by opaque ID without a path or magnet", async () => {
    const bridge = new FakeBridge();
    bridge.handler = (command) => {
      if (command !== "application_add_external_torrent") {
        throw new Error(`unexpected command ${command}`);
      }
      return {
        version: 1,
        request_id: "desktop-request",
        revision: "1",
        status: "success",
        snapshot: {
          profile_id: "test",
          revision: "1",
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsFixture(),
          torrents: [],
        },
      };
    };
    const client = new TauriApplicationViewClient(bridge);

    await expect(
      client.addExternalTorrent({
        activation_id: "00010203-0405-4607-8809-0a0b0c0d0e0f",
        request_id: "desktop-request",
        storage_root: "root-a",
        start_content: false,
        await_file_selection: false,
      }),
    ).resolves.toMatchObject({ request_id: "desktop-request" });
    expect(bridge.calls).toEqual([
      {
        command: "application_add_external_torrent",
        arguments_: {
          activationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
          requestId: "desktop-request",
          storageRoot: "root-a",
          startContent: false,
          awaitFileSelection: false,
        },
      },
    ]);
    expect(JSON.stringify(bridge.calls)).not.toContain("torrent_file");
    expect(JSON.stringify(bridge.calls)).not.toContain("magnet:?");
    await client.close();
  });

  it("invokes the native folder picker with only an optional repair ID", async () => {
    const bridge = new FakeBridge();
    bridge.handler = (command) => {
      if (command === "choose_download_root") {
        return {
          root_id: "root_a",
          label: "Downloads",
          display_path: "/Users/test/Downloads",
          availability: "available",
        };
      }
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);

    await expect(
      client.chooseDownloadRoot({ repair_root: "root_missing" }),
    ).resolves.toMatchObject({ root_id: "root_a" });
    expect(bridge.calls).toEqual([
      {
        command: "choose_download_root",
        arguments_: { repairRoot: "root_missing" },
      },
    ]);
    await client.close();
  });

  it("validates hello and coherent open values from structured IPC", async () => {
    const bridge = new FakeBridge();
    bridge.handler = (command) => {
      if (command === "application_view_hello") return hello();
      if (command === "application_view_open") return opened();
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);

    await expect(client.hello()).resolves.toMatchObject({
      deliveries: ["stream"],
      encodings: ["json"],
    });
    await expect(
      client.openViewSet({ views: [listView], options: {} }),
    ).resolves.toMatchObject({ view_set_id: viewSetId });
    await client.close();
  });

  it("accepts an early channel batch and acknowledges it on the next pull", async () => {
    const bridge = new FakeBridge();
    const acknowledgements: string[] = [];
    bridge.handler = (command, arguments_) => {
      if (command === "application_view_stream") {
        bridge.channel?.emit({ type: "batch", batch: batch("1", "2") });
        return "tauri-stream-1";
      }
      if (command === "application_view_stream_ack") {
        const cursor = String(
          (arguments_ as Record<string, unknown> | undefined)?.cursor,
        );
        acknowledgements.push(cursor);
        bridge.channel?.emit({ type: "batch", batch: batch("2", "3") });
        return undefined;
      }
      if (command === "application_view_stream_close") return undefined;
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);
    const stream = await client.streamUpdates(viewSetId, "1");
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { base_cursor: "1", cursor: "2" },
    });
    expect(acknowledgements).toEqual([]);
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { base_cursor: "2", cursor: "3" },
    });
    expect(acknowledgements).toEqual(["2"]);

    await stream.close();
    await client.close();
    expect(
      bridge.calls.filter(
        ({ command }) => command === "application_view_stream_close",
      ),
    ).toHaveLength(1);
  });

  it("rejects a malformed channel batch without acknowledging it", async () => {
    const bridge = new FakeBridge();
    bridge.handler = (command) => {
      if (command === "application_view_stream") {
        bridge.channel?.emit({
          type: "batch",
          batch: { ...batch("1", "2"), epoch: "not-decimal" },
        });
        return "tauri-stream-2";
      }
      if (command === "application_view_stream_close") return undefined;
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);
    const stream = await client.streamUpdates(viewSetId, "1");

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      ContractError,
    );
    expect(
      bridge.calls.filter(
        ({ command }) => command === "application_view_stream_ack",
      ),
    ).toHaveLength(0);
    await stream.close();
    await client.close();
  });

  it("maps structured native errors to transport-neutral recovery errors", async () => {
    const bridge = new FakeBridge();
    bridge.handler = (command) => {
      if (command === "application_view_stream") {
        throw {
          code: "unknown_view_set",
          message: "view set is unavailable",
        };
      }
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);

    const failure = await client
      .streamUpdates(viewSetId, "1")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApplicationViewError);
    expect((failure as ApplicationViewError).code).toBe("unknown_view_set");
    await client.close();
  });

  it("closes a stream attached after its abort signal fired", async () => {
    const bridge = new FakeBridge();
    const release = promiseWithResolvers<string>();
    bridge.handler = (command) => {
      if (command === "application_view_stream") return release.promise;
      if (command === "application_view_stream_close") return undefined;
      throw new Error(`unexpected command ${command}`);
    };
    const client = new TauriApplicationViewClient(bridge);
    const cancellation = new AbortController();
    const opening = client.streamUpdates(viewSetId, "1", cancellation.signal);
    cancellation.abort();
    release.resolve("tauri-stream-late");

    await expect(opening).rejects.toThrow("aborted");
    expect(
      bridge.calls.filter(
        ({ command }) => command === "application_view_stream_close",
      ),
    ).toHaveLength(1);
    await client.close();
  });
});

function hello(): ApiHello {
  return {
    api: { current: 1, minimum: 1 },
    encodings: ["json"],
    deliveries: ["stream"],
    capabilities: ["torrent_list"],
    limits: {
      max_view_sets_per_owner: 8,
      max_views_per_set: 16,
      max_view_id_bytes: 64,
      min_queue_bytes: 16_384,
      default_queue_bytes: 262_144,
      max_queue_bytes: 524_288,
      max_snapshot_bytes: 16_777_216,
      max_wait_millis: 20_000,
      lease_millis: "300000",
    },
  };
}

function opened(): OpenViewSetResponse {
  return {
    view_set_id: viewSetId,
    lease_millis: "300000",
    effective_queue_bytes: 262_144,
    effective_views: [listView],
    initial: {
      api_version: 1,
      server_now_millis: "0",
      view_set_id: viewSetId,
      epoch: "1",
      base_cursor: "0",
      cursor: "1",
      durable_revision: "0",
      updates: [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
      ],
    },
  };
}

function batch(baseCursor: string, cursor: string): UpdateBatch {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: viewSetId,
    epoch: "1",
    base_cursor: baseCursor,
    cursor,
    durable_revision: cursor,
    updates: [
      {
        type: "patch",
        view_id: "library",
        patch: { type: "torrent_list", upsert: [], updates: [], removed: [] },
      },
    ],
  };
}

function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolved) => {
    resolve = resolved;
  });
  return { promise, resolve };
}

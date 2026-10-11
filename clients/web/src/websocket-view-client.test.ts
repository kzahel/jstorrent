import { describe, expect, it } from "vitest";

import type {
  ApiHello,
  ApplicationClientFrame,
  ApplicationServerFrame,
  OpenViewSetResponse,
  RequestEnvelope,
  ResponseEnvelope,
  UpdateBatch,
  ViewSpec,
} from "./api";
import type {
  ApplicationWebSocket,
  ApplicationWebSocketFactory,
} from "./websocket-view-client";
import { WebSocketApplicationViewClient } from "./websocket-view-client";
import {
  clientSettingsFixture,
  clientSettingsRuntimeFixture,
} from "./test-support/client-settings";

const viewSetId = "vs_000102030405060708090a0b0c0d0e0f";
const clientInstanceId = "00000000000000000000000000000001";
const listView: ViewSpec = {
  type: "torrent_list",
  view_id: "library",
  delivery: { min_interval_millis: 0 },
};

class FakeWebSocket implements ApplicationWebSocket {
  public readyState = 0;
  public binaryType: BinaryType = "blob";
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readonly sent: ApplicationClientFrame[] = [];
  public readonly binarySent: ArrayBuffer[] = [];
  public readonly closeEvents: Array<{ code: number; reason: string }> = [];

  public constructor(
    public readonly url: string,
    private readonly respond: (
      frame: ApplicationClientFrame,
      socket: FakeWebSocket,
    ) => void,
    private readonly respondBinary?: (
      source: ArrayBuffer,
      socket: FakeWebSocket,
    ) => void,
  ) {}

  public open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  public send(data: string | ArrayBuffer): void {
    if (data instanceof ArrayBuffer) {
      this.binarySent.push(data);
      this.respondBinary?.(data, this);
      return;
    }
    const frame = JSON.parse(data) as ApplicationClientFrame;
    this.sent.push(frame);
    this.respond(frame, this);
  }

  public server(frame: ApplicationServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }

  public serverRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  public close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.closeEvents.push({ code, reason });
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

describe("multiplexed application WebSocket adapter", () => {
  it("keeps native Cancel connected and closes an aborted desktop picker owner", async () => {
    let socket!: FakeWebSocket;
    let cancelNormally = true;
    const client = new WebSocketApplicationViewClient("http://127.0.0.1:3030", "token", (url) => {
      socket = new FakeWebSocket(url, (frame, active) => queueMicrotask(() => {
        if (frame.type === "connect") {
          const greeting = connected();
          if (greeting.type !== "connected") throw new Error("fixture");
          greeting.hello.backend = { kind: "desktop", instance_id: "ab".repeat(16), profile_id: "default", product_version: "test", capability_profile: ["desktop_root_picker_v1"] };
          active.server(greeting);
        } else if (frame.type === "choose_download_root" && cancelNormally) {
          active.server({ type: "download_root_chosen", call_id: frame.call_id, response: { root: null } });
        }
      }));
      return socket;
    }, clientInstanceId, { desktopRootPicker: true });
    const selection = client.chooseDownloadRoot({});
    socket.open();
    expect(await selection).toBeNull();
    expect(socket.closeEvents).toEqual([]);
    cancelNormally = false;
    const controller = new AbortController();
    const interrupted = client.chooseDownloadRoot({ repair_root: "root-1" }, controller.signal);
    const rejected = expect(interrupted).rejects.toThrow();
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: "folder request aborted" });
    await client.close();
  });

  it("refuses the desktop picker when the backend has not advertised it", async () => {
    let socket!: FakeWebSocket;
    const client = new WebSocketApplicationViewClient("http://127.0.0.1:3030", "token", (url) => {
      socket = new FakeWebSocket(url, (frame, active) => {
        if (frame.type === "connect") queueMicrotask(() => active.server(connected()));
      });
      return socket;
    }, clientInstanceId, { desktopRootPicker: true });
    const selection = client.chooseDownloadRoot({});
    const rejected = expect(selection).rejects.toThrow();
    socket.open();
    await rejected;
    expect(socket.sent.some((frame) => frame.type === "choose_download_root")).toBe(false);
    await client.close();
  });

  it("creates an ephemeral media URL through the application call", async () => {
    let socket: FakeWebSocket | undefined;
    const factory: ApplicationWebSocketFactory = (url) => {
      socket = new FakeWebSocket(url, (frame, active) => {
        queueMicrotask(() => {
          if (frame.type === "connect") {
            active.server(connected());
          } else if (
            frame.type === "call" &&
            frame.operation.type === "create_media_url"
          ) {
            active.server({
              type: "result",
              call_id: frame.call_id,
              result: {
                type: "media_url",
                response: {
                  torrent_id: frame.operation.torrent_id,
                  file_index: frame.operation.file_index,
                  outcome: {
                    type: "created",
                    url: "http://127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    idle_timeout_millis: "1800000",
                    absolute_timeout_millis: "86400000",
                  },
                },
              },
            });
          }
        });
      });
      return socket;
    };
    const client = new WebSocketApplicationViewClient(
      "http://127.0.0.1:3030/",
      "token",
      factory,
      clientInstanceId,
    );
    const response = client.createMediaUrl({
      torrent_id: "t1-000102030405060708090a0b0c0d0e0f",
      file_index: 2,
    });
    socket?.open();
    await expect(response).resolves.toMatchObject({
      file_index: 2,
      outcome: { type: "created" },
    });
    await client.close();
  });

  it("uses one socket for calls and acknowledges a batch only on the next pull", async () => {
    const sockets: FakeWebSocket[] = [];
    const acknowledgements: string[] = [];
    const factory: ApplicationWebSocketFactory = (url) => {
      const socket = new FakeWebSocket(url, (frame, active) => {
        queueMicrotask(() => {
          switch (frame.type) {
            case "connect":
              active.server(connected());
              break;
            case "call":
              if (frame.operation.type === "open_view_set") {
                active.server({
                  type: "result",
                  call_id: frame.call_id,
                  result: { type: "view_set_opened", response: opened() },
                });
              } else if (frame.operation.type === "dispatch") {
                active.server({
                  type: "result",
                  call_id: frame.call_id,
                  result: {
                    type: "command_response",
                    response: commandResponse(
                      frame.operation.request.request_id,
                    ),
                  },
                });
              }
              break;
            case "attach":
              active.server({
                type: "attached",
                call_id: frame.call_id,
                stream_id: frame.stream_id,
                view_set_id: frame.view_set_id,
              });
              break;
            case "ack":
              acknowledgements.push(frame.cursor);
              active.server({
                type: "view_batch",
                stream_id: frame.stream_id,
                batch: batch(frame.cursor, "3"),
              });
              break;
            case "detach":
              active.server({
                type: "detached",
                call_id: frame.call_id,
                stream_id: frame.stream_id,
              });
              break;
          }
        });
      });
      sockets.push(socket);
      return socket;
    };
    const client = new WebSocketApplicationViewClient(
      "http://127.0.0.1:3030/",
      "token",
      factory,
      clientInstanceId,
    );
    const opening = client.openViewSet({ views: [listView], options: {} });
    expect(sockets).toHaveLength(1);
    sockets[0]?.open();
    await expect(opening).resolves.toMatchObject({ view_set_id: viewSetId });

    const stream = await client.streamUpdates(viewSetId, "1");
    sockets[0]?.server({
      type: "view_batch",
      stream_id: "view-1",
      batch: batch("1", "2"),
    });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { base_cursor: "1", cursor: "2" },
    });
    expect(acknowledgements).toEqual([]);

    const command = client.dispatch(snapshotRequest("snapshot"));
    await expect(command).resolves.toMatchObject({ request_id: "snapshot" });
    expect(sockets).toHaveLength(1);
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { base_cursor: "2", cursor: "3" },
    });
    expect(acknowledgements).toEqual(["2"]);

    await stream.close();
    await client.close();
    expect(sockets[0]?.sent[0]).toMatchObject({
      type: "connect",
      client_instance_id: clientInstanceId,
      token: "token",
    });
  });

  it("rejects malformed batches without acknowledging them", async () => {
    const sockets: FakeWebSocket[] = [];
    const factory: ApplicationWebSocketFactory = (url) => {
      const socket = new FakeWebSocket(url, (frame, active) => {
        queueMicrotask(() => {
          if (frame.type === "connect") active.server(connected());
          if (frame.type === "attach") {
            active.server({
              type: "attached",
              call_id: frame.call_id,
              stream_id: frame.stream_id,
              view_set_id: frame.view_set_id,
            });
          }
        });
      });
      sockets.push(socket);
      return socket;
    };
    const client = new WebSocketApplicationViewClient(
      "http://127.0.0.1:3030/",
      null,
      factory,
      clientInstanceId,
    );
    const hello = client.hello();
    sockets[0]?.open();
    await hello;
    const stream = await client.streamUpdates(viewSetId, "1");
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    sockets[0]?.serverRaw(
      JSON.stringify({
        type: "view_batch",
        stream_id: "view-1",
        batch: { ...batch("1", "2"), epoch: "not-decimal" },
      }),
    );

    await expect(next).rejects.toThrow();
    expect(sockets[0]?.sent.some((frame) => frame.type === "ack")).toBe(false);
    expect(sockets[0]?.closeEvents).toEqual([
      { code: 4_002, reason: "invalid application frame" },
    ]);
    await stream.close();
    await client.close();
  });

  it("uses a browser-sendable private code for handshake rejection", async () => {
    const socket = new FakeWebSocket(
      "ws://gateway.test/api/v1/connect",
      (frame, active) => {
        if (frame.type === "connect") {
          active.server({
            type: "connection_error",
            error: {
              code: "authentication_failed",
              message: "application connection authentication failed",
            },
          });
        }
      },
    );
    const client = new WebSocketApplicationViewClient(
      "http://gateway.test",
      null,
      () => socket,
      clientInstanceId,
    );

    const hello = client.hello();
    socket.open();

    await expect(hello).rejects.toMatchObject({
      code: "authentication_failed",
    });
    expect(socket.closeEvents).toEqual([
      { code: 4_008, reason: "application connection rejected" },
    ]);
    await client.close();
  });

  it("keeps two attached view sets independent on one socket", async () => {
    const sockets: FakeWebSocket[] = [];
    const acknowledgements: Array<{ streamId: string; cursor: string }> = [];
    let openedCount = 0;
    const secondViewSetId = "vs_111102030405060708090a0b0c0d0e0f";
    const viewSetByStream = new Map<string, string>();
    const factory: ApplicationWebSocketFactory = (url) => {
      const socket = new FakeWebSocket(url, (frame, active) => {
        queueMicrotask(() => {
          if (frame.type === "connect") active.server(connected());
          if (frame.type === "call") {
            if (frame.operation.type === "open_view_set") {
              const openedId = openedCount++ === 0 ? viewSetId : secondViewSetId;
              active.server({
                type: "result",
                call_id: frame.call_id,
                result: {
                  type: "view_set_opened",
                  response: opened(openedId),
                },
              });
            } else if (frame.operation.type === "dispatch") {
              active.server({
                type: "result",
                call_id: frame.call_id,
                result: {
                  type: "command_response",
                  response: commandResponse(frame.operation.request.request_id),
                },
              });
            }
          }
          if (frame.type === "attach") {
            viewSetByStream.set(frame.stream_id, frame.view_set_id);
            active.server({
              type: "attached",
              call_id: frame.call_id,
              stream_id: frame.stream_id,
              view_set_id: frame.view_set_id,
            });
            active.server({
              type: "view_batch",
              stream_id: frame.stream_id,
              batch: batch("1", "2", frame.view_set_id),
            });
          }
          if (frame.type === "ack") {
            acknowledgements.push({
              streamId: frame.stream_id,
              cursor: frame.cursor,
            });
            active.server({
              type: "view_batch",
              stream_id: frame.stream_id,
              batch: batch(
                frame.cursor,
                "3",
                viewSetByStream.get(frame.stream_id) ?? viewSetId,
              ),
            });
          }
          if (frame.type === "detach") {
            active.server({
              type: "detached",
              call_id: frame.call_id,
              stream_id: frame.stream_id,
            });
          }
        });
      });
      sockets.push(socket);
      return socket;
    };
    const client = new WebSocketApplicationViewClient(
      "http://127.0.0.1:3030/",
      null,
      factory,
      clientInstanceId,
    );
    const firstOpen = client.openViewSet({ views: [listView], options: {} });
    sockets[0]?.open();
    const first = await firstOpen;
    const second = await client.openViewSet({ views: [listView], options: {} });
    const firstStream = await client.streamUpdates(first.view_set_id, "1");
    const secondStream = await client.streamUpdates(second.view_set_id, "1");
    const firstIterator = firstStream[Symbol.asyncIterator]();
    const secondIterator = secondStream[Symbol.asyncIterator]();
    await expect(firstIterator.next()).resolves.toMatchObject({
      value: { cursor: "2", view_set_id: viewSetId },
    });
    await expect(secondIterator.next()).resolves.toMatchObject({
      value: { cursor: "2", view_set_id: secondViewSetId },
    });

    await expect(secondIterator.next()).resolves.toMatchObject({
      value: { cursor: "3", view_set_id: secondViewSetId },
    });
    await expect(client.dispatch(snapshotRequest("alongside-stall"))).resolves.toMatchObject({
      request_id: "alongside-stall",
    });
    expect(sockets).toHaveLength(1);
    expect(acknowledgements).toEqual([{ streamId: "view-2", cursor: "2" }]);

    await firstStream.close();
    await secondStream.close();
    await client.close();
  });

  it("does not replay a pending command and reuses client identity on reconnect", async () => {
    const sockets: FakeWebSocket[] = [];
    const connectionStates: boolean[] = [];
    const factory: ApplicationWebSocketFactory = (url) => {
      const socket = new FakeWebSocket(url, (frame, active) => {
        queueMicrotask(() => {
          if (frame.type === "connect") active.server(connected());
          if (
            frame.type === "call" &&
            frame.operation.type === "open_view_set"
          ) {
            active.server({
              type: "result",
              call_id: frame.call_id,
              result: { type: "view_set_opened", response: opened() },
            });
          }
        });
      });
      sockets.push(socket);
      return socket;
    };
    const client = new WebSocketApplicationViewClient(
      "http://127.0.0.1:3030/",
      null,
      factory,
      clientInstanceId,
      { onConnectionState: (connected) => connectionStates.push(connected) },
    );
    const hello = client.hello();
    sockets[0]?.open();
    await hello;
    expect(connectionStates).toEqual([true]);
    const pending = client.dispatch(snapshotRequest("not-replayed"));
    await Promise.resolve();
    sockets[0]?.close(1006, "abnormal");
    await expect(pending).rejects.toMatchObject({ code: "connection_closed" });
    expect(connectionStates).toEqual([true, false]);

    const reopening = client.openViewSet({ views: [listView], options: {} });
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    await reopening;
    expect(connectionStates).toEqual([true, false, true]);
    const secondFrames = sockets[1]?.sent ?? [];
    expect(secondFrames[0]).toMatchObject({
      type: "connect",
      client_instance_id: clientInstanceId,
    });
    expect(
      secondFrames.some(
        (frame) =>
          frame.type === "call" && frame.operation.type === "dispatch",
      ),
    ).toBe(false);
    await client.close();
    expect(connectionStates).toEqual([true, false, true, false]);
  });

  it("sends torrent bytes only after the server admits the upload", async () => {
    let uploadCallId = "";
    const source = new Uint8Array([100, 52, 58, 105, 110, 102, 111, 100, 101]).buffer;
    const socket = new FakeWebSocket(
      "ws://gateway.test/api/v1/connect",
      (frame, active) => {
        queueMicrotask(() => {
          if (frame.type === "connect") {
            active.server(connected());
          } else if (frame.type === "begin_torrent_upload") {
            uploadCallId = frame.call_id;
            active.server({
              type: "torrent_upload_ready",
              call_id: frame.call_id,
              upload_id: frame.upload_id,
            });
          }
        });
      },
      (_bytes, active) => {
        queueMicrotask(() => {
          active.server({
            type: "result",
            call_id: uploadCallId,
            result: {
              type: "command_response",
              response: commandResponse("upload-request"),
            },
          });
        });
      },
    );
    const client = new WebSocketApplicationViewClient(
      "http://gateway.test",
      null,
      () => socket,
      clientInstanceId,
    );

    const upload = client.addTorrentBytes(
      {
        version: 1,
        request_id: "upload-request",
        expected_revision: null,
        storage_root: "root-a",
        start_content: true,
        await_file_selection: false,
        selection: { type: "all" },
        source_length: source.byteLength,
      },
      source,
    );
    socket.open();

    await expect(upload).resolves.toMatchObject({ request_id: "upload-request" });
    expect(socket.binarySent).toEqual([source]);
    expect(socket.sent.map((frame) => frame.type)).toEqual([
      "connect",
      "begin_torrent_upload",
    ]);
    await client.close();
  });
});

function connected(): ApplicationServerFrame {
  return {
    type: "connected",
    api_version: 1,
    encoding: "json",
    hello: hello(),
    connection_limits: {
      max_attachments: 8,
      max_pending_calls: 16,
      max_client_message_bytes: 65_536,
      max_application_payload_bytes: 16_777_216,
      max_torrent_source_bytes: 67_108_864,
      heartbeat_idle_millis: 15_000,
      heartbeat_timeout_millis: 10_000,
    },
  };
}

function hello(): ApiHello {
  return {
    api: { current: 1, minimum: 1 },
    encodings: ["json"],
    deliveries: ["poll", "long_poll", "stream"],
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

function opened(id = viewSetId): OpenViewSetResponse {
  return {
    view_set_id: id,
    lease_millis: "300000",
    effective_queue_bytes: 262_144,
    effective_views: [listView],
    initial: {
      api_version: 1,
      server_now_millis: "0",
      view_set_id: id,
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

function batch(
  baseCursor: string,
  cursor: string,
  id = viewSetId,
): UpdateBatch {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: id,
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

function snapshotRequest(requestId: string): RequestEnvelope {
  return {
    version: 1,
    request_id: requestId,
    expected_revision: null,
    command: { type: "snapshot" },
  };
}

function commandResponse(requestId: string): ResponseEnvelope {
  return {
    version: 1,
    request_id: requestId,
    revision: "0",
    status: "success",
    snapshot: {
      profile_id: "test",
      revision: "0",
      storage: { roots: [], show_add_options: true, show_file_selection: true },
      client_settings: clientSettingsFixture(),
      torrents: [],
    },
  };
}

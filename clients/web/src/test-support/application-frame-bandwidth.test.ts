import { describe, expect, it } from "vitest";

import {
  BoundedApplicationFrameCapture,
  encodedBytes,
  summarizeApplicationFrames,
  websocketFrameBytes,
  type CapturedApplicationFrame,
} from "./application-frame-bandwidth";

describe("application frame bandwidth", () => {
  it("counts UTF-8 payload and WebSocket framing in each direction", () => {
    expect(encodedBytes("é")).toBe(2);
    expect(websocketFrameBytes(125, false)).toBe(127);
    expect(websocketFrameBytes(126, false)).toBe(130);
    expect(websocketFrameBytes(65_536, false)).toBe(65_546);
    expect(websocketFrameBytes(125, true)).toBe(131);

    const frames: CapturedApplicationFrame[] = [
      {
        direction: "client_to_server",
        payload: JSON.stringify({ type: "ack", note: "é" }),
      },
      {
        direction: "server_to_client",
        payload: new Uint8Array([1, 2, 3]),
      },
    ];
    const summary = summarizeApplicationFrames(frames);
    expect(summary.client_to_server).toMatchObject({
      messages: 1,
      text_messages: 1,
      binary_messages: 0,
      frame_families: { ack: { messages: 1 } },
    });
    expect(summary.server_to_client).toMatchObject({
      messages: 1,
      binary_messages: 1,
      binary_payload_bytes: 3,
      frame_families: { binary: { messages: 1, payload_bytes: 3 } },
    });
  });

  it("attributes initial and streamed updates without assigning envelope bytes", () => {
    const initial = serverFrame("result", {
      result: {
        type: "view_set_opened",
        response: {
          initial: batch([
            {
              type: "snapshot",
              view_id: "library",
              snapshot: { type: "torrent_list", torrents: [] },
            },
          ]),
        },
      },
    });
    const streamed = serverFrame("view_batch", {
      batch: batch([
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], removed: [] },
        },
        {
          type: "snapshot",
          view_id: "torrent-peers",
          snapshot: { type: "peers", torrent_id: "t1", peers: [] },
        },
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], removed: [] },
        },
      ]),
    });
    const summary = summarizeApplicationFrames([
      { direction: "server_to_client", payload: initial },
      { direction: "server_to_client", payload: streamed },
    ]);

    expect(summary.semantic).toMatchObject({
      batches: 2,
      initial_batches: 1,
      streamed_batches: 1,
      empty_batches: 0,
      batches_with_duplicate_view_updates: 1,
      maximum_updates_for_one_view_in_batch: 2,
      reset_batches: 0,
    });
    expect(summary.semantic.view_updates.library).toMatchObject({
      updates: 3,
      snapshots: 1,
      patches: 2,
      resets: 0,
    });
    expect(summary.semantic.view_updates["torrent-peers"]).toMatchObject({
      updates: 1,
      snapshots: 1,
      patches: 0,
    });
    expect(
      summary.semantic.view_updates.library?.update_json_bytes,
    ).toBeLessThan(summary.server_to_client.payload_bytes);
  });

  it("charges a reset once to its containing frame", () => {
    const reset = serverFrame("view_batch", {
      batch: batch([
        {
          type: "reset_required",
          view_id: null,
          reason: { type: "queue_overflow" },
        },
        {
          type: "snapshot",
          view_id: "library",
          snapshot: { type: "torrent_list", torrents: [] },
        },
      ]),
    });
    const summary = summarizeApplicationFrames([
      { direction: "server_to_client", payload: reset },
    ]);
    expect(summary.semantic).toMatchObject({
      reset_batches: 1,
      reset_frame_payload_bytes: encodedBytes(reset),
    });
    expect(summary.semantic.view_updates["<view-set>"]?.resets).toBe(1);
  });

  it("retains immutable marked windows and fails closed at capture bounds", () => {
    const capture = new BoundedApplicationFrameCapture(2, 128);
    const source = new Uint8Array([1, 2]);
    capture.add({ direction: "client_to_server", payload: source });
    const mark = capture.mark();
    source[0] = 9;
    capture.add({
      direction: "server_to_client",
      payload: JSON.stringify({ type: "connected" }),
    });

    expect(capture.summarize(0, mark).client_to_server.payload_bytes).toBe(2);
    expect(capture.summarize(mark).server_to_client.messages).toBe(1);
    expect(() =>
      capture.add({ direction: "server_to_client", payload: "overflow" }),
    ).toThrow(/exceeds 2 frames/);
    expect(() => capture.summarize(2, 1)).toThrow(/invalid.*range/);

    const bytes = new BoundedApplicationFrameCapture(2, 1);
    expect(() =>
      bytes.add({ direction: "client_to_server", payload: "é" }),
    ).toThrow(/exceeds 1 payload bytes/);
  });

  it("rejects malformed application text and batch shapes", () => {
    expect(() =>
      summarizeApplicationFrames([
        { direction: "server_to_client", payload: "not-json" },
      ]),
    ).toThrow(/not JSON/);
    expect(() =>
      summarizeApplicationFrames([
        {
          direction: "server_to_client",
          payload: JSON.stringify({ type: "view_batch", batch: {} }),
        },
      ]),
    ).toThrow(/invalid update batch/);
  });
});

function serverFrame(type: string, value: Record<string, unknown>): string {
  return JSON.stringify({ type, ...value });
}

function batch(updates: readonly unknown[]) {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates,
  };
}

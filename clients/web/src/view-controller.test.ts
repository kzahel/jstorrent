import { describe, expect, it } from "vitest";

import type {
  ApiHello,
  OpenViewSetRequest,
  OpenViewSetResponse,
  RequestEnvelope,
  ResponseEnvelope,
  UpdateBatch,
  UpdateViewSetRequest,
  ViewSpec,
} from "./api";
import type {
  ApplicationUpdateStream,
  ApplicationViewClient,
} from "./api/client";
import { ApplicationViewError, HttpApiError } from "./api/client";
import { ViewController, type ViewConnectionStatus } from "./view-controller";
import { ViewSetContinuityError } from "./view-set-reducer";
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

class FakeClient implements ApplicationViewClient {
  public active = 0;
  public maximumActive = 0;
  public closedViewSet = false;
  public openCount = 0;
  public hangReopen = false;
  public readonly after: string[] = [];
  public batches: Array<UpdateBatch | Error> = [];

  public async hello(): Promise<ApiHello> {
    throw new Error("unused");
  }

  public async dispatch(request: RequestEnvelope): Promise<ResponseEnvelope> {
    return {
      version: 1,
      request_id: request.request_id,
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

  public async chooseDownloadRoot(): Promise<null> {
    return null;
  }

  public async openViewSet(
    _request: OpenViewSetRequest,
    signal?: AbortSignal,
  ): Promise<OpenViewSetResponse> {
    this.openCount += 1;
    if (this.hangReopen && this.openCount > 1) {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    }
    const openedId =
      this.openCount === 1
        ? viewSetId
        : "vs_111102030405060708090a0b0c0d0e0f";
    const initial = batch("0", "1", [
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
    ]);
    initial.view_set_id = openedId;
    initial.epoch = String(6 + this.openCount);
    return {
      view_set_id: openedId,
      lease_millis: "300000",
      effective_queue_bytes: 262_144,
      effective_views: [listView],
      initial,
    };
  }

  public async updateViewSet(
    _viewSetId: string,
    _request: UpdateViewSetRequest,
  ): Promise<void> {}

  public async nextUpdates(
    _viewSetId: string,
    after: string,
    _waitMillis: number,
    signal?: AbortSignal,
  ): Promise<UpdateBatch> {
    this.after.push(after);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      const ready = this.batches.shift();
      if (ready instanceof Error) throw ready;
      if (ready !== undefined) return ready;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new Error("poll aborted")),
          { once: true },
        );
      });
      throw new Error("unreachable");
    } finally {
      this.active -= 1;
    }
  }

  public async closeViewSet(): Promise<void> {
    this.closedViewSet = true;
  }

  public async close(): Promise<void> {}
}

class FakeStreamClient extends FakeClient {
  public readonly acknowledgements: string[] = [];
  public readonly trace: string[] = [];
  public readonly streams: FakeUpdateStream[] = [];
  public streamPlans: Array<Array<UpdateBatch | Error>> = [];

  public async streamUpdates(
    _viewSetId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<ApplicationUpdateStream> {
    this.trace.push(`attach:${after}`);
    const stream = new FakeUpdateStream(
      this.streamPlans.shift() ?? [],
      this.acknowledgements,
      this.trace,
      signal,
    );
    this.streams.push(stream);
    return stream;
  }
}

class FakeUpdateStream implements ApplicationUpdateStream {
  private closed = false;
  private previousCursor: string | null = null;
  private pending: ((result: IteratorResult<UpdateBatch>) => void) | null = null;

  public constructor(
    private readonly plan: Array<UpdateBatch | Error>,
    private readonly acknowledgements: string[],
    private readonly trace: string[],
    signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => void this.close(), { once: true });
  }

  public [Symbol.asyncIterator](): AsyncIterator<UpdateBatch> {
    return {
      next: () => this.next(),
      return: async () => {
        await this.close();
        return { done: true, value: undefined };
      },
    };
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.trace.push("stream:close");
    this.pending?.({ done: true, value: undefined });
    this.pending = null;
  }

  private async next(): Promise<IteratorResult<UpdateBatch>> {
    if (this.closed) return { done: true, value: undefined };
    if (this.previousCursor !== null) {
      this.acknowledgements.push(this.previousCursor);
      this.trace.push(`ack:${this.previousCursor}`);
      this.previousCursor = null;
    }
    const item = this.plan.shift();
    if (item instanceof Error) throw item;
    if (item !== undefined) {
      this.previousCursor = item.cursor;
      return { done: false, value: item };
    }
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }
}

describe("view controller", () => {
  it("keeps one poll in flight and acknowledges only reduced state", async () => {
    const client = new FakeClient();
    client.batches.push(
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], updates: [], removed: [] },
        },
      ]),
    );
    const reached = promiseWithResolvers<void>();
    const controller = await ViewController.open(client, [listView], (state) => {
      if (state.cursor === "2") reached.resolve();
    });
    await reached.promise;
    await waitUntil(() => client.active === 1);

    expect(client.after.slice(0, 2)).toEqual(["1", "2"]);
    expect(client.maximumActive).toBe(1);
    await controller.close();
    expect(client.closedViewSet).toBe(true);
    expect(client.active).toBe(0);
  });

  it("does not acknowledge a batch that fails continuity reduction", async () => {
    const client = new FakeClient();
    client.batches.push(batch("9", "10", []));
    const failed = promiseWithResolvers<Error>();
    const controller = await ViewController.open(
      client,
      [listView],
      () => {},
      (error) => failed.resolve(error),
    );
    expect(await failed.promise).toBeInstanceOf(ViewSetContinuityError);
    await Promise.resolve();
    expect(client.after).toEqual(["1"]);
    expect(controller.current().cursor).toBe("1");
    await controller.close();
  });

  it("reports the reconnect schedule and lets a wake skip the wait", async () => {
    const client = new FakeClient();
    client.batches.push(
      new Error("connection closed"),
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], updates: [], removed: [] },
        },
      ]),
    );
    const statuses: ViewConnectionStatus[] = [];
    const waiting = promiseWithResolvers<void>();
    const connected = promiseWithResolvers<void>();
    const controller = await ViewController.open(
      client,
      [listView],
      () => {},
      () => {},
      { retryBaseMillis: 60_000 },
      (status) => {
        statuses.push(status);
        if (status.type === "retrying" && status.nextAttemptAt !== null) {
          waiting.resolve();
        }
        if (status.type === "connected") connected.resolve();
      },
    );
    await waiting.promise;
    const scheduled = statuses.at(-1);
    expect(scheduled?.type).toBe("retrying");
    if (scheduled?.type !== "retrying" || scheduled.nextAttemptAt === null) {
      throw new Error("expected a scheduled retry");
    }
    expect(scheduled.nextAttemptAt - scheduled.since).toBeGreaterThanOrEqual(
      59_000,
    );

    controller.requestImmediatePoll();
    await connected.promise;
    expect(statuses.map((status) => status.type)).toEqual([
      "retrying",
      "retrying",
      "retrying",
      "connected",
    ]);
    expect(client.after.slice(0, 2)).toEqual(["1", "1"]);
    await controller.close();
  });

  it("stops retrying when authentication fails", async () => {
    const client = new FakeClient();
    client.batches.push(
      new HttpApiError(401, "authentication_failed", "session expired"),
    );
    const stopped = promiseWithResolvers<ViewConnectionStatus>();
    const controller = await ViewController.open(
      client,
      [listView],
      () => {},
      () => {},
      { retryBaseMillis: 1 },
      (status) => {
        if (status.type === "stopped") stopped.resolve(status);
      },
    );
    expect(await stopped.promise).toEqual({
      type: "stopped",
      reason: "signed_out",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.after).toEqual(["1"]);
    await controller.close();
  });

  it("asks for a reload when continuity cannot be kept", async () => {
    const client = new FakeClient();
    client.batches.push(batch("9", "10", []));
    const stopped = promiseWithResolvers<ViewConnectionStatus>();
    const controller = await ViewController.open(
      client,
      [listView],
      () => {},
      () => {},
      {},
      (status) => {
        if (status.type === "stopped") stopped.resolve(status);
      },
    );
    expect(await stopped.promise).toEqual({
      type: "stopped",
      reason: "reload_required",
    });
    await controller.close();
  });

  it("reopens an expired lease with the desired views", async () => {
    const client = new FakeClient();
    client.batches.push(
      new HttpApiError(404, "unknown_view_set", "view set is unavailable"),
    );
    const recovered = promiseWithResolvers<void>();
    const controller = await ViewController.open(client, [listView], (state) => {
      if (state.viewSetId.startsWith("vs_111")) recovered.resolve();
    });
    await recovered.promise;
    expect(client.openCount).toBe(2);
    expect(controller.current().viewSetId).toBe(
      "vs_111102030405060708090a0b0c0d0e0f",
    );
    await controller.close();
  });

  it("cancels and joins an in-flight reopen on close", async () => {
    const client = new FakeClient();
    client.hangReopen = true;
    client.batches.push(
      new HttpApiError(404, "unknown_view_set", "view set is unavailable"),
    );
    const controller = await ViewController.open(client, [listView], () => {});
    await waitUntil(() => client.openCount === 2);
    await controller.close();
    expect(client.active).toBe(0);
  });

  it("acknowledges streamed batches only after applying their state", async () => {
    const client = new FakeStreamClient();
    client.streamPlans.push([
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], updates: [], removed: [] },
        },
      ]),
    ]);
    const applied = promiseWithResolvers<void>();
    const controller = await ViewController.open(client, [listView], (state) => {
      if (state.cursor === "2") {
        client.trace.push("apply:2");
        applied.resolve();
      }
    });

    await applied.promise;
    await waitUntil(() => client.acknowledgements.length === 1);
    expect(client.trace.slice(0, 3)).toEqual([
      "attach:1",
      "apply:2",
      "ack:2",
    ]);
    expect(controller.current().cursor).toBe("2");

    await controller.close();
    expect(client.trace.at(-1)).toBe("stream:close");
  });

  it("does not acknowledge a streamed batch rejected by continuity", async () => {
    const client = new FakeStreamClient();
    client.streamPlans.push([batch("9", "10", [])]);
    const failed = promiseWithResolvers<Error>();
    const controller = await ViewController.open(
      client,
      [listView],
      () => {},
      (error) => failed.resolve(error),
    );

    expect(await failed.promise).toBeInstanceOf(ViewSetContinuityError);
    expect(client.acknowledgements).toEqual([]);
    expect(controller.current().cursor).toBe("1");
    await controller.close();
  });

  it("does not acknowledge a stream batch when the state callback fails", async () => {
    const client = new FakeStreamClient();
    client.streamPlans.push([
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], updates: [], removed: [] },
        },
      ]),
    ]);
    const failed = promiseWithResolvers<Error>();
    const controller = await ViewController.open(
      client,
      [listView],
      (state) => {
        if (state.cursor === "2") throw new Error("state callback failed");
      },
      (error) => failed.resolve(error),
    );

    expect((await failed.promise).message).toBe("state callback failed");
    expect(client.acknowledgements).toEqual([]);
    expect(controller.current().cursor).toBe("1");
    await controller.close();
  });

  it("reopens an expired streamed view set and reattaches at its fresh cursor", async () => {
    const client = new FakeStreamClient();
    client.streamPlans.push(
      [
        new ApplicationViewError(
          "unknown_view_set",
          "streamed view-set lease expired",
        ),
      ],
      [],
    );
    const recovered = promiseWithResolvers<void>();
    const controller = await ViewController.open(client, [listView], (state) => {
      if (state.viewSetId.startsWith("vs_111")) recovered.resolve();
    });

    await recovered.promise;
    await waitUntil(() => client.streams.length === 2);
    expect(client.openCount).toBe(2);
    expect(client.trace.filter((item) => item.startsWith("attach:"))).toEqual([
      "attach:1",
      "attach:1",
    ]);
    await controller.close();
  });
});

function batch(
  baseCursor: string,
  cursor: string,
  updates: UpdateBatch["updates"],
): UpdateBatch {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: viewSetId,
    epoch: "7",
    base_cursor: baseCursor,
    cursor,
    durable_revision: cursor,
    updates,
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

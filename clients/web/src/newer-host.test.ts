import { describe, expect, it } from "vitest";

import current from "./fixtures/view-set-trace.json";
import { HOST_CAPTURES } from "./compat/captures";
import {
  decodeApiHello,
  decodeOpenViewSetResponse,
  decodeUpdateBatch,
} from "./validation";
import {
  reduceOpenViewSet,
  reduceUpdateBatch,
  type ViewSetState,
} from "./view-set-reducer";

// A host newer than this client may add object fields and row field kinds
// the client does not know (docs/topics/mixed-version-compatibility.md).
// Decoding must accept them and produce what the same frames without the
// additions produce.

type Trace = { readonly open: unknown; readonly updates: readonly unknown[] };

const TRACES: readonly { readonly name: string; readonly trace: Trace }[] = [
  { name: "current", trace: current },
  ...HOST_CAPTURES.map((capture) => ({ name: capture.deliveries, trace: capture.trace })),
];

describe.each(TRACES)("a newer host than the $name trace", ({ trace }) => {
  it("adds object fields the client ignores", () => {
    expect(withoutNewerFields(reduce(withNewerFields(trace)))).toEqual(reduce(trace));
  });

  it("updates row fields the client does not know", () => {
    const base = reduce(trace);
    const library = base.views.library;
    if (library?.type !== "torrent_list" || library.torrents.length === 0) {
      throw new Error("trace has no library rows");
    }
    const torrentId = library.torrents[0]!.torrent_id;
    const batch = (fields: readonly unknown[]) =>
      JSON.stringify({
        server_now_millis: "0",
        api_version: 1,
        view_set_id: base.viewSetId,
        epoch: base.epoch,
        base_cursor: base.cursor,
        cursor: String(BigInt(base.cursor) + 1n),
        durable_revision: base.durableRevision,
        updates: [
          {
            type: "patch",
            view_id: "library",
            patch: {
              type: "torrent_list",
              upsert: [],
              updates: [{ torrent_id: torrentId, fields }],
              removed: [],
            },
          },
        ],
      });
    const known = { field: "display_name", value: "Renamed" };
    const newer = reduceUpdateBatch(
      base,
      decodeUpdateBatch(
        batch([known, { field: "future_field", value: { nested: [1, 2] } }]),
      ),
    );
    expect(newer).toEqual(reduceUpdateBatch(base, decodeUpdateBatch(batch([known]))));

    // An update made only of unknown kinds changes nothing.
    const unknownOnly = reduceUpdateBatch(
      base,
      decodeUpdateBatch(batch([{ field: "future_field", value: true }])),
    );
    expect(unknownOnly.views).toEqual(base.views);
  });
});

describe("a newer host's hello", () => {
  it("adds fields and capabilities the client ignores", () => {
    for (const { hello: released } of HOST_CAPTURES) {
      const hello = decodeApiHello(
        JSON.stringify({
          ...(addField(released) as object),
          capabilities: [...released.capabilities, "future_capability"],
        }),
      );
      expect(hello.capabilities).toContain("torrent_list");
    }
  });
});

function reduce(trace: Trace): ViewSetState {
  let state = reduceOpenViewSet(decodeOpenViewSetResponse(JSON.stringify(trace.open)));
  for (const update of trace.updates) {
    state = reduceUpdateBatch(state, decodeUpdateBatch(JSON.stringify(update)));
  }
  return state;
}

/** Adds an unknown field to every object in every frame. */
function withNewerFields(trace: Trace): Trace {
  return {
    open: addField(trace.open),
    updates: trace.updates.map(addField),
  };
}

function addField(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(addField);
  if (value === null || typeof value !== "object") return value;
  return {
    ...Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, addField(entry)]),
    ),
    future_host_field: { added: true },
  };
}

function withoutNewerFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNewerFields) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "future_host_field")
      .map(([key, entry]) => [key, withoutNewerFields(entry)]),
  ) as T;
}

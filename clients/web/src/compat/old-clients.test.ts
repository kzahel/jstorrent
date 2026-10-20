import { describe, expect, it } from "vitest";

import { DEFAULT_API_HELLO } from "../api";
import currentSchema from "../api/generated/v1.schema.json";
import releaseCompatibility from "../api/release-compatibility.json";
import currentTrace from "../fixtures/view-set-trace.json";
import { CLIENT_CAPTURES, type CapturedDecoder } from "./captures";
import { stripExposures, type ContractSchema } from "./exposures";

// D2 of the compatibility matrix: what the current host sends, decoded by
// each released client's own captured decoder (compat/captures/<commit>/,
// produced by scripts/compat-capture.mjs from that release's source).
// docs/tactical/359-mixed-version-compatibility-matrix.md

type Frame = {
  readonly name: string;
  readonly definition: "ApiHello" | "OpenViewSetResponse" | "UpdateBatch";
  readonly value: unknown;
};

const open = currentTrace.open as {
  initial: { updates: { snapshot: { torrents: Record<string, unknown>[] } }[] };
};
const firstTorrent = open.initial.updates[0]!.snapshot.torrents[0]!;

/** Host frames that carry every kind of addition since the released contract. */
const CURRENT_HOST_FRAMES: readonly Frame[] = [
  { name: "hello", definition: "ApiHello", value: DEFAULT_API_HELLO },
  { name: "library open", definition: "OpenViewSetResponse", value: currentTrace.open },
  {
    name: "seeding torrent with stop limits",
    definition: "OpenViewSetResponse",
    value: {
      ...open,
      initial: {
        ...open.initial,
        updates: [
          {
            ...open.initial.updates[0],
            snapshot: {
              ...open.initial.updates[0]!.snapshot,
              torrents: [
                {
                  ...firstTorrent,
                  seeding: {
                    admission: "ineligible",
                    stop: {
                      limits: {
                        ratio_percent: { type: "use_global" },
                        time_seconds: { type: "limited", value: 3_600 },
                      },
                      stopped: false,
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  },
  {
    name: "row updates of new kinds",
    definition: "UpdateBatch",
    value: {
      server_now_millis: "0",
      api_version: 1,
      view_set_id: (currentTrace.open as { view_set_id: string }).view_set_id,
      epoch: (currentTrace.open as { initial: { epoch: string } }).initial.epoch,
      base_cursor: (currentTrace.open as { initial: { cursor: string } }).initial.cursor,
      cursor: String(
        BigInt((currentTrace.open as { initial: { cursor: string } }).initial.cursor) + 1n,
      ),
      durable_revision: (currentTrace.open as { initial: { durable_revision: string } })
        .initial.durable_revision,
      updates: [
        {
          type: "patch",
          view_id: "library",
          patch: {
            type: "torrent_list",
            upsert: [],
            updates: [
              {
                torrent_id: firstTorrent.torrent_id,
                fields: [
                  { field: "display_name", value: "Renamed" },
                  { field: "private_torrent", value: true },
                  { field: "source_size_bytes", value: "65536" },
                ],
              },
            ],
            removed: [],
          },
        },
      ],
    },
  },
];

const exposures = new Set(Object.keys(releaseCompatibility.reviewedClientExposure));
const contract = currentSchema as unknown as ContractSchema;

function decode(decoder: CapturedDecoder, frame: Frame, value: unknown): string | null {
  const source = JSON.stringify(value);
  try {
    if (frame.definition === "ApiHello") decoder.decodeApiHello(source);
    else if (frame.definition === "OpenViewSetResponse") {
      decoder.reduceOpenViewSet(decoder.decodeOpenViewSetResponse(source));
    } else decoder.decodeUpdateBatch(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Frames each released client fails on today; a change must be deliberate. */
const RAW_FAILURES: Readonly<Record<string, readonly string[]>> = {
  "extension 1.1.3": [
    "library open",
    "seeding torrent with stop limits",
    "row updates of new kinds",
  ],
  "extension 1.1.4": [
    "library open",
    "seeding torrent with stop limits",
    "row updates of new kinds",
  ],
  "extension 1.1.5": [],
  "extension 1.1.6": [],
  "remote 0.3.1": [],
  "remote 0.3.2": [],
};

describe.each(CLIENT_CAPTURES)("released client $deliveries", ({ deliveries, strict, load }) => {
  it("fails on current host data only through reviewed exposures, under the hold", async () => {
    const decoder = await load();
    const raw = CURRENT_HOST_FRAMES.map((frame) => ({
      frame: frame.name,
      error: decode(decoder, frame, frame.value),
    }));
    const failing = raw.filter((result) => result.error !== null);
    if (failing.length > 0) {
      // A raw failure is a real incompatibility. Hosts may ship it only while
      // the release hold is on (or an accepted break names the release).
      expect(releaseCompatibility.strictClients.supported).toBe(true);
    }
    // Attribution: with exactly the reviewed exposures removed, every frame
    // decodes. Anything still failing is an unreviewed break.
    const unattributed = CURRENT_HOST_FRAMES.flatMap((frame) => {
      const error = decode(
        decoder,
        frame,
        stripExposures(frame.value, frame.definition, contract, exposures),
      );
      return error === null ? [] : [`${frame.name}: ${error}`];
    });
    expect(unattributed).toEqual([]);
    // Record which frames break this client today, so a change is visible.
    expect(failing.map((result) => result.frame)).toEqual(RAW_FAILURES[deliveries]);
  });

  // A tolerant client accepts additions it does not know; a strict one
  // rejects any that are not reviewed exposures.
  it(`${strict ? "rejects" : "accepts"} an unreviewed addition after reviewed exposures are removed`, async () => {
    const decoder = await load();
    const frame = CURRENT_HOST_FRAMES[2]!;
    const value = structuredClone(frame.value) as typeof open;
    const torrent = value.initial.updates[0]!.snapshot.torrents[0]! as {
      seeding: Record<string, unknown>;
    };
    torrent.seeding.unreviewed_addition = true;
    const error = decode(decoder, frame, stripExposures(value, frame.definition, contract, exposures));
    if (strict) expect(error).not.toBeNull();
    else expect(error).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_API_HELLO } from "./api";
import { CompatibilityObservations, operationName } from "./compatibility-observations";

const hello = (version: string | null) =>
  version === null
    ? DEFAULT_API_HELLO
    : {
        ...DEFAULT_API_HELLO,
        product: {
          kind: "desktop",
          version,
          build_id: "development",
          target: "aarch64-apple-darwin",
          profile_id: "default",
        },
      };

describe("compatibility observations", () => {
  it("attribute events to the host of the current connection", () => {
    const observations = new CompatibilityObservations();
    observations.connecting();
    observations.decodeFailure("handshake");
    observations.connected(hello(null));
    observations.refusedCall("dispatch:future");
    observations.connecting();
    observations.connected(hello("0.3.2"));
    observations.strippedField("export_magnet.options");
    observations.degradedAction("download_all_pending_add");
    observations.libraryAttached();
    expect(observations.snapshot()).toEqual([
      {
        peer: "unknown",
        connections: 0,
        decodeFailures: { handshake: 1, frame: 0 },
        refusedCalls: {},
        strippedFields: {},
        degradedActions: {},
        libraryAttached: false,
      },
      {
        peer: "unreported",
        connections: 1,
        decodeFailures: { handshake: 0, frame: 0 },
        refusedCalls: { "dispatch:future": 1 },
        strippedFields: {},
        degradedActions: {},
        libraryAttached: false,
      },
      {
        peer: "desktop 0.3.2",
        connections: 1,
        decodeFailures: { handshake: 0, frame: 0 },
        refusedCalls: {},
        strippedFields: { "export_magnet.options": 1 },
        degradedActions: { download_all_pending_add: 1 },
        libraryAttached: true,
      },
    ]);
  });

  it("bound peers and keys", () => {
    const observations = new CompatibilityObservations();
    for (let index = 0; index < 12; index += 1) observations.connected(hello(`0.3.${index}`));
    for (let index = 0; index < 40; index += 1) observations.refusedCall(`dispatch:c${index}`);
    const snapshot = observations.snapshot();
    expect(snapshot.map((entry) => entry.peer)).toHaveLength(9);
    const other = snapshot.find((entry) => entry.peer === "other")!;
    expect(other.connections).toBe(4);
    expect(Object.keys(other.refusedCalls)).toHaveLength(33);
    expect(other.refusedCalls.other).toBe(8);
  });

  it("name operations", () => {
    expect(
      operationName({
        type: "call",
        call_id: "1",
        operation: {
          type: "dispatch",
          request: {
            version: 1,
            request_id: "r",
            command: { type: "pause", torrent_id: "t1-00000000000000000000000000000000" },
          },
        },
      }),
    ).toBe("dispatch:pause");
    expect(operationName({ type: "detach", call_id: "1", stream_id: "s" })).toBe("detach");
  });
});

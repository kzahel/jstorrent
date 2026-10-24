import { describe, expect, it } from "vitest";

import { DEFAULT_CLIENT_SETTINGS, HOST_CAPABILITY_REGISTRY } from "./api";
import { HOST_CAPTURES } from "./compat/captures";
import { hostSupports, supportedPatch } from "./inspection/host-capabilities";
import {
  decodeApiHello,
  decodeOpenViewSetResponse,
  decodeUpdateBatch,
} from "./validation";
import { reduceOpenViewSet, reduceUpdateBatch } from "./view-set-reducer";

// D1 of the compatibility matrix: frames and values each released host's own
// source produced (compat/captures, see
// docs/tactical/359-mixed-version-compatibility-matrix.md). The current
// client must accept them and fill what those hosts never send.
describe.each(HOST_CAPTURES)("released host $deliveries", ({ hello, settings, trace }) => {
  it("accepts the hello and gates every newer capability", () => {
    const decoded = decodeApiHello(JSON.stringify(hello));
    for (const capability of HOST_CAPABILITY_REGISTRY) {
      expect(
        hostSupports({ hostCapabilities: decoded.capabilities }, capability.name),
      ).toBe(hello.capabilities.includes(capability.name));
    }
  });

  it("decodes its views with every defaulted field present", () => {
    const open = decodeOpenViewSetResponse(JSON.stringify(trace.open));
    let state = reduceOpenViewSet(open);
    for (const encoded of trace.updates) {
      state = reduceUpdateBatch(state, decodeUpdateBatch(JSON.stringify(encoded)));
    }
    const library = state.views.library;
    expect(library?.type).toBe("torrent_list");
    if (library?.type !== "torrent_list") return;
    for (const key of Object.keys(DEFAULT_CLIENT_SETTINGS)) {
      expect(library.client_settings.configured).toHaveProperty(key);
    }
    expect(library.client_settings.configured.seed_stop_ratio_percent).toEqual({
      type: "off",
    });
    expect(library.torrents.length).toBeGreaterThan(0);
  });

  it("decodes its settings snapshot with every current setting present", () => {
    const open = decodeOpenViewSetResponse(
      JSON.stringify({
        ...trace.open,
        initial: {
          ...trace.open.initial,
          updates: trace.open.initial.updates.map((update) => ({
            ...update,
            snapshot: { ...update.snapshot, client_settings: settings },
          })),
        },
      }),
    );
    const update = open.initial.updates[0];
    expect(update?.type).toBe("snapshot");
    if (update?.type !== "snapshot" || update.snapshot.type !== "torrent_list") return;
    expect(Object.keys(update.snapshot.client_settings.configured).sort()).toEqual(
      Object.keys(DEFAULT_CLIENT_SETTINGS).sort(),
    );
  });
});

describe("supportedPatch", () => {
  const registry = HOST_CAPABILITY_REGISTRY;

  it("drops keys owned by capabilities the host lacks", () => {
    expect(
      supportedPatch(
        { upload_slots: 4, seed_stop_ratio_percent: { type: "off" } },
        "client_settings",
        new Set(),
        registry,
      ),
    ).toEqual({ upload_slots: 4 });
    expect(
      supportedPatch(
        { seed_stop_time_seconds: { type: "use_global" } },
        "torrent_settings",
        new Set(),
        registry,
      ),
    ).toEqual({});
  });

  it("keeps keys the host advertises", () => {
    const patch = { seed_stop_ratio_percent: { type: "off" } } as const;
    expect(
      supportedPatch(patch, "client_settings", new Set(["seed_stop_limits"]), registry),
    ).toBe(patch);
  });

  it("treats a host without a capability list as current", () => {
    expect(hostSupports({}, "seed_stop_limits")).toBe(true);
    expect(hostSupports({ hostCapabilities: [] }, "seed_stop_limits")).toBe(false);
  });
});

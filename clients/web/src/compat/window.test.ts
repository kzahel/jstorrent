import { describe, expect, it } from "vitest";

import releaseCompatibility from "../api/release-compatibility.json";
import { CLIENT_CAPTURES, COMPAT_TODAY, HOST_CAPTURES, KNOWN_BREAKS } from "./captures";

// What depends on a delivery must go when the delivery leaves the support
// window (scripts/compat-window.mjs). These fail on the day something
// becomes removable, so cleanup is a reviewed commit rather than a memory.
// Run with COMPAT_TODAY=YYYY-MM-DD to preview a later date.
// docs/tactical/370-version-handshake-and-compatibility-reports.md
describe(`support window on ${COMPAT_TODAY}`, () => {
  const supported = new Set(
    [...HOST_CAPTURES, ...CLIENT_CAPTURES].map((capture) => capture.commit),
  );

  it("has no known break whose releases all left the window", () => {
    const stale = KNOWN_BREAKS.filter((entry) => {
      const commits =
        entry.check === "live"
          ? [entry.host, entry.client].filter((commit) => commit !== "current")
          : (entry.captures ?? []);
      return commits.length > 0 && !commits.some((commit) => commit !== undefined && supported.has(commit));
    }).map((entry) => `${entry.check}: ${entry.deliveries ?? ""}`);
    expect(stale, "remove these from compat/known-breaks.json").toEqual([]);
  });

  it("keeps the Download all fallback only while a host without it is supported", () => {
    // LiveApplication's predatesDownloadAll serves desktop 0.3.0 and Android
    // 1.0.28, recognized by batches without server_now_millis.
    const hostsWithoutServerClock = HOST_CAPTURES.filter(
      (capture) => !("server_now_millis" in capture.trace.open.initial),
    );
    expect(
      hostsWithoutServerClock.length,
      "remove predatesDownloadAll from LiveApplication and its tests",
    ).toBeGreaterThan(0);
  });

  it("lifts the strict-client release hold once no strict client is supported", () => {
    const strictClients = CLIENT_CAPTURES.filter((capture) => capture.strict);
    if (strictClients.length === 0) {
      expect(
        releaseCompatibility.strictClients.supported,
        "set strictClients.supported to false in release-compatibility.json",
      ).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";

import releaseCompatibility from "../api/release-compatibility.json";
import { CLIENT_CAPTURES, COMPAT_TODAY, HOST_CAPTURES, KNOWN_BREAKS } from "./captures";

// What depends on a delivery must go when the delivery leaves the support
// window (scripts/compat-window.mjs). These fail on the day something
// becomes removable, so cleanup is a reviewed commit rather than a memory.
// Run with COMPAT_TODAY=YYYY-MM-DD to preview a later date.
// docs/tactical/370-version-handshake-and-compatibility-reports.md
describe(`support window on ${COMPAT_TODAY}`, () => {
  const hosts = new Set(HOST_CAPTURES.map((capture) => capture.commit));
  const clients = new Set(CLIENT_CAPTURES.map((capture) => capture.commit));
  const supported = new Set([...hosts, ...clients]);

  it("has no known break whose releases all left the window", () => {
    const stale = KNOWN_BREAKS.filter((entry) => {
      if (entry.check === "live") {
        return (entry.host !== "current" && !hosts.has(entry.host ?? "")) ||
          (entry.client !== "current" && !clients.has(entry.client ?? ""));
      }
      const commits = entry.captures ?? [];
      return commits.length > 0 && !commits.some((commit) => supported.has(commit));
    }).map((entry) => `${entry.check}: ${entry.deliveries ?? ""}`);
    expect(stale, "remove these from compat/known-breaks.json").toEqual([]);
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

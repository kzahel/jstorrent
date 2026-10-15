import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions, compatToday, retirementDate, supportedDeliveries } from "./compat-window.mjs";

const delivery = (version, firstPublic, extra = {}) => ({
  surface: "extension",
  version,
  firstPublic,
  status: firstPublic === null ? "submitted" : "published",
  ...extra,
});

test("versions compare numerically", () => {
  assert.ok(compareVersions("1.0.29", "1.0.3") > 0);
  assert.equal(compareVersions("1.1", "1.1.0"), 0);
});

test("a delivery leaves 30 days after its earliest public successor", () => {
  const ledger = {
    windowDays: 30,
    deliveries: [
      delivery("1.1.3", "2026-10-11"),
      delivery("1.1.4", "2026-10-15"),
      delivery("1.1.5", null),
      delivery("1.1.6", "2026-10-20", { surface: "desktop" }),
    ],
  };
  assert.equal(retirementDate(ledger, ledger.deliveries[0]), "2026-11-14");
  // An unpublished successor does not start the clock.
  assert.equal(retirementDate(ledger, ledger.deliveries[1]), null);
  assert.deepEqual(
    supportedDeliveries(ledger, "2026-11-13").map((entry) => entry.version),
    ["1.1.3", "1.1.4", "1.1.5", "1.1.6"],
  );
  assert.deepEqual(
    supportedDeliveries(ledger, "2026-11-14").map((entry) => entry.version),
    ["1.1.4", "1.1.5", "1.1.6"],
  );
});

test("withdrawn deliveries are neither supported nor successors", () => {
  const ledger = {
    windowDays: 30,
    deliveries: [delivery("1.0.0", "2026-01-01"), delivery("1.0.1", "2026-01-02", { status: "withdrawn" })],
  };
  assert.equal(retirementDate(ledger, ledger.deliveries[0]), null);
  assert.deepEqual(supportedDeliveries(ledger, "2026-10-15").map((entry) => entry.version), ["1.0.0"]);
});

test("COMPAT_TODAY overrides the date", () => {
  assert.equal(compatToday({ COMPAT_TODAY: "2026-12-01" }), "2026-12-01");
  assert.throws(() => compatToday({ COMPAT_TODAY: "tomorrow" }));
});

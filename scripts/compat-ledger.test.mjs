import assert from "node:assert/strict";
import test from "node:test";

import { checkLedger } from "./compat-ledger.mjs";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function ledger(deliveries) {
  return {
    windowDays: 30,
    excluded: [{ tagPattern: "^desktop-v0\\.1\\.", reason: "incubation" }],
    deliveries,
  };
}

const old = {
  surface: "desktop", version: "0.2.0", tag: "desktop-v0.2.0", commit: COMMIT_A,
  status: "published", submitted: "2026-08-01", firstPublic: "2026-08-01", roles: ["host"],
};
const recent = {
  surface: "desktop", version: "0.3.0", tag: "desktop-v0.3.0", commit: COMMIT_B,
  status: "published", submitted: "2026-09-01", firstPublic: "2026-09-01", roles: ["host"],
};
const all = () => true;
const none = () => false;

test("requires captures for supported deliveries and the newest per surface", () => {
  const options = { tags: [], today: "2026-10-15" };
  assert.deepEqual(checkLedger(ledger([old, recent]), { ...options, captureHas: all }), []);
  const missing = checkLedger(ledger([old, recent]), {
    ...options,
    captureHas: (commit) => commit === COMMIT_A,
  });
  assert.equal(missing.length, 4);
  assert.match(missing[0], /desktop 0\.3\.0: capture b{12} lacks v1\.schema\.json/);
  // An older delivery 30 days after its successor became public needs nothing.
  assert.deepEqual(
    checkLedger(ledger([old, recent]), { ...options, captureHas: (commit) => commit === COMMIT_B }),
    [],
  );
  // The newest of a surface is required however old it is.
  assert.equal(checkLedger(ledger([old]), { ...options, captureHas: none }).length, 4);
  // An older delivery stays supported for 30 days after its successor ships.
  const shipped = { ...recent, firstPublic: "2026-10-10" };
  assert.equal(
    checkLedger(ledger([old, shipped]), { ...options, captureHas: (commit) => commit === COMMIT_B }).length,
    4,
  );
});

test("requires every production tag to be recorded or excluded", () => {
  const problems = checkLedger(ledger([recent]), {
    tags: ["desktop-v0.3.0", "desktop-v0.1.4", "android-v1.0.29", "extension-notes", "android-v1.0.30", "extension-v1.1.5", "remote-v0.1.0"],
    release: "android-v1.0.30",
    today: "2026-10-15",
    captureHas: all,
  });
  assert.deepEqual(problems, [
    "android-v1.0.29: production tag missing from compat/deliveries.json",
    "extension-v1.1.5: production tag missing from compat/deliveries.json",
    "remote-v0.1.0: production tag missing from compat/deliveries.json",
  ]);
});

test("rejects malformed entries", () => {
  const problems = checkLedger(
    ledger([recent, { ...recent }, { ...recent, version: "x", commit: "abc", status: "live", roles: ["server"] }]),
    { tags: [], today: "2026-10-15", captureHas: all },
  );
  assert.ok(problems.includes("desktop 0.3.0: listed twice"));
  assert.ok(problems.includes("desktop x: commit must be a full SHA"));
  assert.ok(problems.includes("desktop x: unknown status live"));
  assert.ok(problems.includes("desktop x: roles must be host and/or client"));
});

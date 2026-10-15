import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkReleaseCompatibility } from "./check-release-compatibility.mjs";

const policy = {
  strictClients: {
    supported: true,
    description: "old extensions reject",
    controlledSurfaces: ["android", "desktop"],
  },
  acceptedBreaks: {},
  reviewedStrictClientExposure: { "ClientSettings.new_field": "reason" },
};

test("blocks a strict-client break on a surface strict clients control", () => {
  const result = checkReleaseCompatibility(policy, { surface: "desktop", release: "desktop-v0.3.2" });
  assert.equal(result.ok, false);
  assert.match(result.message, /ClientSettings\.new_field/);
});

test("allows a break the maintainer accepted for that release only", () => {
  const accepted = { ...policy, acceptedBreaks: { "android-v1.0.32": "companion users told to update" } };
  assert.equal(checkReleaseCompatibility(accepted, { surface: "android", release: "android-v1.0.32" }).ok, true);
  assert.equal(checkReleaseCompatibility(accepted, { surface: "android", release: "android-v1.0.33" }).ok, false);
  const blank = { ...policy, acceptedBreaks: { "android-v1.0.32": " " } };
  assert.equal(checkReleaseCompatibility(blank, { surface: "android", release: "android-v1.0.32" }).ok, false);
});

test("allows releases once strict clients are unsupported or nothing is exposed", () => {
  const retired = { ...policy, strictClients: { ...policy.strictClients, supported: false } };
  assert.equal(checkReleaseCompatibility(retired, { surface: "desktop", release: "desktop-v0.3.2" }).ok, true);
  const clean = { ...policy, reviewedStrictClientExposure: {} };
  assert.equal(checkReleaseCompatibility(clean, { surface: "desktop", release: "desktop-v0.3.2" }).ok, true);
});

test("ignores surfaces strict clients do not control", () => {
  assert.equal(checkReleaseCompatibility(policy, { surface: "headless", release: "headless-v0.1.0" }).ok, true);
});

test("the checked-in policy is well formed", () => {
  const checkedIn = JSON.parse(
    readFileSync(new URL("../clients/web/src/api/release-compatibility.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof checkedIn.strictClients.supported, "boolean");
  assert.ok(Array.isArray(checkedIn.strictClients.controlledSurfaces));
  assert.equal(typeof checkedIn.acceptedBreaks, "object");
  for (const reason of Object.values(checkedIn.acceptedBreaks)) assert.equal(typeof reason, "string");
});

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
  reviewedClientExposure: { "ClientSettings.new_field": { kind: "field", reason: "reason" } },
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
  const clean = { ...policy, reviewedClientExposure: {} };
  assert.equal(checkReleaseCompatibility(clean, { surface: "desktop", release: "desktop-v0.3.2" }).ok, true);
});

test("blocks a new value even after strict clients are unsupported, unless only requested", () => {
  const retired = { ...policy.strictClients, supported: false };
  const value = {
    ...policy,
    strictClients: retired,
    reviewedClientExposure: {
      'TorrentView.state.enum["pending_force_check"]': { kind: "value", reason: "reason" },
    },
  };
  const result = checkReleaseCompatibility(value, { surface: "desktop", release: "desktop-v0.3.2" });
  assert.equal(result.ok, false);
  assert.match(result.message, /pending_force_check.*\(value\)/);
  const unreachable = {
    ...value,
    reviewedClientExposure: {
      "ViewSnapshot.oneOf[type=new_view]": {
        kind: "value",
        reason: "leased only",
        requestedBy: "ViewSpec.oneOf[type=new_view]",
      },
    },
  };
  assert.equal(checkReleaseCompatibility(unreachable, { surface: "desktop", release: "desktop-v0.3.2" }).ok, true);
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
  const latest = checkedIn.acceptedLatestDesktopFields;
  assert.equal(latest.minimumExtension, checkedIn.strictClients.tolerantSince.extension);
  assert.ok(latest.reason.trim());
  assert.equal(new Set(latest.fields).size, latest.fields.length);
  for (const field of latest.fields) assert.equal(checkedIn.reviewedClientExposure[field]?.kind, "field");
  for (const exposure of Object.values(checkedIn.reviewedClientExposure)) {
    assert.ok(["field", "value"].includes(exposure.kind));
    assert.equal(typeof exposure.reason, "string");
    assert.ok(exposure.requestedBy === undefined || typeof exposure.requestedBy === "string");
  }
});

test("Latest accepts only the exact authorized fields, keeping other releases and new breaks guarded", () => {
  const latest = { ...policy, strictClients: { ...policy.strictClients, tolerantSince: { extension: '1.1.5' } },
    acceptedLatestDesktopFields: { minimumExtension: '1.1.5', reason: 'maintainer authorized Latest', fields: ['ClientSettings.new_field'] } };
  assert.equal(checkReleaseCompatibility(latest, { surface: 'desktop', release: 'desktop-latest-v0.3.2' }).ok, true);
  for (const [surface, release] of [['desktop', 'desktop-v0.3.2'], ['android', 'android-v1.0.32'],
    ['desktop', 'desktop-latest-vanything'], ['desktop', 'desktop-latest-v0.3.2-extra']]) {
    assert.equal(checkReleaseCompatibility(latest, { surface, release }).ok, false);
  }
  for (const kind of ['field', 'value']) {
    const added = { ...latest, reviewedClientExposure: { ...latest.reviewedClientExposure, extra: { kind, reason: 'new break' } } };
    assert.equal(checkReleaseCompatibility(added, { surface: 'desktop', release: 'desktop-latest-v0.3.3' }).ok, false);
  }
  for (const change of [{ minimumExtension: '1.1.4' }, { reason: ' ' }, { fields: [] }]) {
    const invalid = { ...latest, acceptedLatestDesktopFields: { ...latest.acceptedLatestDesktopFields, ...change } };
    assert.equal(checkReleaseCompatibility(invalid, { surface: 'desktop', release: 'desktop-latest-v0.3.2' }).ok, false);
  }
  const samePathValue = { ...latest, reviewedClientExposure: { 'ClientSettings.new_field': { kind: 'value', reason: 'changed kind' } } };
  assert.equal(checkReleaseCompatibility(samePathValue, { surface: 'desktop', release: 'desktop-latest-v0.3.3' }).ok, false);
});

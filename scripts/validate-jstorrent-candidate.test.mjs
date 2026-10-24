import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { candidateInputs, validateCandidate } from "./validate-jstorrent-candidate.mjs";

test("production candidate retains the exact existing identities and public trust", () => {
  assert.doesNotThrow(() => validateCandidate(candidateInputs()));
});
test("debug isolation permits the guarded qualification and upgrade overrides across formatting", () => {
  const data = candidateInputs();
  data.gradle = data.gradle.replace(
    'qualificationPackage ?: upgradePackage ?: "org.rstorrent.bootstrap"',
    'qualificationPackage\n            ?: upgradePackage\n            ?: "org.rstorrent.bootstrap"',
  );
  assert.doesNotThrow(() => validateCandidate(data));
});
for (const [name, mutate] of [
  ["beta desktop identity", (d) => { d.desktop.identifier = "com.jstorrent.rstorrent"; }],
  ["beta updater route", (d) => { d.desktop.plugins.updater.endpoints = ["https://updates.graehlarts.com/rstorrent/tauri/{{target}}/{{arch}}/{{current_version}}"]; }],
  ["swapped updater key", (d) => { d.desktop.plugins.updater.pubkey = "another key"; }],
  ["beta extension key", (d) => { d.extension.key = JSON.parse(readFileSync(new URL("../clients/extension/manifest.json", import.meta.url), "utf8")).key; }],
  ["beta Android certificate", (d) => { d.certificate = readFileSync(new URL("../clients/android/incubation-upload-certificate.pem", import.meta.url), "utf8"); }],
  ["non-upgrading desktop version", (d) => { d.desktop.version = "0.2.1"; }],
  ["non-upgrading extension version", (d) => { d.extension.version = "1.1.1"; }],
  ["non-upgrading Android versionCode", (d) => { d.gradle = d.gradle.replace(/^\s*versionCode = \d+$/mu, "        versionCode = 24"); }],
  ["wrong Android package", (d) => { d.gradle = d.gradle.replace('applicationId = "com.jstorrent.app"', 'applicationId = "com.jstorrent.rstorrent"'); }],
  ["lost debug isolation", (d) => { d.gradle = d.gradle.replace('upgradePackage ?: "org.rstorrent.bootstrap"', 'upgradePackage ?: "com.jstorrent.app"'); }],
  ["production default before test overrides", (d) => { d.gradle = d.gradle.replace('qualificationPackage ?: upgradePackage', '"com.jstorrent.app" ?: upgradePackage'); }],
]) test(`rejects ${name}`, () => {
  const data = candidateInputs(); mutate(data);
  assert.throws(() => validateCandidate(data));
});

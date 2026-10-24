#!/usr/bin/env node
/** Build a private trial manifest from exact, independently authenticated CI bytes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { updaterPublicKey, verifySignature } from "./verify-desktop-signatures.mjs";
import { validateDesktopRelease } from "../.github/scripts/validate-desktop-release.mjs";

const { values } = parseArgs({ options: Object.fromEntries([
  "candidate", "source-sha", "run-id", "attempt", "asset-base-url", "installation-ids", "output", "receipts",
].map(name => [name, { type: "string" }])) });
for (const name of ["candidate", "source-sha", "run-id", "attempt", "asset-base-url", "installation-ids", "output"]) {
  assert(values[name], `Missing --${name}`);
}
assert(/^[a-f0-9]{40}$/.test(values["source-sha"]));
assert(/^[1-9][0-9]{0,23}$/.test(values["run-id"]));
assert(/^[1-9][0-9]*$/.test(values.attempt) && Number.isSafeInteger(Number(values.attempt)));
const base = new URL(values["asset-base-url"]);
assert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith("/"));
const idBytes = readFileSync(values["installation-ids"]);
assert(idBytes.length <= 4096);
const ids = JSON.parse(idBytes);
assert(Array.isArray(ids) && ids.length > 0 && ids.length <= 32 && new Set(ids).size === ids.length);
assert(ids.every(id => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)));
const directory = path.resolve(values.candidate);
function readJson(file) {
  const bytes = readFileSync(file); assert(bytes.length <= 64 * 1024);
  return JSON.parse(bytes);
}
const release = readJson(path.join(directory, "release.json"));
const latest = readJson(path.join(directory, "assets/latest.json"));
assert(release.isDraft === true && release.isPrerelease === false && release.tagName === `desktop-v${latest.version}`);
assert(release.assets.length === 15, "Expected complete AppImage-only production candidate inventory");
validateDesktopRelease({release, latest, tag:release.tagName, repository:"kzahel/jstorrent"});
const names = new Set();
for (const receipt of release.assets) {
  assert(typeof receipt.name === "string" && path.basename(receipt.name) === receipt.name && !names.has(receipt.name));
  names.add(receipt.name);
  assert(Number.isSafeInteger(receipt.size) && receipt.size > 0 && receipt.size <= 512 * 1024 * 1024);
  let size = 0; const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, "assets", receipt.name))) {
    size += chunk.length; assert(size <= receipt.size); hash.update(chunk);
  }
  assert(size === receipt.size && `sha256:${hash.digest("hex")}` === receipt.digest, `Receipt mismatch: ${receipt.name}`);
}
const platforms = {};
for (const target of ["linux-x86_64", "linux-aarch64", "darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
  const asset = latest.platforms[target];
  const name = decodeURIComponent(new URL(asset.url).pathname.split("/").at(-1));
  assert(names.has(name) && names.has(name + ".sig"));
  const signature = readFileSync(path.join(directory, "assets", name + ".sig"), "utf8").trim();
  assert(signature === asset.signature, `Signature envelope mismatch: ${target}`);
  verifySignature(path.join(directory, "assets", name), signature, updaterPublicKey("JSTorrent"));
  const receipt = release.assets.find(receipt => receipt.name === name);
  platforms[target] = { url: new URL(encodeURIComponent(name), base).href, signature, size: receipt.size, sha256: receipt.digest.slice(7) };
}
const candidate = { sourceSha: values["source-sha"], runId: values["run-id"], attempt: Number(values.attempt), version: latest.version,
  notes: latest.notes, pub_date: latest.pub_date, platforms };
const manifest = { schemaVersion: 1, productId: "jstorrent", channel: "stable", installationIds: ids, candidate };
const bytes = JSON.stringify(manifest, null, 2) + "\n"; assert(Buffer.byteLength(bytes) <= 64 * 1024);
writeFileSync(values.output, bytes, { mode: 0o600, flag: "wx" });
if (values.receipts) writeFileSync(values.receipts, JSON.stringify({ qualification: "Authenticated complete CI candidate; installed migration not yet qualified", ...candidate,
  downloadedReceiptHashesVerified: release.assets.length, originalRootPayloadSignaturesVerified: 5 }, null, 2) + "\n", { flag: "wx" });
console.log("Prepared private trial configuration; verified all 15 receipts and five delivery payload signatures.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
export function signatureKeyId(value) {
  const lines = Buffer.from(value.trim(), "base64").toString("utf8").split(/\r?\n/u);
  const packet = Buffer.from(lines[1] ?? "", "base64");
  assert.equal(packet.length, 74, "malformed minisign signature packet");
  return Buffer.from(packet.subarray(2, 10)).reverse().toString("hex").toUpperCase();
}
export function updaterPublicKey(product) {
  assert(["JSTorrent", "RSTorrent"].includes(product), "unknown signing product");
  const file = product === "JSTorrent" ? "tauri.jstorrent.conf.json" : "tauri.conf.json";
  return JSON.parse(readFileSync(path.join(root, "clients/desktop/src-tauri", file), "utf8")).plugins.updater.pubkey;
}
export function verifySignature(file, encodedSignature, encodedPublicKey) {
  const work = mkdtempSync(path.join(tmpdir(), "desktop-signature-check-"));
  try {
    writeFileSync(path.join(work, "public.key"), Buffer.from(encodedPublicKey, "base64"));
    writeFileSync(path.join(work, "signature"), Buffer.from(encodedSignature.trim(), "base64"));
    execFileSync("minisign", ["-V", "-q", "-m", file, "-p", path.join(work, "public.key"), "-x", path.join(work, "signature")], { stdio: "pipe" });
  } finally { rmSync(work, {recursive:true, force:true}); }
}
export function signatureInventory(directory, product) {
  assert(["JSTorrent", "RSTorrent"].includes(product), "unknown signing product");
  const names = readdirSync(directory).filter(name => name.endsWith(".sig")).sort();
  const expected = product === "JSTorrent" ? 6 : 10;
  assert.equal(names.length, expected, `expected all ${expected} unique updater payload signatures`);
  const prefix = product === "JSTorrent" ? product : "JSTorrent Preview";
  for (const name of names) {
    assert(name.startsWith(prefix + "_") || name.startsWith(prefix + "-"), "wrong signing product inventory");
    if (product === "JSTorrent") {
      assert(!/\.(?:deb|rpm)\.sig$/u.test(name), "production Linux release excludes DEB/RPM signatures");
    }
  }
  return names;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, product] = process.argv.slice(2);
  assert(directory && ["JSTorrent", "RSTorrent"].includes(product), "usage: verify-desktop-signatures.mjs ASSET_DIRECTORY PRODUCT");
  const names = signatureInventory(directory, product);
  const key = updaterPublicKey(product);
  for (const name of names) {
    verifySignature(path.join(directory, name.slice(0, -4)), readFileSync(path.join(directory, name), "utf8"), key);
  }
  console.log(`Verified all ${names.length} ${product} updater payloads against the retained public key`);
}

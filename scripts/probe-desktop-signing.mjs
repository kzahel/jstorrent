#!/usr/bin/env node
// Sign only an owned nonce. Never read or report the private key/password.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signatureKeyId, updaterPublicKey, verifySignature } from "./verify-desktop-signatures.mjs";

const root = path.resolve(import.meta.dirname, "..");
const work = mkdtempSync(path.join(tmpdir(), "jstorrent-signing-probe-"));
try {
  const file = path.join(work, "nonce");
  writeFileSync(file, JSON.stringify({purpose:"JSTorrent CI key qualification", nonce:randomUUID(), source:process.env.GITHUB_SHA}));
  execFileSync(process.execPath, [path.join(root, "clients/web/node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", file], {stdio:"pipe"});
  const sig = readFileSync(file + ".sig", "utf8");
  const results = {};
  for (const product of ["JSTorrent", "RSTorrent"]) {
    try { verifySignature(file, sig, updaterPublicKey(product)); results[product] = true; }
    catch { results[product] = false; }
  }
  const report = {signatureKeyId:signatureKeyId(sig), verifies:results};
  console.log(JSON.stringify(report));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  if (!results.JSTorrent) process.exitCode = 1;
} catch {
  console.error("CI signing input could not sign/verify the owned nonce; no private material is reported");
  process.exitCode = 1;
} finally { rmSync(work, {recursive:true, force:true}); }

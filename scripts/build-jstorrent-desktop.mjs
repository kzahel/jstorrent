#!/usr/bin/env node
// Production candidates only; no upload, tag, publication or profile launch.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { candidateInputs, validateCandidate } from "./validate-jstorrent-candidate.mjs";
import { validateDesktopReleaseRepository } from "./validate-desktop-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const unsigned = args.includes("--unsigned");
const forwarded = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--unsigned") continue;
  if (["--target", "--bundles"].includes(args[i]) && args[i + 1]) {
    forwarded.push(args[i], args[++i]);
  } else if (args[i] === "--debug") forwarded.push(args[i]);
  else throw new Error("usage: build-jstorrent-desktop.mjs [--unsigned] [--debug] [--target TRIPLE] [--bundles TYPE]");
}
validateDesktopReleaseRepository(root);
validateCandidate(candidateInputs());
if (!unsigned && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error("Signed JSTorrent candidates require its existing TAURI_SIGNING_PRIVATE_KEY; no beta/unsigned fallback");
}
const cli = path.join(root, "clients/web/node_modules/@tauri-apps/cli/tauri.js");
execFileSync(process.execPath, [cli, "build", "--ci", "--config", `src-tauri/tauri.${unsigned ? "package" : "release"}.conf.json`,
  "--config", "src-tauri/tauri.jstorrent.conf.json", ...(unsigned ? ["--no-sign"] : []), ...forwarded], {
  cwd: path.join(root, "clients/desktop"), env: process.env, stdio: "inherit",
});

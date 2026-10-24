#!/usr/bin/env node
// Marketing assembly retains only the frozen compatibility asset bridge.
import { readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preserveLegacyAssets } from "./preserve-legacy-remote-assets.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = join(root, "website/dist");
if (!(await stat(join(website, "index.html"))).isFile()) throw new Error("Build the marketing site first");
const target = join(website, "remote");
await rm(target, { recursive: true, force: true });
const manifest = JSON.parse(await readFile(join(root, "compat/legacy-remote-assets.json"), "utf8"));
await preserveLegacyAssets(manifest, target);
console.log(`Marketing assembled with ${manifest.files.length} frozen legacy assets; no controller document or build.`);

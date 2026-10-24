// Tags a production JSTorrent extension release; CI then tests, packages and
// submits it to the Chrome Web Store (.github/workflows/extension-release.yml).
//
//   scripts/release-extension.sh <version>
//
// Run from a clean, current main. Add the version's CHANGELOG entry first.
// Adapted from Yep Anywhere's release helper (same author, MIT).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { versionParts } from "../clients/extension/scripts/publish-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
assert(version && process.argv.length === 3, "Usage: scripts/release-extension.sh <version>");
const next = versionParts(version);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
assert.equal(git("branch", "--show-current"), "main", "Release from main");
assert.equal(git("status", "--porcelain"), "", "Commit working-tree changes before releasing");

const tag = `extension-v${version}`;
assert.equal(git("tag", "--list", tag), "", "Release tag already exists locally");
assert.equal(git("ls-remote", "--tags", "origin", `refs/tags/${tag}`), "", "Release tag already exists remotely");

const manifestPath = resolve(root, "clients/extension/manifest.jstorrent.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const previous = versionParts(manifest.version);
const order = next[0] - previous[0] || next[1] - previous[1] || next[2] - previous[2];
// The manifest may already carry an untagged version prepared earlier.
assert(order >= 0, "Choose a version at least the current extension version");
const changelog = await readFile(resolve(root, "clients/extension/CHANGELOG.md"), "utf8");
assert(changelog.includes(`## [${version}]`), "Add and commit the extension changelog entry first");

git("fetch", "origin", "main");
git("merge-base", "--is-ancestor", "origin/main", "HEAD");
if (order > 0) {
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  git("add", "clients/extension/manifest.jstorrent.json");
  git("commit", "-m", `Release JSTorrent extension ${version}`);
}
git("tag", tag);
execFileSync("git", ["push", "--atomic", "origin", "HEAD:main", `refs/tags/${tag}`], {
  cwd: root,
  stdio: "inherit",
});
const commit = git("rev-parse", "HEAD");
console.log(`Queued ${tag} at ${commit}: https://github.com/kzahel/jstorrent/actions/workflows/extension-release.yml`);
console.log("After the store submission succeeds, record it in compat/deliveries.json and capture it:");
console.log(`  node scripts/compat-capture.mjs --commit ${commit} --roles client`);

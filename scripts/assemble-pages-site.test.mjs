import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { preserveLegacyAssets, validateLegacyManifest } from "./preserve-legacy-remote-assets.mjs";
const body = Buffer.from("frozen old lazy chunk");
function manifest() { return { schema_version: 1, base_url: "https://frozen.example/remote/", build_id: "a".repeat(40), retire_not_before: "2026-11-16", files: [{ path: "assets/player-AbCd1234.js", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }] }; }
test("marketing preserves exact frozen chunks without controller HTML", async t => {
  const dir = await mkdtemp(join(tmpdir(), "legacy-assets-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await preserveLegacyAssets(manifest(), dir, async () => new Response(body));
  assert.deepEqual(await readFile(join(dir, manifest().files[0].path)), body);
  await assert.rejects(readFile(join(dir, "index.html")), { code: "ENOENT" });
  await assert.rejects(preserveLegacyAssets(manifest(), dir, async () => new Response("wrong")), /digest mismatch/);
  await assert.rejects(preserveLegacyAssets(manifest(), dir, async () => new Response(Buffer.alloc(1024))), /exceeds manifest/);
});
test("legacy manifest rejects path escapes, HTML, duplicates and resource growth", () => {
  for (const mutate of [
    m => m.files[0].path = "../index.html", m => m.files[0].path = "index.html",
    m => m.files.push(m.files[0]), m => m.files[0].bytes = 33 * 1024 * 1024,
    m => m.base_url = "http://frozen.example/remote/", m => m.files[0].sha256 = "bad",
  ]) { const m = manifest(); mutate(m); assert.throws(() => validateLegacyManifest(m)); }
});

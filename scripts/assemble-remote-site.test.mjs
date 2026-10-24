import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const buildId = "pages-ci-regression";
const relayUrl = "wss://relay.rstorrent.com/client";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "rstorrent-pages-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, "scripts/assemble-remote-site.mjs");
  await mkdir(dirname(script), { recursive: true });
  await cp(new URL("./assemble-remote-site.mjs", import.meta.url), script);
  const source = join(root, "clients/web/dist/remote");
  const target = source;
  async function write(path, body) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  await write(join(source, "index.html"), '<script src="/assets/client-AbCd1234.js"></script>');
  await write(join(source, "assets/client-AbCd1234.js"), `console.log(${JSON.stringify(buildId)}, ${JSON.stringify(relayUrl)});`);
  return {
    source, target,
    write: (path, body) => write(join(source, path), body),
    run: () => spawnSync(process.execPath, [script, buildId], { encoding: "utf8" }),
  };
}

test("Pages assembles hashed code, Wasm, images and fonts with exact manifest records", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "assets/client-AbCd1234.css",
    "assets/client-AbCd1234.wasm",
    "assets/jstorrent-DjmYCpM7.png",
    "assets/icon-AbCd1234.svg",
    "assets/font-AbCd1234.woff2",
  ]) await f.write(path, Buffer.from([0, 1, 2, 3]));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(join(f.target, "build-manifest.json"), "utf8"));
  assert.equal(manifest.build_id, buildId);
  assert.equal(manifest.relay_url, relayUrl);
  assert.equal(manifest.files.length, 7);
  for (const file of manifest.files) {
    const source = await readFile(join(f.source, file.path));
    assert.deepEqual(await readFile(join(f.target, file.path)), source);
    assert.equal(file.bytes, source.byteLength);
    assert.equal(file.sha256, createHash("sha256").update(source).digest("hex"));
  }
  assert.match(await readFile(join(f.target, "_headers"), "utf8"), /frame-ancestors 'none'/);
  assert.match(await readFile(join(f.target, "404.html"), "utf8"), /Not found/);
});

for (const path of ["assets/client.js", "assets/jstorrent.png", "assets/font-short.woff2"]) {
  test(`Pages rejects an un-hashed asset: ${path}`, async (t) => {
    const f = await fixture(t);
    await f.write(path, "unversioned bytes");
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /remote asset is not content-hashed/);
  });
}

for (const [name, path, body, error] of [
  ["foreign HTML assets", "index.html", '<script src="https://example.com/client.js"></script>', /unexpected asset origin/],
  ["a service-worker file", "sw.js", "", /contains a service worker/],
  ["service-worker registration", "assets/client-AbCd1234.js", "navigator.serviceWorker.register('/sw.js')", /registers a service worker/],
  ["wrong build identity", "assets/client-AbCd1234.js", `console.log('other-build', '${relayUrl}')`, /exact build and relay identity/],
  ["wrong relay identity", "assets/client-AbCd1234.js", `console.log('${buildId}', 'wss://other.example/client')`, /exact build and relay identity/],
]) {
  test(`Pages rejects ${name}`, async (t) => {
    const f = await fixture(t);
    await f.write(path, body);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
  });
}

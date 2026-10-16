#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourceRoot = join(repositoryRoot, "clients/web/dist/remote");
const targetRoot = sourceRoot;
const buildId = process.argv[2];
const version = process.argv[3] ?? "development";
if (!/^(?:development|\d+\.\d+\.\d+)$/.test(version)) throw new Error("Invalid remote release version");
const relayUrl = "wss://relay.rstorrent.com/client";

if (buildId === undefined || buildId.length < 1 || buildId.length > 160) {
  throw new Error("usage: assemble-remote-site.mjs BUILD_ID");
}
if (!(await stat(join(sourceRoot, "index.html"))).isFile()) {
  throw new Error("remote client must be built before assembling Pages output");
}

const html = await readFile(join(targetRoot, "index.html"), "utf8");
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
if (
  references.length === 0 ||
  references.some((reference) => !reference.startsWith("/assets/"))
) {
  throw new Error("assembled remote HTML has an unexpected asset origin");
}

const files = [];
for (const path of await filesBelow(targetRoot)) {
  const relativePath = relative(targetRoot, path).replaceAll("\\", "/");
  if (["build-manifest.json", "_headers", "404.html"].includes(relativePath)) continue;
  const body = await readFile(path);
  if (/^(?:sw|service-worker)(?:[.-]|$)/i.test(relativePath.split("/").at(-1))) {
    throw new Error(`remote output contains a service worker: ${relativePath}`);
  }
  if (relativePath.endsWith(".js") && /navigator\s*\.\s*serviceWorker/.test(body)) {
    throw new Error(`remote output registers a service worker: ${relativePath}`);
  }
  if (
    relativePath.startsWith("assets/") &&
    !/[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(relativePath)
  ) {
    throw new Error(`remote asset is not content-hashed: ${relativePath}`);
  }
  files.push({
    path: relativePath,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}
files.sort((left, right) => left.path.localeCompare(right.path));

const javascript = (
  await Promise.all(
    files
      .filter((file) => file.path.endsWith(".js"))
      .map((file) => readFile(join(targetRoot, file.path), "utf8")),
  )
).join("\n");
if (!javascript.includes(buildId) || !javascript.includes(relayUrl)) {
  throw new Error("remote JavaScript does not contain its exact build and relay identity");
}

await writeFile(
  join(targetRoot, "build-manifest.json"),
  `${JSON.stringify(
    {
      schema_version: 1,
      build_id: buildId,
      version,
      relay_url: relayUrl,
      files,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(
  `Assembled remote client ${buildId} with ${files.length} hashed records.\n`,
);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return nested.flat();
}

await writeFile(join(targetRoot, "_headers"), `/*
  Cache-Control: no-store
  Content-Security-Policy: default-src 'none'; base-uri 'none'; connect-src 'self' wss://relay.rstorrent.com https://link.jstorrent.com; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; manifest-src 'none'; media-src blob:; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; worker-src 'none'
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-Robots-Tag: noindex

/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`);
// Disable Pages' implicit SPA fallback, including service-worker probe paths.
await writeFile(join(targetRoot, "404.html"), "<!doctype html><title>Not found</title>Not found");

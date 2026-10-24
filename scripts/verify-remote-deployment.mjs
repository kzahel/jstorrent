#!/usr/bin/env node

import { createHash } from "node:crypto";

const base = process.argv[2];
const expectedBuild = process.argv[3];
if (base === undefined || expectedBuild === undefined) {
  throw new Error("usage: verify-remote-deployment.mjs BASE_URL BUILD_ID");
}

const remoteUrl = requireHttpsDeployment(base);
const htmlResponse = await fetchCold(remoteUrl);
assertStatus(htmlResponse, 200, "remote HTML");
assertHeader(htmlResponse, "cache-control", "no-store");
assertHeader(htmlResponse, "referrer-policy", "no-referrer");
assertHeader(htmlResponse, "x-content-type-options", "nosniff");
assertHeader(htmlResponse, "x-frame-options", "DENY");
const csp = htmlResponse.headers.get("content-security-policy") ?? "";
for (const directive of [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self' wss://relay.rstorrent.com https://link.jstorrent.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'none'",
  "media-src blob:",
]) {
  if (!csp.includes(directive)) {
    throw new Error(`remote CSP omitted ${directive}`);
  }
}
if (csp.includes("script-src 'none'")) {
  throw new Error("marketing CSP was combined with the remote application CSP");
}
const html = await htmlResponse.text();
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
if (
  references.length === 0 ||
  references.some((reference) => !reference.startsWith("/assets/"))
) {
  throw new Error("remote HTML references an unexpected asset origin");
}

const manifestResponse = await fetchCold(new URL("build-manifest.json", remoteUrl));
assertStatus(manifestResponse, 200, "remote build manifest");
assertHeader(manifestResponse, "cache-control", "no-store");
const manifest = await manifestResponse.json();
if (
  manifest.schema_version !== 1 ||
  manifest.build_id !== expectedBuild ||
  manifest.relay_url !== "wss://relay.rstorrent.com/client" ||
  !Array.isArray(manifest.files) ||
  manifest.files.length < 2 ||
  manifest.files.length > 4096
) {
  throw new Error("remote build manifest identity or bounds are invalid");
}

const manifested = new Set();
for (const file of manifest.files) {
  if (
    typeof file.path !== "string" ||
    file.path.startsWith("/") ||
    file.path.includes("..") ||
    typeof file.bytes !== "number" ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 1 ||
    typeof file.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(file.sha256) ||
    manifested.has(file.path)
  ) {
    throw new Error("remote build manifest contains an invalid file record");
  }
  manifested.add(file.path);
  const response = await fetchCold(new URL(file.path, remoteUrl));
  assertStatus(response, 200, file.path);
  if (file.path.startsWith("assets/")) {
    assertHeader(response, "cache-control", "public, max-age=31536000, immutable");
  } else if (file.path === "index.html") {
    assertHeader(response, "cache-control", "no-store");
  }
  if (file.path.endsWith(".wasm")) {
    assertHeader(response, "content-type", "application/wasm");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength !== file.bytes) {
    throw new Error(`${file.path} byte length differs from its manifest`);
  }
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== file.sha256) {
    throw new Error(`${file.path} digest differs from its manifest`);
  }
}
for (const reference of references) {
  const path = reference.slice(1);
  if (!manifested.has(path)) {
    throw new Error(`HTML reference is absent from manifest: ${reference}`);
  }
}
for (const worker of ["service-worker.js", "sw.js"]) {
  const response = await fetchCold(new URL(worker, remoteUrl));
  if (response.status !== 404) {
    throw new Error(`unexpected service-worker path ${worker}: ${response.status}`);
  }
}

process.stdout.write(
  `Verified remote deployment ${expectedBuild}: ${manifest.files.length} files at ${remoteUrl.origin}.\n`,
);

function fetchCold(url) {
  return fetch(url, {
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}, expected ${expected}`);
  }
}

function assertHeader(response, name, expected) {
  const actual = response.headers.get(name);
  if (actual !== expected) {
    throw new Error(`${response.url} ${name}=${String(actual)}, expected ${expected}`);
  }
}

function requireHttpsDeployment(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1") {
    throw new Error("deployment verification requires HTTPS");
  }
  return url;
}

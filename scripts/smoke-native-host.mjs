#!/usr/bin/env node

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const hostPath = process.argv[2];
if (!hostPath) {
  throw new Error("usage: smoke-native-host.mjs PATH_TO_NATIVE_HOST");
}

const request = Buffer.from(
  JSON.stringify({ id: "package-hello", protocolVersion: 1, op: "hello" }),
  "utf8",
);
const length = Buffer.alloc(4);
if (os.endianness() === "LE") {
  length.writeUInt32LE(request.length);
} else {
  length.writeUInt32BE(request.length);
}
const origin = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/";
const result = spawnSync(path.resolve(hostPath), [origin], {
  input: Buffer.concat([length, request]),
  maxBuffer: 1024 * 1024,
});

assert.equal(result.status, 0, result.stderr.toString("utf8"));
assert.equal(result.stderr.length, 0, "native host wrote diagnostics during hello");
assert.ok(result.stdout.length >= 4, "native host returned no framed response");
const responseLength =
  os.endianness() === "LE" ? result.stdout.readUInt32LE(0) : result.stdout.readUInt32BE(0);
assert.ok(responseLength <= 64 * 1024, "native host response exceeded its 64 KiB bound");
assert.equal(result.stdout.length, responseLength + 4, "native host returned trailing stdout bytes");
const response = JSON.parse(result.stdout.subarray(4).toString("utf8"));
assert.equal(response.id, "package-hello");
assert.equal(response.ok, true);
assert.equal(response.protocolVersion, 1);
assert.equal(response.result?.kind, "hello");
assert.equal(response.result?.callerOrigin, origin);
assert.deepEqual(response.result?.capabilities, ["launch_desktop", "desktop_control_v1"]);
console.log(`Native host package hello passed: ${path.basename(hostPath)}`);

#!/usr/bin/env node
// Local transport/writer benchmark. Never uses an installed browser or profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireWeb = createRequire(join(root, "clients/web/package.json"));
const { chromium } = requireWeb("playwright");
const { transformWithOxc } = await import(requireWeb.resolve("vite"));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const sizes = option("--sizes", "64,256").split(",").map(Number);
const repeats = Number(option("--repeats", "3"));
const ackDelayMs = Number(option("--ack-delay-ms", "0"));
const windowKiB = option("--window-kib", undefined);
const sinks = option("--sinks", "opfs,drain").split(",");
assert(sizes.every((size) => Number.isInteger(size) && size >= 1 && size <= 256));
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
assert(Number.isInteger(ackDelayMs) && ackDelayMs >= 0 && ackDelayMs <= 100);
assert(sinks.every((sink) => ["opfs", "drain"].includes(sink)));
if (windowKiB !== undefined) assert(["16", "32", "64"].includes(windowKiB));

const source = await readFile(join(root, "clients/web/src/direct-file-save.ts"), "utf8");
const { code } = await transformWithOxc(source, "direct-file-save.ts");
const driver = await readFile(join(root, "scripts/lib/direct-file-benchmark-browser.js"), "utf8");
const html = await readFile(join(root, "crates/rstorrent-direct-file/src/bin/experiment.html"), "utf8");
const browser = await chromium.launch({ headless: true });
const samples = [];
let child;
try {
  for (const size of sizes) {
    const fixtureArgs = ["--fixture-mib", String(size)];
    if (windowKiB !== undefined) fixtureArgs.push("--window-kib", windowKiB);
    child = spawn(join(root, "target/release/rstorrent-direct-file-experiment"), fixtureArgs, {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-8192); });
    const ready = await new Promise((resolveReady, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error(`fixture startup timeout: ${stderr}`)), 60_000);
      child.once("exit", (exit) => { clearTimeout(timeout); reject(new Error(`fixture exited ${exit}: ${stderr}`)); });
      child.stdout.on("data", (data) => {
        output += data;
        const line = output.split("\n").find((line) => line.startsWith("RSTORRENT_DIRECT_FILE_READY "));
        if (line) { clearTimeout(timeout); resolveReady(JSON.parse(line.slice(line.indexOf(" ") + 1))); }
      });
    });
    for (const sink of sinks) {
      for (let repetition = 1; repetition <= repeats; repetition++) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.route(ready.url, (route) => route.fulfill({
            contentType: "text/html", body: html.replace('<script src=', '<script type="module" src='),
          }));
          await page.route(`${ready.url}experiment.js`, (route) => route.fulfill({
            contentType: "text/javascript", body: code + "\n" + driver,
          }));
          await page.goto(ready.url);
          await page.waitForFunction(() => typeof window.runDirectBenchmark === "function");
          const result = await page.evaluate((options) => window.runDirectBenchmark(options), { sink, ackDelayMs });
          assert.equal(result.bytes, ready.fixture.length);
          if (sink === "opfs") assert.equal(result.sha256, ready.fixture.sha256);
          assert.equal(result.snapshot.active_tasks, 0);
          assert.equal(result.snapshot.open_sockets, 0);
          assert.equal(result.snapshot.active_requests, 0);
          assert.equal(result.snapshot.queued_bytes, 0);
          assert.equal(result.snapshot.transport_buffered_bytes, 0);
          assert.equal(result.snapshot.bytes_sent, ready.fixture.length);
          assert.equal(result.snapshot.fingerprint_verified, true);
          assert(result.snapshot.queue_high_water <= 512 * 1024);
          assert(result.snapshot.transport_high_water <= 512 * 1024);
          const sample = { sizeMiB: size, sink, repetition, windowKiB: windowKiB ?? 16, ackDelayMs, ...result };
          samples.push(sample);
          process.stderr.write(`${JSON.stringify(sample)}\n`);
        } finally { await context.close(); }
      }
    }
    await stopChild();
  }
  const report = {
    environment: { platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
      browser: browser.version(), build: "release", consumer: "clients/web/src/direct-file-save.ts" },
    limitations: "Same-machine direct host candidates; local experiment signaling adapter, no relay/auth qualification. OPFS substitutes for external picker only in harness. Delayed ACK is application delay, not WAN emulation. Verification allocations occur after transfer timing. Drain checks deterministic bytes without retaining payload.",
    samples,
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  const output = option("--output", undefined);
  if (output) await writeFile(resolve(output), json);
  process.stdout.write(json);
} finally {
  await stopChild();
  await browser.close();
}

async function stopChild() {
  if (!child || child.exitCode !== null) { child = undefined; return; }
  const stopping = child;
  child = undefined;
  const exited = once(stopping, "exit");
  stopping.kill("SIGINT");
  const timeout = setTimeout(() => stopping.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timeout); }
}

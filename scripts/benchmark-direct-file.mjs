#!/usr/bin/env node
// Local transport/writer benchmark. Never uses an installed browser or profile.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireWeb = createRequire(join(root, "clients/web/package.json"));
const { chromium } = requireWeb("playwright");
const { build, transformWithOxc } = await import(requireWeb.resolve("vite"));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const delayMs = Number(option("--delay-ms", "0"));
const rateMiB = Number(option("--rate-mib", "0"));
assert(Number.isInteger(rateMiB) && rateMiB >= 0 && rateMiB <= 128);
const lossEvery = Number(option("--loss-every", "0"));
assert(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 250);
assert(Number.isInteger(lossEvery) && (lossEvery === 0 || lossEvery >= 20));
const sourceKind = option("--source", "verified");
const rawBufferKiB = Number(option("--raw-buffer-kib", "512"));
assert([16, 32, 64, 128, 256, 512].includes(rawBufferKiB));
const cancelAfterMiB = Number(option("--cancel-after-mib", "0"));
assert(["verified", "generated", "raw", "browser", "legacy"].includes(sourceKind));
assert(Number.isInteger(cancelAfterMiB) && cancelAfterMiB >= 0 && cancelAfterMiB <= 255);
const rawConsumer = ["raw", "browser"].includes(sourceKind);
assert(!cancelAfterMiB || rawConsumer);
const sizes = option("--sizes", "64,256").split(",").map(Number);
const repeats = Number(option("--repeats", "3"));
const ackDelayMs = Number(option("--ack-delay-ms", "0"));
const windowKiB = option("--window-kib", "64");
const sinks = option("--sinks", rawConsumer ? "drain" : "opfs,drain").split(",");
assert(sizes.every((size) => Number.isInteger(size) && size >= 1 && size <= 256));
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
assert(Number.isInteger(ackDelayMs) && ackDelayMs >= 0 && ackDelayMs <= 100);
assert(!rawConsumer || (sinks.length === 1 && sinks[0] === "drain"));
assert(!cancelAfterMiB || sizes.every((size) => size > cancelAfterMiB));
assert(!rawConsumer || !args.includes("--protocol-checks"));
assert(!rawConsumer || ackDelayMs === 0);
assert(sinks.every((sink) => ["opfs", "drain"].includes(sink)));
if (windowKiB !== undefined) assert(["16", "32", "64"].includes(windowKiB));

const consumerRef = option("--consumer-ref", undefined);
if (consumerRef !== undefined) assert(/^[a-f0-9]{7,40}$/.test(consumerRef));
let source;
if (consumerRef) {
  const result = spawnSync("git", ["show", `${consumerRef}:clients/web/src/direct-file-save.ts`], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  source = result.stdout;
} else source = await readFile(join(root, "clients/web/src/direct-file-save.ts"), "utf8");
let code;
if (consumerRef) ({ code } = await transformWithOxc(source, "direct-file-save.ts"));
else {
  const bundle = await build({ configFile: false, root: join(root, "clients/web"), logLevel: "silent",
    build: { write: false, minify: false, lib: { entry: join(root, "clients/web/src/direct-file-save.ts"), formats: ["es"] } } });
  code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((item) => item.type === "chunk").code;
}
const creditKiB = Number(option("--credit-kib", "8192"));
const transportKiB = Number(option("--transport-kib", "8192"));
const batchKiB = Number(option("--write-batch-kib", "128"));
assert(Number.isInteger(creditKiB) && creditKiB >= 1 && creditKiB <= 8192);
assert(Number.isInteger(transportKiB) && transportKiB >= 64 && transportKiB <= 8192);
assert(Number.isInteger(batchKiB) && batchKiB >= 1 && batchKiB <= 256);
const driver = await readFile(join(root, rawConsumer ? "scripts/lib/direct-file-raw-benchmark-browser.js" : "scripts/lib/direct-file-benchmark-browser.js"), "utf8");
const html = await readFile(join(root, "crates/rstorrent-direct-file/src/bin/experiment.html"), "utf8");
const temporary = await mkdtemp(join(tmpdir(), "jstorrent-direct-benchmark-"));
const browser = await chromium.launch({ headless: true }).catch(async (error) => {
  await rm(temporary, { recursive: true, force: true });
  throw error;
});
const samples = [];
let child;
const interrupted = async () => { await stopChild(); await browser.close(); };
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);
try {
  for (const size of sizes) {
    assert(!(delayMs || lossEvery || rateMiB) || sourceKind === "verified");
    const fixtureArgs = ["--rate-mib", String(rateMiB), "--delay-ms", String(delayMs), "--loss-every", String(lossEvery), "--raw-buffer-kib", String(rawBufferKiB), "--fixture-mib", String(size), "--source", sourceKind === "browser" ? "verified" : sourceKind];
    if (args.includes("--diagnostics")) fixtureArgs.push("--diagnostics");
    if (windowKiB !== undefined) fixtureArgs.push("--window-kib", windowKiB);
    child = spawn(join(root, `target/release/rstorrent-direct-file-experiment${process.platform === "win32" ? ".exe" : ""}`), fixtureArgs, {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary },
    });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-8192); });
    const ready = await new Promise((resolveReady, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error(`fixture startup timeout: ${stderr}`)), 60_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (exit) => { clearTimeout(timeout); reject(new Error(`fixture exited ${exit}: ${stderr}`)); });
      child.stdout.on("data", (data) => {
        output += data;
        const line = output.split("\n").find((line) => line.startsWith("RSTORRENT_DIRECT_FILE_READY "));
        if (line) { clearTimeout(timeout); resolveReady(JSON.parse(line.slice(line.indexOf(" ") + 1))); }
      });
    });
    if (args.includes("--v2-checks")) {
      const rangeBundle = await build({ configFile: false, root: join(root, "clients/web"), logLevel: "silent",
        build: { write: false, minify: false, lib: { entry: join(root, "clients/web/src/direct-file-range-stream.ts"), formats: ["es"] } } });
      const rangeCode = (Array.isArray(rangeBundle) ? rangeBundle[0] : rangeBundle).output.find(item => item.type === "chunk").code;
      const checks = await readFile(join(root, "scripts/lib/direct-file-v2-checks.js"), "utf8");
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.route(`${ready.url}experiment.js`, route => route.fulfill({ contentType: "text/javascript", body: checks }));
        await page.route(`${ready.url}ranges.js`, route => route.fulfill({ contentType: "text/javascript", body: rangeCode }));
        await page.route(ready.url, route => route.fulfill({ contentType: "text/html", body: html.replace('<script src=', '<script type="module" src=') }));
        await page.goto(ready.url); await page.waitForFunction(() => typeof window.runV2Checks === "function");
        page.on("console", message => process.stderr.write(`checks: ${message.text()}\n`));
        const result = await page.evaluate(() => window.runV2Checks());
        assert.equal(result.ok, true); process.stderr.write(`v2 checks: ${JSON.stringify(result)}\n`);
      } finally { await context.close(); }
    }
    if (args.includes("--protocol-checks")) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(ready.url);
        if (args.includes("--inactivity-checks")) await page.evaluate(() => { window.__checkInactivity = true; });
        await page.locator("#start").click();
        await page.waitForFunction(() => window.__result !== undefined, undefined, { timeout: 90_000 });
        const result = await page.evaluate(() => window.__result);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.verifiedRanges, 4);
        assert.deepEqual(result.invalidAcksRejected, ["future", "duplicate", "flood"]);
        if (args.includes("--inactivity-checks")) assert.equal(result.inactivityObserved, true);
        assert(result.server.queue_high_water <= 512 * 1024);
        assert(result.server.transport_high_water <= 512 * 1024);
        await page.locator("#close").click();
        await page.waitForFunction(() => window.__terminal !== undefined);
        const terminal = await page.evaluate(() => window.__terminal);
        assert.equal(terminal.active_tasks + terminal.open_sockets + terminal.active_requests + terminal.queued_bytes + terminal.transport_buffered_bytes, 0);
        process.stderr.write(`${JSON.stringify({ protocolChecks: result, terminal })}\n`);
      } finally { await context.close(); }
    }
    for (const sink of sinks) {
      for (let repetition = 1; repetition <= repeats; repetition++) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.route(ready.url, (route) => route.fulfill({
            contentType: "text/html", body: html.replace('<script src=', '<script type="module" src='),
          }));
          await page.route(`${ready.url}experiment.js`, (route) => route.fulfill({
            contentType: "text/javascript", body: (rawConsumer ? "" : 'import { saveDirectFile, prepareDirectFileSink } from "/consumer.js";\n') + driver,
          }));
          await page.route(`${ready.url}consumer.js`, (route) => route.fulfill({ contentType: "text/javascript", body: code }));
          await page.goto(ready.url);
          await page.waitForFunction(() => typeof window.runDirectBenchmark === "function");
          const result = await page.evaluate((options) => window.runDirectBenchmark(options), { sink, ackDelayMs, cancelAfterMiB, peerKind: sourceKind, rangeStreamOptions: { budgetBytes: creditKiB * 1024, transportBytes: transportKiB * 1024, writeBatchBytes: batchKiB * 1024 } });
          if (cancelAfterMiB) {
            assert.equal(result.cancelled, true);
            assert(result.bytes >= cancelAfterMiB * 1048576 && result.bytes < ready.fixture.length);
          } else assert.equal(result.bytes, ready.fixture.length);
          if (sink === "opfs") assert.equal(result.sha256, ready.fixture.sha256);
          assert.equal(result.snapshot.active_tasks, 0);
          assert.equal(result.snapshot.open_sockets, 0);
          assert.equal(result.snapshot.active_requests, 0);
          assert.equal(result.snapshot.queued_bytes, 0);
          assert.equal(result.snapshot.credit_reserved_bytes ?? 0, 0);
          assert((result.snapshot.credit_high_water ?? 0) <= creditKiB * 1024);
          assert.equal(result.snapshot.transport_buffered_bytes, 0);
          if (sourceKind === "browser") {
            assert.equal(result.snapshot.bytes_sent, 0);
            assert(result.senderHighWater > 0 && result.senderHighWater <= 512 * 1024);
          } else {
            if (cancelAfterMiB) assert(result.snapshot.bytes_sent >= result.bytes);
            else assert.equal(result.snapshot.bytes_sent, ready.fixture.length);
            assert.equal(result.snapshot.fingerprint_verified, true);
          }
          assert(result.snapshot.queue_high_water <= 512 * 1024);
          assert(result.snapshot.transport_high_water <= (sourceKind === "raw" ? rawBufferKiB : Math.max(512, transportKiB) + 1) * 1024);
          assert.equal(result.snapshot.network_overflow ?? 0, 0);
          if (lossEvery) assert(result.snapshot.network_dropped > 0);
          const sample = { rateMiB, delayMs, lossEvery, creditKiB, transportKiB, batchKiB, source: sourceKind, sizeMiB: size, sink, repetition, windowKiB: rawConsumer ? null : Number(windowKiB ?? 16), rawBufferKiB: sourceKind === "raw" ? rawBufferKiB : null, ackDelayMs, cancelAfterMiB, ...result };
          samples.push(sample);
          process.stderr.write(`${JSON.stringify(sample)}\n`);
        } finally { await context.close(); }
      }
    }
    await stopChild();
  }
  const report = {
    environment: { platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
      browser: browser.version(), build: "release", consumer: rawConsumer ? "raw checking receiver" : "clients/web/src/direct-file-save.ts", source: sourceKind, consumerRef },
    limitations: "Same-machine direct host candidates; local experiment signaling adapter, no relay/auth qualification. OPFS substitutes for external picker only in harness. Delayed ACK is application delay, not WAN emulation. Verification allocations occur after transfer timing. Drain checks deterministic bytes without retaining payload. Raw measures the current RTC stack/driver/browser at a 512-KiB sender cap, not a universal WebRTC ceiling or product receive-memory guarantee.",
    samples,
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  const output = option("--output", undefined);
  if (output) await writeFile(resolve(output), json);
  process.stdout.write(json);
} finally {
  try { await stopChild(); }
  finally {
    try { await browser.close(); }
    finally {
      await rm(temporary, { recursive: true, force: true });
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
    }
  }
}

async function stopChild() {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) { child = undefined; return; }
  const stopping = child;
  child = undefined;
  const exited = once(stopping, "exit");
  stopping.kill("SIGINT");
  const timeout = setTimeout(() => stopping.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timeout); }
}

#!/usr/bin/env node
// A headed, production-ID rehearsal against an isolated macOS candidate.
// Register the candidate's host first; never use this on a personal library.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "../clients/web/node_modules/playwright-core/index.mjs";

const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) =>
  [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
for (const name of ["--extension", "--profile", "--mc", "--registry", "--claim", "--output"]) {
  assert(options[name], `provide ${name}`);
}
const extension = path.resolve(options["--extension"]);
const manifest = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));
const extensionId = "dbokmlpefliilbjldladbimlcfgbolhk";
const appId = "com.jstorrent.check";
const report = { extensionVersion: manifest.version, checks: [] };
function passed(check, details = {}) {
  report.checks.push({ check, ...details });
  console.log(JSON.stringify({ check, passed: true, ...details }));
}
function mc(...args) {
  const result = JSON.parse(execFileSync(options["--mc"], [
    "--registry", options["--registry"], "--target", "host",
    "--claim", options["--claim"], ...args,
  ], { encoding: "utf8" }));
  assert(result.accepted, `${args.join(" ")}: ${result.errorCode} ${result.message}`);
  return result.data;
}
const context = await chromium.launchPersistentContext(path.resolve(options["--profile"]), {
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1180, height: 760 },
});
let page;
async function bootstrap(op) {
  return page.evaluate(op => chrome.runtime.sendMessage({ type: "nativeBootstrap", op }), op);
}
async function library() {
  await page.locator("#companion-bootstrap").waitFor({ state: "hidden", timeout: 25_000 });
  await page.locator("#app").waitFor({ state: "visible", timeout: 25_000 });
  const disclosure = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Continue", exact: true }) });
  if (await disclosure.isVisible()) {
    await disclosure.getByRole("checkbox").uncheck();
    await disclosure.getByRole("button", { name: "Continue", exact: true }).click();
  }
  assert.equal(await page.locator("#companion-bootstrap").isVisible(), false);
}
async function snapshot() {
  // Credentials remain in browser memory and are never returned to the runner.
  return page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: "nativeBootstrap", op: "attach_control" });
    if (!response.ok) throw new Error("attach failed");
    const ready = response.result;
    const socket = new WebSocket(ready.endpoint.replace("http:", "ws:") + "/api/v1/connect");
    const frames = [];
    let waiting;
    socket.onmessage = event => {
      const frame = JSON.parse(event.data);
      if (waiting) { const resolve = waiting; waiting = undefined; resolve(frame); }
      else frames.push(frame);
    };
    const next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("control timed out")), 6000);
      waiting = frame => { clearTimeout(timer); resolve(frame); };
    });
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    try {
      socket.send(JSON.stringify({ type: "connect", api_version: 1, encoding: "json", client_instance_id: crypto.randomUUID().replaceAll("-", ""), token: ready.credential }));
      const hello = await next();
      if (hello.type !== "connected" || hello.hello.backend.instance_id !== ready.instanceId) throw new Error("identity mismatch");
      socket.send(JSON.stringify({ type: "call", call_id: "snapshot", operation: { type: "dispatch", request: { version: 1, request_id: crypto.randomUUID(), command: { type: "snapshot" } } } }));
      const frame = await next();
      const state = frame.result?.response?.snapshot;
      if (!state) throw new Error("snapshot failed");
      return { instanceId: ready.instanceId, profileId: ready.profileId, torrents: state.torrents.length, productVersion: hello.hello.backend.product_version };
    } finally { socket.close(); }
  });
}
try {
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  assert.equal(await page.evaluate(() => chrome.runtime.id), extensionId);
  const stopped = await bootstrap("attach_control");
  if (stopped.error?.code === "native_host_unavailable") {
    const diagnostic = await page.evaluate(() => new Promise(resolve => {
      chrome.runtime.sendNativeMessage("com.jstorrent.rstorrent.native", { id: "diagnostic", protocolVersion: 1, op: "hello" }, () => resolve(chrome.runtime.lastError?.message ?? "host responded"));
    }));
    throw new Error(String(diagnostic));
  }
  assert.equal(stopped.error?.code, "control_unavailable", JSON.stringify(stopped.error));
  passed("unpacked production identity and passive stopped attach");
  // A popup rendered as a tab has no toolbar launch intent. Click explicitly.
  const companionOpened = context.waitForEvent("page");
  await page.locator("#launch").click();
  const popup = page;
  page = await companionOpened;
  await page.waitForLoadState();
  await library();
  await popup.close();
  const initial = await snapshot();
  assert.equal(initial.torrents, 0, "candidate must have a fresh isolated library");
  const cold = mc("desktop", "windows", "--target", appId);
  assert(Array.isArray(cold.windows), "Machine Control must report window inventory");
  assert.equal(cold.windows.length, 0, "background start must not open the native window");
  passed("cold background launch and authenticated empty library", initial);
  const race = await page.evaluate(async () => {
    const replies = await Promise.all(Array.from({ length: 12 }, () => chrome.runtime.sendMessage({ type: "nativeBootstrap", op: "start_control" })));
    return replies.map(reply => ({ ok: reply.ok, instanceId: reply.result?.instanceId }));
  });
  assert(race.every(reply => reply.ok && reply.instanceId === initial.instanceId));
  passed("twelve explicit starts converge on one runtime");
  await page.getByRole("button", { name: "Open desktop window", exact: true }).click();
  await page.waitForTimeout(1500);
  const native = mc("desktop", "snapshot", "--target", appId, "--max-depth", "6", "--max-elements", "200");
  assert.equal(native.application.bundleId, appId);
  assert(native.elements.some(element => element.role === "AXWindow"));
  passed("Machine Control observes explicitly opened native window");
  await page.reload();
  await library();
  assert.equal((await snapshot()).instanceId, initial.instanceId);
  passed("page reload attaches to the same library and runtime");
  await page.close();
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/companion/companion.html?backend=desktop`);
  await library();
  assert.equal((await snapshot()).instanceId, initial.instanceId);
  passed("closing and reopening browser UI preserves native owner");
  await page.screenshot({ path: path.join(path.dirname(options["--output"]), "connected.png") });
  mc("desktop", "application", "terminate", "--target", appId);
  passed("Machine Control requests graceful native Quit");
  await page.getByRole("button", { name: "Start", exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(35_000);
  assert.equal((await bootstrap("attach_control")).error?.code, "control_unavailable");
  passed("Quit stays stopped for 35 seconds of passive reconnect");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await library();
  const restarted = await snapshot();
  assert.notEqual(restarted.instanceId, initial.instanceId);
  assert.equal(restarted.torrents, 0);
  passed("explicit Start creates a fresh runtime on the same empty library");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  if (page && !page.isClosed()) {
    console.error((await page.locator("body").innerText()).slice(0, 2000));
    await page.screenshot({ path: path.join(path.dirname(options["--output"]), "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await context.close();
  // Terminate only the fixed isolated candidate identity, preserving user apps.
  try { mc("desktop", "application", "terminate", "--target", appId); }
  catch (error) {
    report.passed = false;
    report.cleanupError = String(error);
    process.exitCode = 1;
    console.error(`Candidate cleanup: ${error}`);
  }
  writeFileSync(options["--output"], JSON.stringify(report, null, 2) + "\n");
}

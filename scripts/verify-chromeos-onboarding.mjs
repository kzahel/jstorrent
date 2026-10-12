#!/usr/bin/env node
// Controlled packaged-product presentation evidence, never a Play/ARC pass.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { chromium } from "../clients/web/node_modules/playwright-core/index.mjs";

const archive = process.argv[2];
if (!archive) throw new Error("Usage: node scripts/verify-chromeos-onboarding.mjs EXTENSION.zip");
const staging = mkdtempSync(path.join(tmpdir(), "rstorrent-253-browser-"));
let browser;
try {
  execFileSync("unzip", ["-q", path.resolve(archive), "-d", staging]);
  const manifest = JSON.parse(readFileSync(path.join(staging, "manifest.json")));
  const id = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32).replace(/[0-9a-f]/gu, nibble => String.fromCharCode(97 + parseInt(nibble, 16)));
  const origin = `chrome-extension://${id}`;
  for (const scenario of ["denied", "offline", "legacy", "incompatible", "rejected", "expired"]) {
    const profile = mkdtempSync(path.join(tmpdir(), "rstorrent-253-profile-"));
    const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${staging}`, `--load-extension=${staging}`] });
    browser = context;
    try {
      const page = await context.newPage();
      await page.addInitScript(({ scenario }) => {
        globalThis.chrome = {
          runtime: { getManifest: () => ({ version: "1.1.2" }) },
          permissions: { contains: async () => scenario !== "denied" },
          storage: { local: { get: async () => ({}), set: async () => {} } },
        };
        globalThis.__probes = 0;
        globalThis.fetch = async (url) => {
          globalThis.__probes += 1;
          const parsed = new URL(url);
          if (scenario === "legacy" && parsed.port === "7800") return new Response(JSON.stringify({ port: 7800, protocolVersion: 1, behaviorVersion: 1, version: "1.0.24", paired: true, capabilities: { ioWebSocket: true, controlEvents: true, rootsRead: true, fileOps: true } }));
          if (["incompatible", "rejected", "expired"].includes(scenario) && parsed.port === "3030") {
            if (parsed.pathname.endsWith("/hello")) return new Response(JSON.stringify({ product: "rstorrent", backend: "android", port: 3030, protocol_min: scenario === "incompatible" ? 2 : 1, protocol_max: scenario === "incompatible" ? 2 : 1, nonce: "abcdefghijklmnop", paired: false }));
            if (parsed.pathname.endsWith("/pairing/request")) return new Response(JSON.stringify({ request_id: "abcdefghijklmnop", expires_in_seconds: 120 }));
            if (parsed.pathname.endsWith("/pairing/poll")) return new Response(JSON.stringify({ status: scenario }));
          }
          throw new TypeError("controlled offline fixture");
        };
      }, { scenario });
      await page.goto(`${origin}/companion/companion.html`);
      const retry = page.getByRole("button", { name: "Retry connection", exact: true });
      if (scenario === "offline") {
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await retry.waitFor();
        const probes = await page.evaluate(() => globalThis.__probes);
        await page.waitForTimeout(2200);
        assert.equal(await page.evaluate(() => globalThis.__probes), probes);
        await retry.click();
        await page.getByText("JSTorrent Android did not respond.", { exact: false }).waitFor({ timeout: 25_000 });
      }
      await retry.waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: "Preview connection support context" }).click();
      const report = JSON.parse(await page.locator("#companion-context").inputValue());
      assert.equal(report.app_presence, "unknown"); assert.equal(report.play_availability, "unknown");
      assert.equal(report.category, { denied: "permission_denied", offline: "service_unreachable", legacy: "app_update_required", incompatible: "extension_update_required", rejected: "pairing_rejected", expired: "pairing_expired" }[scenario]);
      if (scenario === "denied") assert.equal(await page.evaluate(() => globalThis.__probes), 0);
      assert.equal(await page.locator("#app").isVisible(), false);
      const popupPromise = context.waitForEvent("page");
      await page.getByRole("link", { name: "Use Linux instead" }).click();
      const help = await popupPromise;
      await help.waitForLoadState();
      assert.match(help.url(), /setup\.html#linux$/u);
      assert.match(await help.locator("#linux").innerText(), /separate Linux library/u);
      assert.match(await help.locator("#linux").innerText(), /unsupported/u);
      await help.getByText("Play is not enabled or setup is unfinished", { exact: true }).click();
      assert.match(await help.locator("details").first().innerText(), /permitted/u);
      await help.getByText("Installation failed, or the app is unavailable", { exact: true }).click();
      assert.match(await help.locator("details").nth(2).innerText(), /cannot determine its cause/u);
      for (const width of [320, 1440]) {
        await help.setViewportSize({ width, height: 900 });
        assert.equal(await help.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      console.log(`PASS injected packaged journey: ${scenario}, separate Linux guidance, support preview`);
    } finally { await context.close(); browser = undefined; rmSync(profile, { recursive: true, force: true }); }
  }
  // Exact packaged Linux page; all OS/permission/network states below are injected.
  const profile = mkdtempSync(path.join(tmpdir(), "rstorrent-253-linux-profile-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${staging}`, `--load-extension=${staging}`] });
  browser = context;
  try {
    for (const scenario of ["denied", "unreachable", "timeout", "cancel", "wrong-service", "incompatible", "invalid", "oversized", "http-error", "ready"]) {
      const page = await context.newPage();
      await page.route("http://jstorrent.localhost:3030/**", route => route.fulfill({
        contentType: "text/html", body: "<main>Controlled Linux navigation destination</main>",
      }));
      await page.addInitScript(({ scenario }) => {
        globalThis.__linuxScenario = scenario; globalThis.__linuxProbes = 0;
        globalThis.chrome = { permissions: {
          contains: async () => globalThis.__linuxScenario !== "denied",
          request: async () => globalThis.__linuxScenario !== "denied",
        } };
        globalThis.fetch = async (_url, { signal }) => {
          globalThis.__linuxProbes += 1;
          const state = globalThis.__linuxScenario;
          if (state === "unreachable") throw new TypeError("controlled network failure");
          if (["timeout", "cancel"].includes(state)) {
            return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true }));
          }
          if (state === "oversized") return new Response("x".repeat(4097));
          if (state === "invalid") return new Response("invalid json");
          if (state === "http-error") return new Response("failed", { status: 503 });
          return new Response(JSON.stringify({ status: "ok", build_id: "0.1.0",
            product: state === "wrong-service" ? "other" : "rstorrent-crostini",
            launch_protocol: state === "incompatible" ? 2 : 1 }));
        };
      }, { scenario });
      await page.goto(`${origin}/crostini/connect.html`);
      if (scenario === "ready") {
        await page.waitForURL(url => url.origin === "http://jstorrent.localhost:3030" && url.pathname === "/" && url.searchParams.has("connect"));
      } else {
        const retry = page.getByRole("button", { name: "Retry", exact: true });
        if (scenario === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await retry.waitFor({ timeout: 15_000 });
        const expected = { denied: /not granted/u, unreachable: /could not be reached/u,
          timeout: /within 10 seconds/u, cancel: /canceled/u, "wrong-service": /not JSTorrent/u,
          incompatible: /compatible updates/u, invalid: /invalid response/u,
          oversized: /invalid response/u, "http-error": /returned an error/u }[scenario];
        assert.match(await page.locator("#connection-status").innerText(), expected);
        const probes = await page.evaluate(() => globalThis.__linuxProbes);
        if (scenario === "denied") assert.equal(probes, 0);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => globalThis.__linuxProbes), probes);
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        if (["unreachable", "denied"].includes(scenario)) {
          await page.evaluate(() => { globalThis.__linuxScenario = "ready"; });
          await retry.click(); await page.waitForURL(url => url.origin === "http://jstorrent.localhost:3030" && url.pathname === "/" && url.searchParams.has("connect"));
        }
      }
      console.log(`PASS injected packaged Linux journey: ${scenario}`);
      await page.close();
    }
  } finally { await context.close(); browser = undefined; rmSync(profile, { recursive: true, force: true }); }
  // A real HTTP cache, rather than a routed/mock navigation response. This
  // independently reproduces old cacheable HTML surviving a package change.
  let currentPackage = false;
  let currentDocuments = 0;
  const server = createServer((request, response) => {
    if (request.url.startsWith("/old.js")) {
      response.writeHead(currentPackage ? 404 : 200, { "content-type": "text/javascript", "cache-control": "no-store" });
      response.end(currentPackage ? "" : "document.body.dataset.old='loaded';");
      return;
    }
    if (request.url === "/" || request.url.startsWith("/?")) {
      if (currentPackage) currentDocuments += 1;
      response.writeHead(200, { "content-type": "text/html", "cache-control": currentPackage ? "no-store" : "public, max-age=86400" });
      response.end(currentPackage ? "<main>Current Linux UI</main>" : "<main>Old Linux shell</main><script src='/old.js'></script>");
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3030, "127.0.0.1", resolve); });
  const cacheProfile = mkdtempSync(path.join(tmpdir(), "rstorrent-253-cache-profile-"));
  try {
    browser = await chromium.launchPersistentContext(cacheProfile, { channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${staging}`, `--load-extension=${staging}`,
        "--no-proxy-server"] });
    const page = await browser.newPage();
    await page.goto("http://jstorrent.localhost:3030/");
    assert.match(await page.locator("body").innerText(), /Old Linux shell/u);
    currentPackage = true;
    await page.goto(`${origin}/crostini/setup.html`);
    await page.goto("http://jstorrent.localhost:3030/");
    assert.match(await page.locator("body").innerText(), /Old Linux shell/u);
    assert.equal(currentDocuments, 0, "ordinary navigation still uses the old cached document");
    await page.addInitScript(() => {
      globalThis.chrome = { permissions: { contains: async () => true } };
      globalThis.fetch = async () => new Response(JSON.stringify({ status: "ok", product: "rstorrent-crostini", build_id: "0.1.0", launch_protocol: 1 }));
    });
    await page.goto(`${origin}/crostini/connect.html`);
    await page.getByText("Current Linux UI", { exact: true }).waitFor();
    assert.equal(currentDocuments, 1);
    assert.match(page.url(), /\?connect=[a-f0-9-]{36}$/u);
    console.log("PASS injected package replacement: cached old HTML replaced by a fresh explicit connection");
  } finally {
    await browser?.close(); browser = undefined;
    rmSync(cacheProfile, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
} finally {
  await browser?.close();
  rmSync(staging, { recursive: true, force: true });
}

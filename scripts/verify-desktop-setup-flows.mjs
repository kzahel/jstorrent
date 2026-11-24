#!/usr/bin/env node
// Capture the real packaged browser views with controlled native replies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "../clients/web/node_modules/playwright-core/index.mjs";

const [before, after, capturePath] = process.argv.slice(2);
assert(before && after && capturePath, "Usage: verify-desktop-setup-flows.mjs BEFORE.zip AFTER.zip CAPTURES");
const captures = path.resolve(capturePath);
mkdirSync(captures, { recursive: true });
const origin = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk";

async function withExtension(archive, exercise) {
  const root = mkdtempSync(path.join(tmpdir(), "jst-setup-flow-"));
  let browser;
  try {
    const extension = path.join(root, "extension");
    execFileSync("unzip", ["-q", path.resolve(archive), "-d", extension]);
    browser = await chromium.launchPersistentContext(path.join(root, "profile"), {
      channel: "chromium", headless: true, locale: "en-US", colorScheme: "light",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--lang=en-US"],
    });
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent("serviceworker");
    assert(worker.url().startsWith(origin), "requires the production extension identity");
    await worker.evaluate(() => {
      const sendNative = chrome.runtime.sendNativeMessage.bind(chrome.runtime);
      globalThis.desktopFixture = { mode: "missing", operations: [] };
      chrome.runtime.sendNativeMessage = (_host, request, callback) => {
        const fixture = globalThis.desktopFixture;
        fixture.operations.push(request.op);
        if (fixture.mode === "missing") {
          return sendNative("com.jstorrent.fixture_missing_host", request, callback);
        }
        const envelope = { id: request.id, protocolVersion: 1 };
        if (request.op === "hello") {
          callback({ ...envelope, ok: true, result: { kind: "hello" } });
        } else if (fixture.mode === "recovery" && request.op === "start_control") {
          callback({ ...envelope, ok: true, result: { kind: "ready" } });
        } else {
          const reason = { legacy: "legacy_running", moved: "desktop_missing", stopped: "stopped", recovery: "stopped" }[fixture.mode];
          callback({ ...envelope, ok: false, error: { code: "control_unavailable", reason } });
        }
      };
    });
    await exercise(browser, mode => worker.evaluate(mode => {
      globalThis.desktopFixture = { mode, operations: [] };
    }, mode), () => worker.evaluate(() => globalThis.desktopFixture.operations));
  } finally {
    await browser?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function openPopup(browser, platform) {
  const page = await browser.newPage();
  await page.addInitScript(platform => {
    chrome.runtime.getPlatformInfo = async () => ({ os: platform });
  }, platform);
  await page.goto(`${origin}/popup/popup.html`);
  await page.getByRole("heading", { name: "Desktop app" }).waitFor();
  return page;
}

async function capturePopup(page, title, detail, filename) {
  await page.getByText(title, { exact: true }).waitFor();
  assert.equal(await page.locator("#status-detail").textContent(), detail);
  await page.locator("#privacy-details").evaluate(details => { details.open = false; });
  await page.locator("main").screenshot({ path: path.join(captures, filename), animations: "disabled" });
}

const readyDetail = "Open your library here. Downloads run in the desktop app.";
const macDetail = "Quit JSTorrent if it’s open. Open it from Applications, then select Retry.";
const legacyDetail = "Quit any older JSTorrent desktop app and close its extension pages. Then try again.";

await withExtension(before, async (browser, mode, operations) => {
  const win = await openPopup(browser, "win");
  await capturePopup(win, "Desktop setup needed", "JSTorrent Desktop is unavailable. Install it and open it once to finish setup.", "01-windows-setup-before.png");
  assert(await win.getByRole("button", { name: "Open torrent library" }).isDisabled());
  assert.deepEqual(await operations(), ["hello"]);
  await mode("legacy");
  await win.reload();
  await capturePopup(win, "JSTorrent Desktop is ready", readyDetail, "02-legacy-ready-before.png");
  assert(await win.getByRole("button", { name: "Open torrent library" }).isEnabled());
  assert.deepEqual(await operations(), ["hello"]);
});

await withExtension(after, async (browser, mode, operations) => {
  const win = await openPopup(browser, "win");
  await capturePopup(win, "Desktop setup needed", "Quit JSTorrent if it’s open. Open it from the Windows Start menu, then select Retry.", "03-windows-setup-after.png");
  assert(await win.getByRole("link", { name: "Download JSTorrent" }).isVisible());
  assert.deepEqual(await operations(), ["attach_control"]);
  await mode("stopped");
  await win.getByRole("button", { name: "Retry", exact: true }).click();
  await capturePopup(win, "JSTorrent is closed", readyDetail, "04-windows-stopped-after-retry.png");
  assert(await win.getByRole("button", { name: "Start JSTorrent" }).isEnabled());
  assert.deepEqual(await operations(), ["attach_control"]);

  await mode("missing");
  const mac = await openPopup(browser, "mac");
  await capturePopup(mac, "Desktop setup needed", macDetail, "05-macos-setup-after.png");
  assert.deepEqual(await operations(), ["attach_control"]);
  await mode("moved");
  await mac.getByRole("button", { name: "Retry", exact: true }).click();
  await capturePopup(mac, "Desktop app moved or missing", macDetail, "06-macos-moved-after.png");
  assert.deepEqual(await operations(), ["attach_control"]);

  await mode("legacy");
  await win.reload();
  await capturePopup(win, "Close older JSTorrent", legacyDetail, "07-legacy-popup-after.png");
  assert(await win.getByRole("button", { name: "Retry", exact: true }).isVisible());
  assert.deepEqual(await operations(), ["attach_control"]);
  const companion = await browser.newPage();
  await companion.goto(`${origin}/companion/companion.html?backend=desktop`);
  await companion.getByText(legacyDetail, { exact: true }).waitFor();
  assert(await companion.getByRole("button", { name: "Retry connection" }).isVisible());
  await companion.locator("#companion-bootstrap").screenshot({ path: path.join(captures, "08-legacy-companion-after.png"), animations: "disabled" });
  assert.deepEqual(await operations(), ["attach_control", "attach_control"]);

  await mode("recovery");
  const opened = await win.evaluate(() => chrome.runtime.sendMessage({ type: "desktopBootstrap", op: "open" }));
  assert.deepEqual(opened, { ok: true, result: { kind: "desktop_ui" } });
  await companion.getByRole("button", { name: "Start", exact: true }).waitFor();
  assert.deepEqual((await operations()).slice(0, 2), ["start_control", "attach_control"]);
});

console.log("PASS packaged Windows/macOS setup copy, passive Retry, and recovery in an existing companion tab");

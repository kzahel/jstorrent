import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { applyPresentation, presentationForPlatform } from "../popup/platform.js";
import { extensionRoot } from "./validate.mjs";
import { t, errorText } from "../src/localization.js";

const popup = readFileSync(path.join(extensionRoot, "popup/popup.html"), "utf8");

test("ChromeOS presents Android and Crostini without desktop bootstrap", () => {
  assert.deepEqual(presentationForPlatform("cros"), {
    desktop: false,
    chromeos: true,
  });
});

test("desktop platforms present only native desktop bootstrap", () => {
  for (const os of ["linux", "mac", "openbsd", "win"]) {
    assert.deepEqual(presentationForPlatform(os), {
      desktop: true,
      chromeos: false,
    });
  }
});

test("unknown or unavailable platform information retains both recovery surfaces", () => {
  for (const os of [undefined, null, "android", "future-os"]) {
    assert.deepEqual(presentationForPlatform(os), {
      desktop: true,
      chromeos: true,
    });
  }
});

test("presentation hides irrelevant controls", () => {
  const desktop = { hidden: true };
  const chromeos = { hidden: true };
  applyPresentation(presentationForPlatform("cros"), { desktop, chromeos });
  assert.equal(desktop.hidden, true);
  assert.equal(chromeos.hidden, false);

  applyPresentation(presentationForPlatform("mac"), { desktop, chromeos });
  assert.equal(desktop.hidden, false);
  assert.equal(chromeos.hidden, true);
});

test("ChromeOS copy uses only the exact published Android listing", () => {
  assert.match(
    popup,
    /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.jstorrent\.app"/u,
  );
  assert.match(popup, /separate torrent libraries, settings,/u);
  assert.doesNotMatch(popup, /installed|Play (?:is|appears) available/iu);
});

// Execute the actual popup entry point with browser/document boundaries mocked.
// A tab with the popup URL must not be mistaken for the toolbar action.
async function runPopup({ os = "mac", popupView = false, granted = true, translate = t } = {}) {
  const { runInNewContext } = await import("node:vm");
  const requests = [];
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, disabled: false, checked: false, textContent: "",
      addEventListener(type, listener) { this[type] = listener; },
    });
    return elements.get(selector);
  }
  const view = {};
  const metrics = { disclosureVersion: 1, statisticsEnabled: false, createdAtMillis: String(Date.now()), sessions: 1, everConnected: false };
  const source = readFileSync(path.join(extensionRoot, "popup/popup.js"), "utf8");
  runInNewContext(source.replace(/^import .*;\n/gmu, ""), {
    t: translate, errorText, localizeDocument() {},
    applyPresentation, presentationForPlatform, window: view,
    document: { querySelector: element },
    chrome: {
      permissions: { request: async () => granted },
      extension: { getViews: () => popupView ? [view] : [{}] },
      runtime: {
        getPlatformInfo: async () => ({ os }),
        async sendMessage(request) {
          requests.push(request);
          if (request.type === "androidBootstrap") return { ok: true, result: { kind: "android_ui", status: "opened" } };
          if (request.type === "productMetrics") return { ok: true, state: metrics };
          return { ok: true, result: { kind: request.op === "hello" ? "hello" : "desktop_ui", hostVersion: "test" } };
        },
      },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { requests, launch: () => element("#launch").click(), android: () => element("#connect-android").click(), androidStatus: () => element("#android-status").textContent,
    linux: () => element("#launch-linux").click(), linuxStatus: () => element("#linux-status").textContent };
}

for (const os of ["mac", "win", "linux"]) {
  test(`${os} toolbar popup is explicit launch intent`, async () => {
    const { requests } = await runPopup({ os, popupView: true });
    assert.equal(requests.filter(value => value.type === "desktopBootstrap").length, 1);
  });
  test(`${os} restored popup tab only launches after its button is clicked`, async () => {
    const { requests, launch } = await runPopup({ os });
    assert.equal(requests.filter(value => value.type === "desktopBootstrap").length, 0);
    await launch();
    assert.equal(requests.filter(value => value.type === "desktopBootstrap").length, 1);
  });
}

test("ChromeOS and uncertain platform popup never auto-launch desktop", async () => {
  for (const os of ["cros", "future-os"]) {
    const { requests } = await runPopup({ os, popupView: true });
    assert.equal(requests.filter(value => value.type === "desktopBootstrap").length, 0);
  }
});

test("localized desktop feedback preserves the metrics protocol operation", async () => {
  const popup = await runPopup({ translate: (key, values) => `translated: ${t(key, values)}` });
  await popup.launch();
  const connected = popup.requests.filter(request => request.type === "productMetrics" && request.op === "connected");
  assert.equal(connected.length, 1);
  assert.equal(popup.requests.some(request => request.type === "productMetrics" && request.op.startsWith("translated:")), false);
});

test("denied Android permission never launches or contacts the app", async () => {
  const popup = await runPopup({ os: "cros", granted: false });
  await popup.android();
  assert.equal(popup.requests.some(request => request.type === "androidBootstrap"), false);
  assert.match(popup.androidStatus(), /not granted/u);
});

test("Android connection opens UI and never claims an OS launch", async () => {
  const popup = await runPopup({ os: "cros" });
  await popup.android();
  assert.match(popup.androidStatus(), /Connection page opened/u);
  assert.match(popup.androidStatus(), /not yet confirmed/u);
});

test("Android launch is a directly clicked production JSTorrent link", () => {
  assert.match(popup, /href="intent:\/\/chromeos-companion#Intent;scheme=jstorrent;package=com\.jstorrent\.app;end"/u);
  assert.doesNotMatch(popup, /rstorrent:\/\//u);
});

test("Linux tab request is not presented as a connected application", async () => {
  const popup = await runPopup({ os: "cros" });
  await popup.linux();
  assert.equal(popup.requests.some(request => request.type === "crostiniBootstrap"), true);
  assert.match(popup.linuxStatus(), /connection is not confirmed/u);
  assert.doesNotMatch(popup.linuxStatus(), /^Opened/u);
});

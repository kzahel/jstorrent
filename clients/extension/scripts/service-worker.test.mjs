import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

let internalListener;
let externalListener;
let removedListener;
let installedListener;
let startupListener;
let storageChangedListener;
let nativeResponse;
let nativeRequest;
let nextTabId = 100;
let focusedWindow;
let stored = {};
let tabs = new Map();
let uninstallUrl;
let attachRequests;

globalThis.chrome = {
  runtime: {
    id: "gcgoepclopkgijmclmlheafaglmbjlcc",
    lastError: undefined,
    onMessage: {
      addListener(callback) {
        internalListener = callback;
      },
    },
    onMessageExternal: {
      addListener(callback) {
        externalListener = callback;
      },
    },
    sendNativeMessage(host, request, callback) {
      nativeRequest = { host, request };
      callback(nativeResponse(request));
    },
    async sendMessage(message) { attachRequests.push(message); return { ok: true }; },
    getURL(path) {
      return `chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/${path}`;
    },
    async getContexts(filter) {
      return [...tabs.values()].filter(tab => filter.documentUrls.includes(tab.url)).map(tab => ({ tabId: tab.id, documentUrl: tab.url, frameId: 0 }));
    },
    getManifest() {
      return { version: "0.4.0" };
    },
    async setUninstallURL(url) {
      uninstallUrl = url;
    },
    onInstalled: {
      addListener(callback) {
        installedListener = callback;
      },
    },
    onStartup: {
      addListener(callback) {
        startupListener = callback;
      },
    },
  },
  storage: {
    session: {
      async get(key) {
        return { [key]: stored[key] };
      },
      async set(values) {
        Object.assign(stored, values);
      },
      async remove(key) {
        delete stored[key];
      },
    },
    local: {
      async get(key) {
        return { [key]: stored[key] };
      },
      async set(values) {
        Object.assign(stored, values);
      },
    },
    onChanged: {
      addListener(callback) {
        storageChangedListener = callback;
      },
    },
  },
  tabs: {
    onRemoved: {
      addListener(callback) {
        removedListener = callback;
      },
    },
    async get(tabId) {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("No tab");
      const { url: _redacted, ...visible } = tab;
      return visible;
    },
    async update(tabId, update) {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("No tab");
      Object.assign(tab, update);
      return { ...tab };
    },
    async create(options) {
      const tab = { id: nextTabId, windowId: 9, ...options };
      nextTabId += 1;
      tabs.set(tab.id, tab);
      return { ...tab };
    },
    async remove(tabId) {
      tabs.delete(tabId);
      removedListener(tabId);
    },
  },
  windows: {
    async update(windowId, update) {
      focusedWindow = { windowId, update };
    },
  },
};

await import("../src/service-worker.js");

beforeEach(() => {
  chrome.runtime.lastError = undefined;
  nativeResponse = () => undefined;
  nativeRequest = undefined;
  nextTabId = 100;
  focusedWindow = undefined;
  stored = {};
  tabs = new Map();
  uninstallUrl = undefined;
  attachRequests = [];
});

function sendInternal(message) {
  return new Promise((resolve) => {
    const keepAlive = internalListener(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("popup/popup.html") }, resolve);
    assert.equal(keepAlive, true);
  });
}

function sendExternal(message, sender) {
  return new Promise((resolve) => {
    const keepAlive = externalListener(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

test("hello uses the distinct bounded native bootstrap contract", async () => {
  nativeResponse = (request) => ({
    id: request.id,
    ok: true,
    protocolVersion: 1,
    result: { kind: "hello" },
  });

  const response = await sendInternal({ type: "nativeBootstrap", op: "hello" });
  assert.equal(nativeRequest.host, "com.jstorrent.rstorrent.native");
  assert.deepEqual(
    {
      protocolVersion: nativeRequest.request.protocolVersion,
      op: nativeRequest.request.op,
    },
    { protocolVersion: 1, op: "hello" },
  );
  assert.equal(response.ok, true);
  assert.equal(response.id, nativeRequest.request.id);
});

test("runtime errors become actionable path-free setup guidance", async () => {
  chrome.runtime.lastError = { message: "/private/path should not escape" };
  const response = await sendInternal({ type: "nativeBootstrap", op: "launch" });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "native_host_unavailable");
  assert.match(response.error.message, /Install it and open it once/u);
  assert.doesNotMatch(response.error.message, /private/u);
});

test("exact external Crostini handoff reuses its sender tab", async () => {
  tabs.set(41, {
    id: 41,
    windowId: 7,
    url: "http://jstorrent.localhost:3030/launch-chromeos",
  });
  const response = await sendExternal(
    { type: "openCrostiniUi", protocolVersion: 1 },
    {
      url: "http://jstorrent.localhost:3030/launch-chromeos",
      tab: { id: 41 },
    },
  );

  assert.deepEqual(response, {
    ok: true,
    result: { kind: "crostini_ui", status: "opened" },
  });
  assert.match(tabs.get(41).url, /^http:\/\/jstorrent\.localhost:3030\/\?connect=[a-f0-9-]{36}$/u);
  assert.equal(stored.crostiniUiTabId, 41);
  assert.deepEqual(focusedWindow, { windowId: 7, update: { focused: true } });
});

test("repeated handoff focuses one remembered tab and closes the disposable tab", async () => {
  stored.crostiniUiTabId = 41;
  tabs.set(41, { id: 41, windowId: 7, url: "http://jstorrent.localhost:3030/" });
  tabs.set(42, {
    id: 42,
    windowId: 8,
    url: "http://jstorrent.localhost:3030/launch-chromeos",
  });

  const response = await sendExternal(
    { type: "openCrostiniUi", protocolVersion: 1 },
    {
      url: "http://jstorrent.localhost:3030/launch-chromeos",
      tab: { id: 42 },
    },
  );
  assert.equal(response.result.status, "focused");
  assert.equal(tabs.get(41).url, "http://jstorrent.localhost:3030/");
  assert.equal(tabs.get(41).active, true);
  assert.equal(tabs.has(42), false);
  assert.deepEqual(focusedWindow, { windowId: 7, update: { focused: true } });
});

test("popup requests an offline Linux connection tab without probing the backend", async () => {
  const response = await sendInternal({ type: "crostiniBootstrap", op: "open" });
  assert.equal(response.result.status, "requested");
  assert.equal(tabs.get(100).url, chrome.runtime.getURL("crostini/connect.html"));
  assert.equal(stored.crostiniUiTabId, 100);
});

test("real Linux handoff replaces a remembered recovery page and removes its disposable tab", async () => {
  stored.crostiniUiTabId = 41;
  tabs.set(41, { id: 41, windowId: 7, url: chrome.runtime.getURL("crostini/connect.html") });
  tabs.set(42, { id: 42, windowId: 8, url: "http://jstorrent.localhost:3030/launch-chromeos" });
  await sendExternal({ type: "openCrostiniUi", protocolVersion: 1 },
    { url: "http://jstorrent.localhost:3030/launch-chromeos", tab: { id: 42 } });
  assert.match(tabs.get(41).url, /^http:\/\/jstorrent\.localhost:3030\/\?connect=[a-f0-9-]{36}$/u);
  assert.equal(tabs.has(42), false);
});

test("Android action opens one packaged React tab without launching an app", async () => {
  const response = await sendInternal({ type: "androidBootstrap", op: "open" });

  assert.deepEqual(response, {
    ok: true,
    result: {
      kind: "android_ui",
      status: "opened",
    },
  });
  assert.equal(
    tabs.get(100).url,
    "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/companion/companion.html",
  );
  assert.equal(stored.androidUiTabId, 100);
  assert.equal(tabs.size, 1);
});

test("repeated Android action focuses the one visible application tab", async () => {
  stored.androidUiTabId = 77;
  tabs.set(77, {
    id: 77,
    windowId: 5,
    url: "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/companion/companion.html",
  });

  const response = await sendInternal({ type: "androidBootstrap", op: "open" });

  assert.equal(response.result.status, "focused");
  assert.equal(tabs.get(77).active, true);
  assert.equal(stored.androidUiTabId, 77);
  assert.deepEqual(attachRequests, [{ type: "androidAttachRequested", tabId: 77 }]);
});

test("exact Android website return coalesces into one attach page without launching", async () => {
  const message = { type: "openAndroidUi", protocolVersion: 1 };
  const sender = { url: "https://jstorrent.com/chrome-extension.html", frameId: 0, tab: { id: 42 } };
  const results = await Promise.all([sendExternal(message, sender), sendExternal(message, sender)]);
  assert.equal(results.every(response => response.ok && response.result.kind === "android_ui"), true);
  assert.equal(tabs.size, 1);
  assert.equal(tabs.get(100).url, chrome.runtime.getURL("companion/companion.html"));
  await sendExternal(message, sender);
  assert.equal(tabs.size, 1);
  assert.deepEqual(attachRequests, [{ type: "androidAttachRequested", tabId: 100 }]);
});

test("Android return rejects malformed messages and every broader sender authority", () => {
  const message = { type: "openAndroidUi", protocolVersion: 1 };
  const sender = { url: "https://jstorrent.com/chrome-extension.html", frameId: 0, tab: { id: 42 } };
  for (const url of [
    "http://jstorrent.com/chrome-extension.html", "https://www.jstorrent.com/chrome-extension.html",
    "https://jstorrent.com.attacker.example/chrome-extension.html", "https://jstorrent.com/other.html",
    "https://jstorrent.com/chrome-extension.html?token=untrusted", "https://jstorrent.com/chrome-extension.html#untrusted",
    "https://user@jstorrent.com/chrome-extension.html", "https://jstorrent.com:444/chrome-extension.html",
  ]) assert.equal(externalListener(message, { ...sender, url }, () => assert.fail("rejected request answered")), false);
  for (const invalidSender of [{ ...sender, frameId: 1 }, { ...sender, frameId: undefined }, { ...sender, tab: {} }, { ...sender, tab: { id: -1 } }]) {
    assert.equal(externalListener(message, invalidSender, () => assert.fail("rejected request answered")), false);
  }
  for (const invalid of [null, { ...message, protocolVersion: 2 }, { ...message, protocolVersion: "1" }, { ...message, token: "untrusted" }]) {
    assert.equal(externalListener(invalid, sender, () => assert.fail("rejected request answered")), false);
  }
  assert.equal(tabs.size, 0);
});

test("a nonresponding retry notification cannot hold the website UI-open receipt", async () => {
  stored.androidUiTabId = 77;
  tabs.set(77, { id: 77, windowId: 5, url: chrome.runtime.getURL("companion/companion.html") });
  const send = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = () => new Promise(() => {});
  try {
    const response = await sendExternal({ type: "openAndroidUi", protocolVersion: 1 },
      { url: "https://jstorrent.com/chrome-extension.html", frameId: 0, tab: { id: 42 } });
    assert.equal(response.ok, true);
    assert.equal(response.result.status, "focused");
  } finally { chrome.runtime.sendMessage = send; }
});

test("external messages fail closed for URL and shape drift", () => {
  for (const [message, url] of [
    [{ type: "openCrostiniUi", protocolVersion: 2 }, "http://jstorrent.localhost:3030/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1, url: "http://evil" }, "http://jstorrent.localhost:3030/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "https://jstorrent.localhost:3030/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "http://jstorrent.localhost:3031/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "http://jstorrent.localhost:3030/not-launch"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "http://jstorrent.localhost.evil:3030/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "http://localhost:3030/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "http://other.localhost:3030/launch-chromeos"],
    [{ type: "openCrostiniUi", protocolVersion: 1 }, "http://penguin.linux.test:3030/launch-chromeos"],
  ]) {
    assert.equal(externalListener(message, { url, tab: { id: 5 } }, () => {}), false, url);
  }
});

test("unrecognized internal messages are not claimed", () => {
  assert.equal(internalListener({ type: "other", op: "hello" }, {}, () => {}), false);
  assert.equal(
    internalListener({ type: "nativeBootstrap", op: "download" }, {}, () => {}),
    false,
  );
});

test("product metric messages serialize disclosure session and reset state", async () => {
  const first = await sendInternal({ type: "productMetrics", op: "session" });
  assert.equal(first.ok, true);
  assert.equal(first.state.sessions, "1");
  assert.equal(first.state.disclosureVersion, 0);
  assert.equal(uninstallUrl, "https://jstorrent.com/uninstall.html?v=0.4.0");

  const acknowledged = await sendInternal({
    type: "productMetrics",
    op: "acknowledge",
    enabled: false,
  });
  assert.equal(acknowledged.state.statisticsEnabled, false);
  const reset = await sendInternal({ type: "productMetrics", op: "reset" });
  assert.equal(reset.state.sessions, "0");
  assert.notEqual(reset.state.installationId, first.state.installationId);
});


test("desktop clicks coalesce, reuse a tab and never return credentials", async () => {
  let starts = 0;
  nativeResponse = (request) => {
    assert.equal(request.op, "start_control");
    starts++;
    return { id: request.id, ok: true, protocolVersion: 1, result: { kind: "ready", credential: "secret" } };
  };
  const replies = await Promise.all(Array.from({ length: 8 }, () => sendInternal({ type: "desktopBootstrap", op: "open" })));
  assert.equal(starts, 1);
  assert.equal(tabs.size, 1);
  assert.match([...tabs.values()][0].url, /backend=desktop$/u);
  assert.ok(replies.every((reply) => !JSON.stringify(reply).includes("secret")));
  await sendInternal({ type: "desktopBootstrap", op: "open" });
  assert.equal(tabs.size, 1);
});

test("foreign content sender cannot bootstrap or start desktop", () => {
  assert.equal(internalListener({ type: "nativeBootstrap", op: "start_control" }, { id: chrome.runtime.id, url: "https://example.com" }, () => assert.fail()), false);
  assert.equal(nativeRequest, undefined);
});

test("automatic attachment forwards only attach intent", async () => {
  nativeResponse = (request) => ({ id: request.id, ok: false, error: { code: "control_unavailable" } });
  await sendInternal({ type: "nativeBootstrap", op: "attach_control" });
  assert.equal(nativeRequest.request.op, "attach_control");
  assert.equal(tabs.size, 0);
});


test("desktop recovers its own page without a remembered tab or URL permission", async () => {
  tabs.set(77, { id: 77, windowId: 5, url: chrome.runtime.getURL("companion/companion.html?backend=desktop") });
  nativeResponse = request => ({ id: request.id, protocolVersion: 1, ok: true, result: { kind: "ready" } });
  await sendInternal({ type: "desktopBootstrap", op: "open" });
  assert.equal(tabs.size, 1);
  assert.equal(stored.desktopUiTabId, 77);
  assert.equal(tabs.get(77).active, true);
});

test("desktop never focuses a remembered tab that navigated elsewhere", async () => {
  stored.desktopUiTabId = 77;
  tabs.set(77, { id: 77, windowId: 5, url: "https://example.com/" });
  nativeResponse = request => ({ id: request.id, protocolVersion: 1, ok: true, result: { kind: "ready" } });
  await sendInternal({ type: "desktopBootstrap", op: "open" });
  assert.equal(tabs.size, 2);
  assert.equal(tabs.get(77).active, undefined);
  assert.notEqual(stored.desktopUiTabId, 77);
});

test("browser startup and worker initialization do not launch desktop", async () => {
  if (startupListener) await startupListener();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeRequest, undefined);
  assert.equal(tabs.size, 0);
});

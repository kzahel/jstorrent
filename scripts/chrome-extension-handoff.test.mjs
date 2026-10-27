import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { startChromeExtensionHandoff } from "../website/public/chrome-extension.js";

function fixture(options = {}) {
  const requests = [];
  const events = new Map();
  const clicks = new Map();
  const button = {
    disabled: false,
    addEventListener: (name, callback) => clicks.set(name, callback),
    removeEventListener: name => clicks.delete(name),
  };
  const status = { textContent: "" };
  const document = { getElementById: id => id === "handoff-open" ? button : status };
  const window = {
    location: { href: options.url ?? "https://jstorrent.com/chrome-extension.html" },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
  };
  window.top = options.subframe ? {} : window;
  const chrome = options.missing ? undefined : { runtime: {
    sendMessage: (...args) => requests.push(args),
  } };
  const cleanup = startChromeExtensionHandoff(document, window, chrome);
  return { requests, status, button, chrome, cleanup, click: () => clicks.get("click")?.(),
    event: (name, event = {}) => events.get(name)?.(event) };
}

test("Android return requests only the production UI and does not claim pairing", t => {
  const f = fixture(); t.after(f.cleanup);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0][0], "dbokmlpefliilbjldladbimlcfgbolhk");
  assert.deepEqual(f.requests[0][1], { type: "openAndroidUi", protocolVersion: 1 });
  f.click(); assert.equal(f.requests.length, 1);
  f.requests[0][2]({ ok: true, result: { kind: "android_ui" } });
  assert.match(f.status.textContent, /approval may still be needed/);
  assert.equal(f.button.disabled, false);
});

test("the deployed extensionless redirect destination retains the same handoff", t => {
  const f = fixture({ url: "https://jstorrent.com/chrome-extension" }); t.after(f.cleanup);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0][1], { type: "openAndroidUi", protocolVersion: 1 });
});

test("missing extension, refusal and wrong response retain manual recovery", t => {
  for (const outcome of ["missing", "runtime-error", "wrong-response"]) {
    const f = fixture({ missing: outcome === "missing" }); t.after(f.cleanup);
    if (f.requests.length) {
      if (outcome === "runtime-error") f.chrome.runtime.lastError = { message: "private detail" };
      f.requests[0][2]({ ok: true, result: { kind: "other" } });
    }
    assert.match(f.status.textContent, /Click it in Chrome/);
    assert.doesNotMatch(f.status.textContent, /private detail/);
    assert.equal(f.button.disabled, false);
  }
});

test("deadline stops one attempt; stale callbacks cannot complete its retry", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); t.after(f.cleanup);
  t.mock.timers.tick(5_000);
  assert.match(f.status.textContent, /did not respond/);
  assert.equal(f.requests.length, 1);
  f.click(); assert.equal(f.requests.length, 2);
  f.requests[0][2]({ ok: true, result: { kind: "android_ui" } });
  assert.equal(f.button.disabled, true);
  f.requests[1][2]({ ok: true, result: { kind: "android_ui" } });
  assert.equal(f.button.disabled, false);
});

test("departure joins timer and restoration offers explicit retry without replay", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); t.after(f.cleanup);
  f.event("pagehide", { persisted: true });
  f.requests[0][2]({ ok: true, result: { kind: "android_ui" } });
  t.mock.timers.tick(10_000);
  f.event("pageshow", { persisted: true });
  assert.equal(f.requests.length, 1);
  assert.match(f.status.textContent, /Choose Open/);
  f.click(); assert.equal(f.requests.length, 2);
});

test("query, fragment, lookalike origins and subframes cannot initiate a handoff", t => {
  for (const options of [
    { url: "https://jstorrent.com/chrome-extension.html?credential=untrusted" },
    { url: "https://jstorrent.com/chrome-extension.html#untrusted" },
    { url: "https://jstorrent.com.attacker.example/chrome-extension.html" },
    { url: "http://jstorrent.com/chrome-extension.html" },
    { url: "https://jstorrent.com/chrome-extension?token=untrusted" },
    { url: "https://jstorrent.com/chrome-extension#untrusted" },
    { url: "https://jstorrent.com/chrome-extension/" },
    { subframe: true },
  ]) {
    const f = fixture(options); t.after(f.cleanup);
    assert.equal(f.requests.length, 0);
    assert.match(f.status.textContent, /directly/);
  }
});

test("handoff document contains only local assets and no analytics", async () => {
  const html = await readFile(new URL("../website/public/chrome-extension.html", import.meta.url), "utf8");
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /type="module" src="\/chrome-extension.js"/);
  assert.doesNotMatch(html, /cloudflare|analytics|googletag|<iframe|\son\w+=/i);
});

test("legacy extension acknowledgements remain supported without inventing torrent completion", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = await readFile(new URL("../website/public/add/index.js", import.meta.url), "utf8");
  for (const response of [{ ok: true }, { handled: true }, undefined, { error: "refused" }]) {
    const notices = [];
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, { style: {}, addEventListener() {}, insertBefore(node) { notices.push(node.innerText); } });
      return elements.get(id);
    };
    const context = {
      chrome: { runtime: { sendMessage: (_id, _message, callback) => callback(response) } },
      document: { addEventListener() {}, getElementById: element, createElement: () => ({}) },
      window: {}, console: { log() {}, error() {} }, history: { length: 0 },
      parsed: { magnet_uri: "magnet:?xt=urn:btih:" + "a".repeat(40) },
    };
    runInNewContext(source + "\naddViaExtension();", context);
    if (response?.ok === true || response?.handled === true) assert(notices.some(x => x.startsWith("Sent to JSTorrent")));
    else assert.equal(element("install-div").style.display, "block");
    assert(!notices.includes("Torrent Added"));
  }
});

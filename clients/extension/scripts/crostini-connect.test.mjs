import assert from "node:assert/strict";
import test from "node:test";
import { checkLinuxHealth, startLinuxConnection } from "../crostini/connect.js";

const ready = { status: "ok", product: "rstorrent-crostini", launch_protocol: 1, build_id: "0.1.0" };
const settle = () => new Promise(resolve => setImmediate(resolve));

test("Linux health accepts only the exact local product/protocol and bounded valid data", async () => {
  for (const [health, expected] of [
    [ready, "ready"], [{ ...ready, product: "other" }, "wrong_service"],
    [{ ...ready, launch_protocol: 2 }, "incompatible"],
    [{ ...ready, launch_protocol: "1" }, "incompatible"],
    [{ ...ready, status: "starting" }, "invalid_response"],
    [{ ...ready, build_id: "" }, "invalid_response"],
    [{ ...ready, build_id: "x".repeat(129) }, "invalid_response"],
    [null, "wrong_service"],
  ]) {
    const signal = new AbortController().signal;
    assert.equal(await checkLinuxHealth(signal, async (url, options) => {
      assert.equal(url, "http://jstorrent.localhost:3030/healthz");
      assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
      assert.equal(options.signal, signal);
      return new Response(JSON.stringify(health));
    }), expected);
  }
  assert.equal(await checkLinuxHealth(undefined, async () => new Response("invalid json")), "invalid_response");
  assert.equal(await checkLinuxHealth(undefined, async () => new Response(new Uint8Array([0xff]))), "invalid_response");
});

test("oversized declared or streamed health and HTTP errors cancel the body", async () => {
  for (const variant of ["declared", "streamed", "http-error"]) {
    let canceled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4097)); },
      cancel() { canceled = true; },
    });
    const result = await checkLinuxHealth(undefined, async () => new Response(body, {
      status: variant === "http-error" ? 503 : 200,
      headers: variant === "declared" ? { "content-length": "4097" } : {},
    }));
    assert.equal(result, variant === "http-error" ? "service_error" : "invalid_response");
    assert.equal(canceled, true);
  }
});

function harness({ granted = false } = {}) {
  const events = {};
  const status = { textContent: "" }; const button = { textContent: "", disabled: false };
  const navigations = []; const permissions = [];
  const state = { granted };
  startLinuxConnection({ status, button, navigate: url => navigations.push(url),
    page: { addEventListener: (name, callback) => { events[name] = callback; } },
    chrome: { permissions: {
      async contains(value) { permissions.push(["contains", value]); return state.granted; },
      async request(value) { permissions.push(["request", value]); return state.granted; },
    } },
  });
  return { status, button, navigations, permissions, events, state };
}

test("missing permission issues no requests; explicit Retry can grant exact-host access", async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests += 1; return new Response(JSON.stringify(ready)); };
  try {
    const h = harness(); await settle();
    assert.equal(requests, 0); assert.match(h.status.textContent, /not granted/u);
    h.state.granted = true; h.button.onclick(); await settle();
    assert.equal(requests, 1); assert.equal(h.navigations.length, 1);
    assert.match(h.navigations[0], /^http:\/\/jstorrent\.localhost:3030\/\?connect=[a-f0-9-]{36}$/u);
    assert.deepEqual(h.permissions[1], ["request", { origins: ["http://jstorrent.localhost/*"] }]);
  } finally { globalThis.fetch = original; }
});

test("connection failures retain offline recovery without leaking errors or automatic retry", async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("private/path net::ERR_NAME_NOT_RESOLVED"); };
  try {
    const h = harness({ granted: true }); await settle(); await settle();
    assert.equal(h.button.textContent, "Retry"); assert.match(h.status.textContent, /could not be reached/u);
    assert.match(h.status.textContent, /policy are unknown/u); assert.doesNotMatch(h.status.textContent, /private|ERR_NAME/u);
    assert.equal(requests, 1); assert.deepEqual(h.navigations, []);
    h.button.onclick(); await settle(); assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});

test("Cancel joins the pending request before enabling Retry", async () => {
  const original = globalThis.fetch; let reject; let signal; let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests += 1; signal = options.signal;
    return new Promise((_resolve, rejectRequest) => { reject = rejectRequest; });
  };
  try {
    const h = harness({ granted: true }); await settle();
    h.button.onclick(); assert.equal(signal.aborted, true); assert.equal(h.button.disabled, true);
    h.button.onclick(); assert.equal(requests, 1);
    reject(new Error("aborted")); await settle();
    assert.equal(h.button.disabled, false); assert.equal(h.button.textContent, "Retry");
    assert.match(h.status.textContent, /canceled/u); assert.deepEqual(h.navigations, []);
  } finally { globalThis.fetch = original; }
});

test("timeout stops the request and remains terminal", async () => {
  const originalFetch = globalThis.fetch; const originalTimer = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout; let deadline; let requests = 0; let cleared = false;
  globalThis.setTimeout = (callback, millis) => { assert.equal(millis, 10000); deadline = callback; return 253; };
  globalThis.clearTimeout = token => { assert.equal(token, 253); cleared = true; };
  globalThis.fetch = async (_url, { signal }) => {
    requests += 1;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  try {
    const h = harness({ granted: true }); await settle(); deadline(); await settle();
    assert.match(h.status.textContent, /within 10 seconds/u); assert.equal(h.button.textContent, "Retry");
    assert.equal(requests, 1); assert.equal(cleared, true); assert.deepEqual(h.navigations, []);
  } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer; globalThis.clearTimeout = originalClear; }
});

test("a departed/restored page never resurrects a request or stale restoration", async () => {
  const original = globalThis.fetch; let resolve; let requests = 0; let signal;
  globalThis.fetch = async (_url, options) => {
    requests += 1; signal = options.signal;
    return new Promise(done => { resolve = done; });
  };
  try {
    const h = harness({ granted: true }); await settle();
    h.events.pagehide(); assert.equal(signal.aborted, true);
    h.events.pageshow({ persisted: true }); h.events.pagehide();
    resolve(new Response(JSON.stringify(ready))); await settle(); await settle();
    h.button.onclick(); assert.equal(requests, 1); assert.deepEqual(h.navigations, []);
    h.events.pageshow({ persisted: true }); await settle();
    assert.equal(h.button.textContent, "Retry"); assert.match(h.status.textContent, /canceled/u);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

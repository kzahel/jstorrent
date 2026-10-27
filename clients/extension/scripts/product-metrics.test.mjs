import assert from "node:assert/strict";
import test from "node:test";

import {
  HOSTED_PRODUCT_CONTEXT_READY,
  ProductMetricsOwner,
  UNINSTALL_BASE_URL,
  buildUninstallUrl,
} from "../src/product-metrics.js";

function fixture() {
  const local = {};
  const urls = [];
  const session = {};
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      async setUninstallURL(url) { urls.push(url); },
      getURL: path => `chrome-extension://extension/${path}`,
      getPlatformInfo: async () => ({ os: "cros" }),
    },
    storage: {
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(values) { Object.assign(session, values); },
        async remove(key) { delete session[key]; },
      },
      local: {
        async get(key) { return { [key]: local[key] }; },
        async set(values) { Object.assign(local, values); },
      },
      onChanged: { addListener() {} },
    },
  };
  return { owner: new ProductMetricsOwner(chrome, "0.4.0", () => 1_800_000_000_000), local, urls, session };
}

test("default-on reports environment but keeps identifiers and counters disabled", async () => {
  const { owner, urls } = fixture();
  const state = await owner.refresh();
  assert.equal(state.statisticsEnabled, true);
  assert.equal(state.disclosureVersion, 0);
  assert.equal(new URL(urls.at(-1)).searchParams.get("platform"), "chromeos");
  assert.equal(HOSTED_PRODUCT_CONTEXT_READY, false);

  await owner.acknowledge(true);
  assert.equal(new URL(urls.at(-1)).searchParams.get("platform"), "chromeos");
  assert.doesNotMatch(urls.at(-1), /id=|sessions=|connected=/u);
});

test("support context strips URL authority and opt-out clears session context and URLs", async () => {
  const { owner, urls, session } = fixture();
  await owner.observeSupport("chrome-extension://extension/companion/companion.html?token=secret#torrent", "permission_denied");
  const before = new URL(urls.at(-1));
  assert.equal(before.searchParams.get("entry"), "companion/companion.html");
  assert.equal(before.searchParams.get("failure"), "permission_denied");
  assert.doesNotMatch(before.search, /secret|torrent|token|id=/u);
  assert.equal(new URL((await owner.feedbackUrl()).url).searchParams.get("platform"), "chromeos");
  await owner.acknowledge(false);
  assert.deepEqual(session, {});
  assert.equal(urls.at(-1), `${UNINSTALL_BASE_URL}?v=0.4.0`);
  assert.equal((await owner.feedbackUrl()).url, "https://jstorrent.com/feedback.html?v=0.4.0");
  await assert.rejects(owner.observeSupport("https://evil.example/companion/companion.html", "none"), /entry/u);
  await assert.rejects(owner.observeSupport("chrome-extension://extension/popup/popup.html", "private raw error"), /failure/u);
});

test("serialized events saturate state and reset rotates only extension metrics", async () => {
  const { owner } = fixture();
  const initial = await owner.snapshot();
  const results = await Promise.all([
    owner.recordSession(),
    owner.recordSession(),
    owner.recordConnected(),
  ]);
  const updated = results.at(-1);
  assert.equal(updated.sessions, "2");
  assert.equal(updated.everConnected, true);
  const reset = await owner.reset();
  assert.notEqual(reset.installationId, initial.installationId);
  assert.equal(reset.sessions, "0");
  assert.equal(reset.everConnected, false);
});

test("a newer extension's state is read only and registers the bare survey", async () => {
  const { owner, local, urls } = fixture();
  const newer = {
    schemaVersion: 99,
    installationId: "87e66203-9849-44c5-a557-8e77c29e7587",
    statisticsEnabled: false,
    future: "kept",
  };
  local.productMetricsV1 = structuredClone(newer);
  const state = await owner.refresh();
  assert.equal(state.statisticsEnabled, false);
  assert.equal(state.installationId, newer.installationId);
  assert.deepEqual(local.productMetricsV1, newer);
  assert.equal(urls.at(-1), UNINSTALL_BASE_URL);
  await assert.rejects(owner.recordSession(), /newer extension/u);
  assert.deepEqual(local.productMetricsV1, newer);
});

test("a damaged state keeps the opt-out and identity; unreadable consent is off", async () => {
  const { owner, local } = fixture();
  local.productMetricsV1 = {
    schemaVersion: 1,
    installationId: "87e66203-9849-44c5-a557-8e77c29e7587",
    createdAtMillis: "not a number",
    disclosureVersion: 1,
    statisticsEnabled: false,
    extra: true,
  };
  const recovered = await owner.refresh();
  assert.equal(recovered.statisticsEnabled, false);
  assert.equal(recovered.disclosureVersion, 1);
  assert.equal(recovered.installationId, "87e66203-9849-44c5-a557-8e77c29e7587");
  assert.equal(local.productMetricsV1.statisticsEnabled, false);
  assert.equal((await owner.recordSession()).statisticsEnabled, false);

  const unreadable = fixture();
  unreadable.local.productMetricsV1 = { schemaVersion: 1, statisticsEnabled: "yes" };
  assert.equal((await unreadable.owner.refresh()).statisticsEnabled, false);
  unreadable.local.productMetricsV1 = "garbage";
  assert.equal((await unreadable.owner.refresh()).statisticsEnabled, false);
});

test("URL construction rejects state shape drift and never admits arbitrary fields", () => {
  const state = {
    schemaVersion: 1,
    installationId: "87e66203-9849-44c5-a557-8e77c29e7587",
    createdAtMillis: "1800000000000",
    firstVersion: "0.4.0",
    currentVersion: "0.4.0",
    sessions: "2",
    everConnected: true,
    disclosureVersion: 1,
    statisticsEnabled: true,
    backendSummary: null,
  };
  assert.equal(buildUninstallUrl(state), `${UNINSTALL_BASE_URL}?v=0.4.0`);
  assert.throws(() => buildUninstallUrl({ ...state, torrent: "secret" }), /shape/u);
});

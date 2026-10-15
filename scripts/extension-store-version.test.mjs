import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCTION_EXTENSION_ID, servedVersion, updateCheckUrl } from "./extension-store-version.mjs";

const id = PRODUCTION_EXTENSION_ID;

test("reads the served version from an update response", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><gupdate protocol="2.0"><app appid="${id}" status="ok"><updatecheck codebase="https://example/x.crx" status="ok" version="1.1.5"/></app></gupdate>`;
  assert.equal(servedVersion(xml, id), "1.1.5");
});

test("reports nothing when the store serves no update", () => {
  const xml = `<gupdate><app appid="${id}" status="ok"><updatecheck status="noupdate"/></app></gupdate>`;
  assert.equal(servedVersion(xml, id), null);
  assert.equal(servedVersion("<gupdate/>", id), null);
});

test("builds the update URL for a valid ID only", () => {
  assert.match(updateCheckUrl(id), /x=id%3Ddbokmlpefliilbjldladbimlcfgbolhk%26uc/);
  assert.throws(() => updateCheckUrl("not-an-id"));
});

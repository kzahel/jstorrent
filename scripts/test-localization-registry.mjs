import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLocaleRegistry, validateLocaleRegistry, platformLocales } from "./localization-registry.mjs";
import { checkAndroidLocaleConfig } from "../clients/android/scripts/check-locale-config.mjs";

const fixture = () => ({
  sourceLocale: "en", fallbackLocale: "en",
  localeDefinitions: { en: { direction: "ltr" }, fr: { direction: "ltr" }, "fr-CA": { direction: "ltr" }, ar: { direction: "rtl" } },
  supportedLocales: { web: ["en"], desktop: ["en"], android: ["en"], ios: ["en"] },
  previewLocales: { web: ["fr", "fr-CA", "ar"], desktop: ["fr"], android: ["fr"] },
  catalogs: { web: "clients/web/src/localization/messages/en.json", desktop: "clients/desktop/src-tauri/locales/en.json", android: "clients/android/app/src/main/res/values/strings.xml", ios: "clients/ios/App/Localization/Localizable.xcstrings" },
  testLocales: [{ tag: "en-XA", direction: "ltr" }, { tag: "ar-XB", direction: "rtl" }],
});

test("French, regional and RTL preview registration comes only from data", () => {
  const registry = validateLocaleRegistry(fixture());
  assert.deepEqual(platformLocales(registry, "web"), ["en"]);
  assert.deepEqual(platformLocales(registry, "web", true), ["en", "fr", "fr-CA", "ar"]);
  assert.deepEqual(platformLocales(registry, "desktop", true), ["en", "fr"]);
  assert.equal(registry.localeDefinitions.ar.direction, "rtl");
});

test("invalid definitions, unregistered tags, overlap and noncanonical tags fail", () => {
  for (const alter of [
    r => { delete r.localeDefinitions.fr; },
    r => { r.localeDefinitions.fr.direction = "sideways"; },
    r => { r.previewLocales.web.push("fr"); },
    r => { r.supportedLocales.web.push("fr"); },
    r => { r.previewLocales.web.push("fr-ca"); },
    r => { r.previewLocales.web.push("../../fr"); },
    r => { r.localeDefinitions["en-XA"] = { direction: "ltr" }; },
    r => { r.supportedLocales.android = []; },
    r => { delete r.catalogs.web; },
    r => { r.testLocales = []; },
  ]) {
    const registry = fixture(); alter(registry);
    assert.throws(() => validateLocaleRegistry(registry));
  }
});

test("native and React must support matching locale tiers", () => {
  const registry = fixture();
  registry.supportedLocales.desktop.push("fr");
  registry.previewLocales.desktop = [];
  assert.throws(() => validateLocaleRegistry(registry), /shipping React/);
  registry.supportedLocales.desktop = ["en"];
  registry.previewLocales.desktop = ["ar"];
  registry.previewLocales.web = ["fr"];
  assert.throws(() => validateLocaleRegistry(registry), /requires React/);
});

test("Android French LocaleConfig generation preserves English-only release", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jstorrent-locale-registry-"));
  function write(file, value) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  }
  try {
    write("localization/locales.json", fixture());
    write("localization/android/locales.json", { locales: { fr: {
      catalog: "clients/android/app/src/debug/res/values-fr/strings.xml", quantities: ["one", "many", "other"],
    } } });
    write("clients/android/app/src/main/AndroidManifest.xml", '<application android:localeConfig="@xml/locales_config" />');
    assert.equal(readLocaleRegistry(root).localeDefinitions.fr.direction, "ltr");
    checkAndroidLocaleConfig(root, { generate: true });
    const config = source => fs.readFileSync(path.join(root, `clients/android/app/src/${source}/res/xml/locales_config.xml`), "utf8");
    assert.match(config("debug"), /android:name="fr"/);
    assert.doesNotMatch(config("main"), /android:name="fr"/);
    const first = config("debug");
    checkAndroidLocaleConfig(root);
    assert.equal(config("debug"), first);
    write("clients/android/app/src/main/res/values-fr/strings.xml", "<resources />");
    assert.throws(() => checkAndroidLocaleConfig(root), /Nonshipping Android locale fr/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

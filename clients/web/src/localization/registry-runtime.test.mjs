// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const KEY = "rstorrent.presentation.language";
const regionalLocales = ["pt-BR", "zh-CN", "zh-TW"];
let extraLocales;
let excludedLocales;
const syntheticRegistry = {
  sourceLocale: "en", fallbackLocale: "en", supportedLocales: ["en"], previewLocales: ["fr", "fr-CA", "ar-EG", ...regionalLocales],
  localeDefinitions: { en: { direction: "ltr" }, fr: { direction: "ltr" }, "fr-CA": { direction: "ltr" }, "ar-EG": { direction: "rtl" } },
  testLocales: [{ tag: "en-XA", direction: "ltr" }, { tag: "ar-XB", direction: "rtl" }],
};
let stored;
beforeEach(() => {
  vi.resetModules();
  window.history.replaceState(null, "", "/");
  extraLocales = [];
  excludedLocales = [];
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "1");
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES", "0");
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) });
  delete window.__TAURI_INTERNALS__;
  vi.doMock("./generated/catalogs", async () => {
    const { default: sourceCatalog } = await import("./generated/en.json");
    const catalog = (value) => ({ "localization.language.title": [{ type: 0, value }] });
    return {
      sourceCatalog, localeRegistry: { ...syntheticRegistry, previewLocales: [...syntheticRegistry.previewLocales, ...extraLocales].filter((tag) => !excludedLocales.includes(tag)) },
      catalogs: { en: sourceCatalog, ...(import.meta.env.VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES === "1" ? {
        ...Object.fromEntries([...regionalLocales, ...extraLocales].map((tag) => [tag, catalog(`SYNTHETIC_${tag}`)])),
        fr: catalog("SYNTHETIC_FRENCH"), "fr-CA": catalog("SYNTHETIC_REGIONAL_FRENCH"), "ar-EG": catalog("SYNTHETIC_RTL"),
      } : {}) },
    };
  });
});
afterEach(() => {
  vi.doUnmock("./generated/catalogs"); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  delete window.__TAURI_INTERNALS__;
});

it("uses synthetic French registration for parent matching, System, persistence and source fallback", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CH", "en"]);
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe("fr");
  expect(runtime.resolveProductLocale(["fr-CA-u-nu-latn"])).toBe("fr-CA");
  expect(runtime.resolveProductLocale(["not a locale", "fr-CA"])).toBe("fr-CA");
  expect(runtime.availableProductLanguages()).toEqual(["en", "fr", "fr-CA", "ar-EG", ...regionalLocales]);
  expect(runtime.message("localization.language.title")).toBe("SYNTHETIC_FRENCH");
  expect(runtime.message("localization.language.system")).toBe("System language");
  expect(stored.has(KEY)).toBe(false);
  await runtime.setLanguagePreference("fr-CA");
  expect(runtime.message("localization.language.title")).toBe("SYNTHETIC_REGIONAL_FRENCH");
  expect(stored.get(KEY)).toBe("fr-CA");
  await runtime.setLanguagePreference("system");
  expect(runtime.currentLocale()).toBe("fr");
  expect(stored.has(KEY)).toBe(false);
});

it("uses metadata direction and native authority for a synthetic RTL locale", async () => {
  window.__TAURI_INTERNALS__ = {};
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe("en");
  const save = vi.fn(async (preference) => ({ preference, locale: preference === "system" ? "ar-EG" : preference, availableLocales: ["en", "fr", "fr-CA", "ar-EG"] }));
  await runtime.bindDesktopLanguageAuthority({ save }, { preference: "system", locale: "ar-EG", availableLocales: ["en", "fr", "fr-CA", "ar-EG"] });
  expect(document.documentElement.dir).toBe("rtl");
  expect(runtime.message("localization.language.title")).toBe("SYNTHETIC_RTL");
  const formatting = await import("../inspection/format");
  expect(formatting.formatExactBytes("1536", "binary")).toBe("١٫٥ KB");
  expect(formatting.formatShareRatio("900719925474099301")).toBe("٩٠٠٧١٩٩٢٥٤٧٤٠٩٩٣٫٠١");
  await runtime.setLanguagePreference("fr-CA");
  expect(save).toHaveBeenCalledWith("fr-CA");
  expect(document.documentElement.lang).toBe("fr-CA");
  expect(document.documentElement.dir).toBe("ltr");
  expect(stored.has(KEY)).toBe(false);
});

it("keeps synthetic previews unavailable in release and preserves unsupported saved fields", async () => {
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "0");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA"]);
  stored.set(KEY, "fr");
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.availableProductLanguages()).toEqual(["en"]);
  expect(runtime.currentLocale()).toBe("en");
  expect(runtime.languagePreferenceSnapshot()).toBe("system");
  expect(stored.get(KEY)).toBe("fr");
  await expect(runtime.setLanguagePreference("fr")).rejects.toThrow("Unsupported");
});

const regionalProbes = [
  ["pt-BR", "pt-BR"], ["pt-Latn-BR", "pt-BR"],
  ["zh-CN", "zh-CN"], ["zh-Hans-CN", "zh-CN"], ["zh-SG", "zh-CN"],
  ["zh-TW", "zh-TW"], ["zh-Hant-TW", "zh-TW"], ["zh-HK", "zh-TW"],
  ["zh-Hant-CN", "zh-TW"], ["zh-Hans-TW", "zh-CN"],
  ["zh-Hant-SG", "zh-TW"], ["zh-Hans-HK", "zh-CN"],
  ["zh-Hant", "zh-TW"], ["zh-Hans", "zh-CN"],
  ["zh-Hant-ZZ", "zh-TW"], ["zh-Hans-ZZ", "zh-CN"],
  ["PT-latn-br-u-nu-latn", "pt-BR"], ["zh-Hant-TW-u-nu-hanidec", "zh-TW"],
  ["zh-Hant-CN-u-rg-cnzzzz", "zh-TW"], ["zh-Hans-TW-u-rg-twzzzz", "zh-CN"],
  ["zh-SG-x-hant", "zh-CN"],
];

it("matches synthetic regional catalogs in System order without saving aliases", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zz-ZZ", "pt-Latn-BR", "zh-TW"]);
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe("pt-BR");
  expect(stored.has(KEY)).toBe(false);
  for (const [tag, expected] of regionalProbes) {
    expect(runtime.resolveProductLocale([tag, "en"]), tag).toBe(expected);
  }
  expect(runtime.resolveProductLocale(["zh-HK", "zh-CN"])).toBe("zh-TW");
  expect(runtime.resolveProductLocale(["en-US", "zh-HK"])).toBe("en");
  for (const tag of ["zh", "zh-ZZ", "zh-Latn-CN", "zh-Qaaa-TW", "zh-u-rg-twzzzz", "pt-Cyrl-BR", "pt-Latn-ZZ", "not-a-locale"]) {
    expect(runtime.resolveProductLocale([tag]), tag).toBe("en");
    expect(runtime.resolveProductLocale([tag, "fr-CA"]), tag).toBe("fr-CA");
  }
  await runtime.setLanguagePreference("zh-TW");
  expect(runtime.currentLocale()).toBe("zh-TW");
  expect(stored.get(KEY)).toBe("zh-TW");
  await runtime.setLanguagePreference("system");
  expect(runtime.currentLocale()).toBe("pt-BR");
  expect(stored.has(KEY)).toBe(false);
});

it.each(regionalProbes)("resolves qualification override %s to synthetic catalog %s without saving it", async (tag, expected) => {
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES", "1");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
  window.history.replaceState(null, "", `/?locale=${encodeURIComponent(tag)}`);
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe(expected);
  expect(runtime.message("localization.language.title")).toBe(`SYNTHETIC_${expected}`);
  expect(runtime.languagePreferenceSnapshot()).toBe("system");
  expect(stored.has(KEY)).toBe(false);
  // A picker preference continues to take priority over the qualification URL.
  await runtime.setLanguagePreference("en");
  expect(runtime.currentLocale()).toBe("en");
  expect(stored.get(KEY)).toBe("en");
});

it.each(regionalLocales)("retains saved picker choice %s over the System language", async (locale) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
  stored.set(KEY, locale);
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe(locale);
  expect(runtime.languagePreferenceSnapshot()).toBe(locale);
  expect(stored.get(KEY)).toBe(locale);
});

it("keeps exact and generic parent matches ahead of regional catalog aliases", async () => {
  extraLocales = ["pt-Latn-BR", "zh-Hant-TW", "zh-SG", "zh-Hant", "pt", "fr-u"];
  const runtime = await import("./runtime");
  for (const tag of ["pt-Latn-BR", "zh-Hant-TW", "zh-SG"]) {
    expect(runtime.resolveProductLocale([tag]), tag).toBe(tag);
  }
  expect(runtime.resolveProductLocale(["zh-Hant-HK"])).toBe("zh-Hant");
  expect(runtime.resolveProductLocale(["pt-Latn-PT"])).toBe("pt");
  // A singleton must disappear with its extension value, even if registered.
  expect(runtime.resolveProductLocale(["fr-u-nu-latn"])).toBe("fr");
});

it.each(["zh-Hant-TW", "future-locale"])("preserves unsupported saved value %s without accepting it as a picker choice", async (saved) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-Hans-CN"]);
  stored.set(KEY, saved);
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe("zh-CN");
  expect(runtime.languagePreferenceSnapshot()).toBe("system");
  expect(stored.get(KEY)).toBe(saved);
  await expect(runtime.setLanguagePreference(saved)).rejects.toThrow("Unsupported");
  expect(stored.get(KEY)).toBe(saved);
});

it.each(["zh-TW", "zh-CN"])("never substitutes the other Chinese script when %s is unavailable", async (excluded) => {
  excludedLocales = [excluded];
  const runtime = await import("./runtime");
  const probes = excluded === "zh-TW" ? ["zh-Hant-CN", "zh-HK"] : ["zh-Hans-TW", "zh-SG"];
  for (const tag of probes) {
    expect(runtime.resolveProductLocale([tag]), tag).toBe("en");
  }
});

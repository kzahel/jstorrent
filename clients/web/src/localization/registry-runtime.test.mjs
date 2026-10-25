// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const KEY = "rstorrent.presentation.language";
const syntheticRegistry = {
  sourceLocale: "en", fallbackLocale: "en", supportedLocales: ["en"], previewLocales: ["fr", "fr-CA", "ar-EG"],
  localeDefinitions: { en: { direction: "ltr" }, fr: { direction: "ltr" }, "fr-CA": { direction: "ltr" }, "ar-EG": { direction: "rtl" } },
  testLocales: [{ tag: "en-XA", direction: "ltr" }, { tag: "ar-XB", direction: "rtl" }],
};
let stored;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "1");
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES", "0");
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) });
  delete window.__TAURI_INTERNALS__;
  vi.doMock("./generated/catalogs", async () => {
    const { default: sourceCatalog } = await import("./generated/en.json");
    const catalog = (value) => ({ "localization.language.title": [{ type: 0, value }] });
    return {
      sourceCatalog, localeRegistry: syntheticRegistry,
      catalogs: { en: sourceCatalog, ...(import.meta.env.VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES === "1" ? {
        fr: catalog("SYNTHETIC_FRENCH"), "fr-CA": catalog("SYNTHETIC_REGIONAL_FRENCH"), "ar-EG": catalog("SYNTHETIC_RTL"),
      } : {}) },
    };
  });
});
afterEach(() => {
  vi.doUnmock("./generated/catalogs"); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  delete window.__TAURI_INTERNALS__;
});

it("uses synthetic French registration for parent matching, System, persistence and source fallback", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CH", "en"]);
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe("fr");
  expect(runtime.resolveProductLocale(["fr-CA-u-nu-latn"])).toBe("fr-CA");
  expect(runtime.resolveProductLocale(["not a locale", "fr-CA"])).toBe("fr-CA");
  expect(runtime.availableProductLanguages()).toEqual(["en", "fr", "fr-CA", "ar-EG"]);
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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "rstorrent.presentation.language";
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "0");
  vi.stubEnv("VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES", "0");
  vi.stubGlobal("localStorage", new MemoryStorage());
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("local presentation language preferences", () => {
  it("defaults per field without rewriting unrelated or malformed preferences", async () => {
    localStorage.setItem(KEY, "unknown-future-language");
    localStorage.setItem("unrelated-preference", "keep-me");
    const runtime = await import("./runtime");
    await runtime.initializeLocalization();
    expect(runtime.languagePreferenceSnapshot()).toBe("system");
    expect(runtime.availableProductLanguages()).toEqual(["en", "de", "fr"]);
    expect(runtime.currentLocale()).toBe("en");
    expect(localStorage.getItem(KEY)).toBe("unknown-future-language");
    expect(localStorage.getItem("unrelated-preference")).toBe("keep-me");
    await expect(runtime.setLanguagePreference("zz")).rejects.toThrow("Unsupported");
  });

  it("saves explicit choice and removes only its field when returning to System", async () => {
    const runtime = await import("./runtime");
    await runtime.initializeLocalization();
    const changed = vi.fn();
    const unsubscribe = runtime.onMessageCatalogReplaced(changed);
    localStorage.setItem("unrelated-preference", "keep-me");
    await runtime.setLanguagePreference("en");
    expect(localStorage.getItem(KEY)).toBe("en");
    expect(runtime.languagePreferenceSnapshot()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    await runtime.setLanguagePreference("system");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(runtime.languagePreferenceSnapshot()).toBe("system");
    expect(localStorage.getItem("unrelated-preference")).toBe("keep-me");
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("keeps the active preference if persistence fails", async () => {
    const runtime = await import("./runtime");
    await runtime.initializeLocalization();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    await expect(runtime.setLanguagePreference("en")).rejects.toThrow("storage unavailable");
    expect(runtime.languagePreferenceSnapshot()).toBe("system");
  });

  it("uses native authority without reading or updating a browser override", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "1");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    localStorage.setItem(KEY, "de");
    const runtime = await import("./runtime");
    await runtime.initializeLocalization();
    expect(runtime.languagePreferenceSnapshot()).toBe("system");
    expect(runtime.currentLocale()).toBe("en");
    const save = vi.fn().mockResolvedValue({ preference: "en", locale: "en", availableLocales: ["en"] });
    await runtime.bindDesktopLanguageAuthority({ save }, { preference: "system", locale: "en", availableLocales: ["en"] });
    await runtime.setLanguagePreference("en");
    expect(save).toHaveBeenCalledWith("en");
    expect(runtime.languagePreferenceSnapshot()).toBe("en");
    expect(localStorage.getItem(KEY)).toBe("de");
    await expect(runtime.applyDesktopLocaleSnapshot({ preference: "system", locale: "en", availableLocales: [] })).rejects.toThrow("Invalid");
  });
});

it("ships German System language, formatters and shell without the preview gate", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE", "en"]);
  document.head.innerHTML = '<title data-l10n-id="shell.app.title"></title>';
  const runtime = await import("./runtime");
  await runtime.initializeLocalization();
  expect(runtime.currentLocale()).toBe("de");
  expect(runtime.availableProductLanguages()).toEqual(["en", "de", "fr"]);
  expect(runtime.message("localization.language.title")).toBe("Sprache");
  expect(runtime.formatNumber(1234.5)).toBe("1.234,5");
  expect(runtime.formatList(["TCP", "uTP"])).toContain("und");
  expect(document.documentElement.lang).toBe("de");
  expect(document.title).toBe("JSTorrent");
  expect(localStorage.getItem(KEY)).toBeNull();
  await runtime.setLanguagePreference("en");
  expect(runtime.message("localization.language.title")).toBe("Language");
  expect(runtime.formatNumber(1234.5)).toBe("1,234.5");
  await runtime.setLanguagePreference("system");
  expect(runtime.currentLocale()).toBe("de");
  expect(localStorage.getItem(KEY)).toBeNull();
});

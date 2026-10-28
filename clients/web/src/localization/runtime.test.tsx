import { afterEach, describe, expect, it } from "vitest";

import {
  currentLocale,
  formatDate,
  formatList,
  formatNumber,
  message,
  resolveProductLocale,
  setProductLocaleForTest,
} from "./runtime";

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("product locale selection", () => {
  it("uses canonical English matches and falls back to English", () => {
    expect(resolveProductLocale(["de-DE", "en-GB"])).toBe("en");
    expect(resolveProductLocale(["not a locale", "zz"])).toBe("en");
    expect(resolveProductLocale(["fr-CA", "en"])).toBe("fr");
  });

  it("keeps pseudo-locales behind the test gate", () => {
    expect(resolveProductLocale(["ar-XB"])).toBe("en");
    expect(resolveProductLocale(["ar-XB"], true)).toBe("ar-XB");
  });

  it("formats plural branches and preserves placeholders in pseudo-locales", () => {
    restore = setProductLocaleForTest("en");
    expect(message("common.files.pending", { count: 1 })).toBe("1 more torrent pending");
    expect(message("common.files.pending", { count: 3 })).toBe("3 more torrents pending");
    restore();
    restore = setProductLocaleForTest("en-XA");
    expect(message("common.files.selected", { selected: 2, total: 8 }))
      .toContain("2");
    expect(message("common.files.selected", { selected: 2, total: 8 }))
      .toContain("8");
  });

  it("formats presentation values through the selected Intl locale", () => {
    restore = setProductLocaleForTest("en");
    expect(currentLocale()).toBe("en");
    expect(formatNumber(1234)).toMatch(/1[,\s]234/);
    expect(formatDate(new Date("2026-08-31T12:00:00Z"), { timeZone: "UTC", year: "numeric" }))
      .toContain("2026");
    expect(formatList(["TCP", "uTP"])).toContain("and");
  });

  it("ships French formatting and zero/one/million plurals without the preview gate", () => {
    restore = setProductLocaleForTest("fr");
    const spaces = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");
    expect(message("common.count.peers", { count: 0 })).toBe("0 pair");
    expect(message("common.count.peers", { count: 1 })).toBe("1 pair");
    expect(message("common.count.peers", { count: 2 })).toBe("2 pairs");
    expect(spaces(message("removal.title.multiple", { count: 1_000_000 })))
      .toBe("Retirer 1 000 000 de torrents ?");
    expect(spaces(formatNumber(1234.5))).toBe("1 234,5");
    expect(spaces(message("updates.detail.download-progress", { percent: 0.5, size: "1,5 Mo" })))
      .toBe("50 % · Volume téléchargé : 1,5 Mo.");
  });
});

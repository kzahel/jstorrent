import { expect, it } from "vitest";
import { argumentsFor } from "./qualify-localization.mjs";

const registry = { fallbackLocale: "en", supportedLocales: { web: ["en", "de", "fr"] }, previewLocales: { web: ["es"] } };
const paths = ["--frontend-dir", ".local/frozen assets", "--report", ".local/review.json"];

it("accepts shipping targets and explicit regional/script System probes without shell parsing", () => {
  const args = argumentsFor(["--locale", "fr", ...paths, "--system-locale", "fr-CA", "--system-locale", "fr-Latn-FR"], registry);
  expect(args["frontend-dir"]).toBe(".local/frozen assets");
  expect(args.probes).toEqual(["fr-CA", "fr-Latn-FR"]);
});

it("rejects preview, source and unknown targets for release qualification", () => {
  for (const locale of ["es", "en", "xx", "../fr"])
    expect(() => argumentsFor(["--locale", locale, ...paths], registry)).toThrow("shipping");
});

it("rejects ambiguous options and invalid System tags", () => {
  for (const args of [
    ["--locale", "fr", ...paths, "--locale", "de"],
    ["--locale", "fr", "--report", ".local/result.json"],
    ["--locale", "fr", ...paths, "--system-locale", "not a locale"],
    ["--locale", "fr", ...paths, "--system-locale", "fr-ca"],
    ["--locale", "fr", ...paths, "--executable-path", "/primary/browser"],
  ]) expect(() => argumentsFor(args, registry)).toThrow();
});

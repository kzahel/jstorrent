import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { build } from "vite";
import { generateLocalization } from "./generate-localization.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtures = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jst-web-locales-"));
  fixtures.push(root);
  const registry = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "localization/locales.json"), "utf8"));
  registry.previewLocales.web = ["fr", "fr-CA", "ar-EG"];
  registry.previewLocales.desktop = [];
  Object.assign(registry.localeDefinitions, { fr: { direction: "ltr" }, "fr-CA": { direction: "ltr" }, "ar-EG": { direction: "rtl" } });
  fs.mkdirSync(path.join(root, "localization"));
  fs.writeFileSync(path.join(root, "localization/locales.json"), JSON.stringify(registry));
  const messages = path.join(root, "clients/web/src/localization/messages");
  const generated = path.join(root, "clients/web/src/localization/generated");
  fs.mkdirSync(messages, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });
  for (const [tag, value] of Object.entries({ en: "SYNTHETIC_SOURCE_ENGLISH", fr: "SYNTHETIC_FRENCH_PREVIEW_ONLY", "fr-CA": "SYNTHETIC_REGIONAL_FRENCH", "ar-EG": "SYNTHETIC_RTL_PREVIEW" })) {
    fs.writeFileSync(path.join(messages, `${tag}.json`), JSON.stringify({ example: { defaultMessage: value, description: "Synthetic test fixture, not a product translation." } }));
  }
  fs.writeFileSync(path.join(generated, "zz.json"), JSON.stringify({ example: [{ type: 0, value: "STALE_UNREGISTERED_CATALOG" }] }));
  return { root, registry, generated };
}

async function bundle(generated, preview) {
  const output = await build({
    configFile: false,
    root: path.dirname(generated),
    logLevel: "silent",
    define: { "import.meta.env.VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES": JSON.stringify(preview ? "1" : "0") },
    build: { write: false, minify: false, lib: { entry: path.join(generated, "catalogs.ts"), formats: ["es"] } },
  });
  return (Array.isArray(output) ? output : [output]).flatMap((result) => result.output).filter((chunk) => chunk.type === "chunk").map((chunk) => chunk.code).join("\n");
}

it("generates registered synthetic French/regional/RTL catalogs and excludes preview or stale assets from release", async () => {
  const { root, registry, generated } = fixture();
  generateLocalization(root);
  const module = fs.readFileSync(path.join(generated, "catalogs.ts"), "utf8");
  expect(module).toContain('from "./fr.json"');
  expect(module).toContain('from "./fr-CA.json"');
  expect(module).toContain('"direction": "rtl"');
  expect(module).not.toContain("zz.json");
  const preview = await bundle(generated, true);
  expect(preview).toContain("SYNTHETIC_FRENCH_PREVIEW_ONLY");
  expect(preview).toContain("SYNTHETIC_REGIONAL_FRENCH");
  expect(preview).toContain("SYNTHETIC_RTL_PREVIEW");
  expect(preview).not.toContain("STALE_UNREGISTERED_CATALOG");
  const release = await bundle(generated, false);
  expect(release).toContain("SYNTHETIC_SOURCE_ENGLISH");
  expect(release).not.toContain("SYNTHETIC_FRENCH_PREVIEW_ONLY");
  expect(release).not.toContain("SYNTHETIC_REGIONAL_FRENCH");
  expect(release).not.toContain("SYNTHETIC_RTL_PREVIEW");
  expect(release).not.toContain("STALE_UNREGISTERED_CATALOG");
  registry.previewLocales.web = [];
  fs.writeFileSync(path.join(root, "localization/locales.json"), JSON.stringify(registry));
  generateLocalization(root);
  expect(fs.existsSync(path.join(generated, "fr.json"))).toBe(true);
  const unregistered = await bundle(generated, true);
  expect(unregistered).not.toContain("SYNTHETIC_FRENCH_PREVIEW_ONLY");
  expect(unregistered).not.toContain("SYNTHETIC_RTL_PREVIEW");
});

it("requires a source catalog for every registered web locale", () => {
  const { root } = fixture();
  fs.unlinkSync(path.join(root, "clients/web/src/localization/messages/fr.json"));
  expect(() => generateLocalization(root)).toThrow("Registered web catalog is missing");
});

it("recompiles registered synthetic French edits and registry changes through the dev watcher", async () => {
  const { EventEmitter } = await import("node:events");
  const { compileLocalizationOnChange } = await import("../vite.config.ts");
  const { root, registry, generated } = fixture();
  generateLocalization(root);
  const webRoot = path.join(root, "clients/web");
  fs.mkdirSync(path.join(webRoot, "scripts"));
  fs.writeFileSync(path.join(webRoot, "scripts/generate-localization.mjs"),
    `import { generateLocalization } from ${JSON.stringify(new URL("./generate-localization.mjs", import.meta.url).href)}; generateLocalization(${JSON.stringify(root)});`);
  const watcher = new EventEmitter();
  watcher.add = () => undefined;
  const server = new EventEmitter();
  const errors = [];
  const plugin = compileLocalizationOnChange(webRoot);
  plugin.configureServer({ watcher, httpServer: server, config: { logger: { error: (error) => errors.push(error) } } });
  try {
    const source = path.join(webRoot, "src/localization/messages/fr.json");
    fs.writeFileSync(source, JSON.stringify({ example: { defaultMessage: "SYNTHETIC_EDITED_FRENCH", description: "Synthetic test edit." } }));
    watcher.emit("all", "change", source);
    await expect.poll(() => fs.readFileSync(path.join(generated, "fr.json"), "utf8")).toContain("SYNTHETIC_EDITED_FRENCH");
    registry.previewLocales.web = [];
    const manifest = path.join(root, "localization/locales.json");
    fs.writeFileSync(manifest, JSON.stringify(registry));
    watcher.emit("all", "change", manifest);
    await expect.poll(() => fs.readFileSync(path.join(generated, "catalogs.ts"), "utf8")).not.toContain('from "./fr.json"');
    expect(errors).toEqual([]);
  } finally { server.emit("close"); }
});

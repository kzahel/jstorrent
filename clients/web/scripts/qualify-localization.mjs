// Qualify a shipping locale against frozen production assets using bundled Chromium.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { createIntl, createIntlCache } from "react-intl";
import { readLocaleRegistry } from "../../../scripts/localization-registry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const key = "rstorrent.presentation.language";
const demo = "/?demo=healthy-download&at=42000&autoplay=0";
const hash = value => createHash("sha256").update(value).digest("hex");

export function argumentsFor(argv, registry) {
  const result = { probes: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index], value = argv[index + 1];
    if (!["--locale", "--frontend-dir", "--report", "--system-locale"].includes(option)
        || !value || value.startsWith("--")) throw Error("Expected --locale TAG --frontend-dir DIR --report .local/FILE [--system-locale TAG]");
    if (option === "--system-locale") result.probes.push(value);
    else {
      const name = option.slice(2);
      if (Object.hasOwn(result, name)) throw Error(`Duplicate ${option}`);
      result[name] = value;
    }
  }
  if (!registry.supportedLocales.web.includes(result.locale) || result.locale === registry.fallbackLocale)
    throw Error("Choose a nonfallback shipping web locale; previews cannot qualify release assets");
  if (!result["frontend-dir"] || !result.report) throw Error("Missing asset/report path");
  if (result.probes.length > 20) throw Error("At most 20 System probes per run");
  for (const tag of [result.locale, ...result.probes])
    if (tag.length > 64 || Intl.getCanonicalLocales(tag)[0] !== tag) throw Error(`Noncanonical locale ${tag}`);
  return result;
}

function inside(base, path) {
  return path.startsWith(base + sep);
}

async function serve(directory) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = await realpath(resolve(directory, "." + (path === "/" ? "/index.html" : path)));
      if (!inside(directory, file)) throw Error("outside assets");
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(content);
    } catch {
      response.writeHead(404); response.end();
    }
  });
  server.requestTimeout = 5000;
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  return server;
}

async function accessibility(page, scope) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "document overflows viewport");
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(v => ["serious", "critical"].includes(v.impact));
  assert.deepEqual(violations, [], `accessibility violations in ${scope}`);
}

export async function qualify(options) {
  const registry = readLocaleRegistry(root);
  const locale = options.locale;
  const assets = await realpath(resolve(root, options["frontend-dir"]));
  if (!inside(root, assets)) throw Error("Assets must be inside this repository");
  const output = resolve(root, options.report);
  if (!inside(resolve(root, ".local"), output)) throw Error("Reports must stay under repository .local");
  await mkdir(resolve(root, ".local"), { recursive: true });
  const local = await realpath(resolve(root, ".local"));
  if (!inside(root, local)) throw Error("Local task state escapes repository");
  // Validate existing ancestors before creating report directories.
  let ancestor = dirname(output);
  while (true) {
    try { const actual = await realpath(ancestor); if (actual !== local && !inside(local, actual)) throw Error("Report ancestor escapes local task state"); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; ancestor = dirname(ancestor); }
  }
  const sourceText = await readFile(resolve(root, registry.catalogs.web), "utf8");
  const targetText = await readFile(resolve(root, "clients/web/src/localization/messages", locale + ".json"), "utf8");
  const source = JSON.parse(sourceText), target = JSON.parse(targetText);
  assert.deepEqual(Object.keys(target).sort(), Object.keys(source).sort(), "catalog coverage differs");
  const intl = createIntl({ locale, messages: Object.fromEntries(Object.entries(target).map(([id, descriptor]) => [id, descriptor.defaultMessage])),
    onError(error) { throw error; } }, createIntlCache());
  const text = (id, values) => intl.formatMessage({ id }, values);
  const campaign = JSON.parse(await readFile(resolve(root, "localization/campaigns/legacy-android.json"), "utf8"));
  const probes = options.probes.length ? options.probes : (campaign.locales.find(row => row.tag === locale)?.systemLocaleProbes ?? [locale]);
  const report = { schemaVersion: 1, locale, distribution: "release", passed: false, cases: [],
    sourceHash: hash(sourceText), catalogHash: hash(targetText), indexHash: hash(await readFile(resolve(assets, "index.html"))), systemLocaleProbes: probes };
  let browser, server;
  const cleanup = async () => {
    if (browser) { const owned = browser; browser = undefined; await owned.close(); }
    if (server) { const owned = server; server = undefined; owned.closeAllConnections(); await new Promise(accept => owned.close(accept)); }
  };
  const interrupted = () => { void cleanup().finally(() => process.exit(130)); };
  process.once("SIGINT", interrupted); process.once("SIGTERM", interrupted);
  const run = async (name, action) => { await action(); report.cases.push({ name, passed: true }); };
  try {
    server = await serve(assets);
    browser = await chromium.launch({ headless: true });
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    for (const probe of probes) await run(`System ${probe}`, async () => {
      const context = await browser.newContext({ locale: probe, baseURL, colorScheme: "light", reducedMotion: "reduce" });
      try { const page = await context.newPage(); await page.goto(demo); await expect(page.locator("html")).toHaveAttribute("lang", locale); }
      finally { await context.close(); }
    });
    await run("pseudo-locales excluded from release", async () => {
      for (const probe of ["en-XA", "ar-XB"]) {
        const context = await browser.newContext({ locale: probe, baseURL });
        try { const page = await context.newPage(); await page.goto(demo); await expect(page.locator("html")).toHaveAttribute("lang", registry.fallbackLocale); }
        finally { await context.close(); }
      }
    });
    await run("switch, retain selection, persist, reload and reset System", async () => {
      const context = await browser.newContext({ locale: "en-US", baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      try {
        const page = await context.newPage(); await page.goto(demo);
        await page.getByRole("checkbox", { name: /Sintel 4K open movie/ }).check();
        await page.locator('header button[aria-haspopup="dialog"]').click();
        await expect(page.locator('input[name="language"]')).toHaveCount(registry.supportedLocales.web.length + 1);
        assert.deepEqual((await page.locator('input[name="language"]').evaluateAll(inputs => inputs.map(input => input.value))).sort(),
          ["system", ...registry.supportedLocales.web].sort(), "production picker includes nonshipping languages");
        const radio = page.locator(`input[name="language"][value="${locale}"]`);
        await radio.check(); await expect(radio).toBeFocused();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute("dir", registry.localeDefinitions[locale].direction);
        await expect(page.locator("#language-heading")).toHaveText(text("localization.language.title"));
        assert.equal(await page.evaluate(k => localStorage.getItem(k), key), locale);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("row").filter({ hasText: "Sintel 4K open movie" }).getByRole("checkbox")).toBeChecked();
        await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page.locator('header button[aria-haspopup="dialog"]').click();
        await expect(radio).toBeChecked(); await expect(radio).toBeVisible();
        await page.locator('input[name="language"][value="system"]').check();
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
      } finally { await context.close(); }
    });
    for (const width of [1440, 390]) {
      await run(`settings accessibility and picker reachability ${width}px`, async () => {
        const context = await browser.newContext({ locale: "en-US", baseURL, viewport: { width, height: 900 }, reducedMotion: "reduce" });
        try {
          await context.addInitScript(([k, value]) => localStorage.setItem(k, value), [key, locale]);
          const page = await context.newPage(); await page.goto(demo);
          await page.locator('header button[aria-haspopup="dialog"]').click();
          await expect(page.locator("#language-heading")).toHaveText(text("localization.language.title"));
          const radio = page.locator(`input[name="language"][value="${locale}"]`);
          await radio.scrollIntoViewIfNeeded(); await expect(radio).toBeInViewport(); await expect(radio).toBeChecked();
          await accessibility(page, "settings");
        } finally { await context.close(); }
      });
      await run(`removal meaning, plural and accessibility ${width}px`, async () => {
        const context = await browser.newContext({ locale: "en-US", baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
        try {
          await context.addInitScript(([k, value]) => localStorage.setItem(k, value), [key, locale]);
          const page = await context.newPage(); await page.goto(demo);
          await page.getByRole("checkbox", { name: /Big Buck Bunny 1080p surround/ }).check();
          await page.getByRole("checkbox", { name: /Sintel 4K open movie/ }).check();
          await page.getByRole("button", { name: text("inspection.torrent.actions.remove"), exact: true }).click();
          const dialog = page.getByRole("dialog", { name: text("removal.title.multiple", { count: 2 }) });
          await expect(dialog).toBeVisible(); await page.setViewportSize({ width, height: 900 });
          await expect(dialog.getByRole("checkbox")).not.toBeChecked(); await dialog.getByRole("checkbox").check();
          await expect(dialog.getByRole("alert")).not.toHaveText("");
          const remove = text("inspection.components.remove.torrent.dialog.remove");
          const deletion = text("inspection.components.remove.torrent.dialog.remove.and.delete.data");
          assert.notEqual(remove, deletion, "removal must differ from deleting data");
          await expect(dialog.getByRole("button", { name: deletion, exact: true })).toBeVisible();
          assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), "removal dialog overflows");
          await accessibility(page, "removal");
        } finally { await context.close(); }
      });
    }
    report.passed = true;
  } catch (error) { report.error = String(error.stack ?? error); throw error; }
  finally {
    try { await cleanup(); }
    catch (error) { report.passed = false; report.cleanupError = String(error.stack ?? error); throw error; }
    finally {
      process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", interrupted);
      await mkdir(dirname(output), { recursive: true });
      const temporary = output + "." + randomUUID() + ".tmp";
      try { await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); await rename(temporary, output); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    }
  }
  console.log(JSON.stringify({ locale, distribution: report.distribution, passed: true, cases: report.cases.length, report: options.report }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await qualify(argumentsFor(process.argv.slice(2), readLocaleRegistry(root))); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

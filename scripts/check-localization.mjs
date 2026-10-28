#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readLocaleRegistry } from "./localization-registry.mjs";
import { renderCatalogModule } from "../clients/web/scripts/generate-localization.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
}

function checkPolicy() {
  const locales = readLocaleRegistry(repositoryRoot);
  if (locales.sourceLocale !== "en" || locales.fallbackLocale !== "en") {
    fail("English must remain the source and ultimate fallback locale");
  }
  for (const platform of ["web", "desktop", "android", "ios"]) {
    const supported = locales.supportedLocales?.[platform];
    if (!Array.isArray(supported) || !supported.includes("en")) {
      fail(`${platform} supported locales must include English`);
    }
    requireUnique(supported, `${platform} supported locales`);
    if (platform === "ios" && JSON.stringify(supported) !== JSON.stringify(["en"])) {
      fail("iOS translations require their own native catalog qualification");
    }
    for (const tag of [...supported, ...(locales.previewLocales?.[platform] ?? [])]) {
      if (Intl.getCanonicalLocales(tag)[0] !== tag) fail(`noncanonical locale ${tag}`);
    }
    const preview = locales.previewLocales?.[platform] ?? [];
    requireUnique(preview, `${platform} preview locales`);
    if (preview.some((tag) => supported.includes(tag))) {
      fail(`${platform} preview locales must be separate from shipping locales`);
    }
  }
  const testTags = locales.testLocales.map(({ tag }) => tag);
  const translationTags = new Set(Object.values(locales.supportedLocales).flat()
    .concat(Object.values(locales.previewLocales).flat()).filter((tag) => tag !== "en"));
  for (const tag of translationTags) {
    const guidance = readJson(`localization/terminology/${tag}.json`);
    if (guidance.schemaVersion !== 1 || guidance.locale !== tag ||
        typeof guidance.register !== "string" || !guidance.register.trim() || guidance.register.length > 8192 ||
        !guidance.terms || typeof guidance.terms !== "object" || Array.isArray(guidance.terms)) {
      fail(`${tag} needs shared locale-specific register and terminology guidance`);
    }
  }
  requireUnique(testTags, "test locale tags");
  for (const required of ["en-XA", "ar-XB"]) {
    if (!testTags.includes(required)) fail(`missing test pseudo-locale ${required}`);
    if (Object.values(locales.supportedLocales).some((tags) => tags.includes(required)) ||
        Object.values(locales.previewLocales ?? {}).some((tags) => tags.includes(required))) {
      fail(`test pseudo-locale ${required} must not be a supported locale`);
    }
  }
  for (const [platform, catalog] of Object.entries(locales.catalogs)) {
    if (!fs.existsSync(path.join(repositoryRoot, catalog))) {
      // Catalogs are added surface by surface while Tactical 204 is active.
      console.warn(`Localization catalog pending for ${platform}: ${catalog}`);
    }
  }

  const glossary = readJson("localization/glossary.json");
  const terms = glossary.terms.map(({ term }) => term);
  requireUnique(terms, "glossary terms");
  for (const required of [
    "torrent",
    "tracker",
    "peer",
    "seeding",
    "download root",
    "Normal",
    "Skip",
    "High",
    "checking",
    "paused",
    "completed",
    "remove",
    "delete data",
  ]) {
    if (!terms.includes(required)) fail(`glossary is missing ${required}`);
  }

  const provenance = readJson("localization/provenance.json");
  const sourceRows = provenance.catalogs.filter(({ locale }) => locale === "en");
  requireUnique(sourceRows.map(({ platform }) => platform), "English provenance platforms");
  for (const platform of ["web", "desktop", "android", "ios"]) {
    const row = sourceRows.find((candidate) => candidate.platform === platform);
    if (!row || !row.source || !row.license || row.reviewState !== "source") {
      fail(`English ${platform} catalog has incomplete provenance`);
    }
  }
  for (const [platform, supported] of Object.entries(locales.supportedLocales)) {
    for (const tag of [...supported, ...(locales.previewLocales?.[platform] ?? [])]) {
      if (tag === "en") continue;
      const row = provenance.catalogs.find((entry) => entry.locale === tag && entry.platform === platform);
      if (!row?.source || !row.license || !row.reviewer || row.reviewState !== "agent-reviewed") {
        fail(`${platform} ${tag} catalog has incomplete translation provenance`);
      }
      const distribution = supported.includes(tag) ? "release" : "debug-preview";
      if (row.distribution !== distribution) {
        fail(`${platform} ${tag} requires explicit ${distribution} qualification`);
      }
    }
  }

  const classification = readJson("localization/source-classification.json");
  requireUnique(classification.rules.map(({ path }) => path), "classification paths");
  for (const rule of classification.rules) {
    if (!fs.existsSync(path.join(repositoryRoot, rule.path))) {
      fail(`classified source path does not exist: ${rule.path}`);
    }
  }
}

function walkFiles(relativeRoot) {
  const result = [];
  const pending = [path.join(repositoryRoot, relativeRoot)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else result.push(absolute);
    }
  }
  return result;
}

async function checkWebCatalog() {
  const catalogPath = "clients/web/src/localization/messages/en.json";
  if (!fs.existsSync(path.join(repositoryRoot, catalogPath))) return;
  const catalog = readJson(catalogPath);
  const registryModule = path.join(repositoryRoot, "clients/web/src/localization/generated/catalogs.ts");
  if (!fs.existsSync(registryModule) || fs.readFileSync(registryModule, "utf8") !== renderCatalogModule(readLocaleRegistry(repositoryRoot))) {
    fail("generated web locale registry is stale; run npm run generate:localization --prefix clients/web");
  }
  const compiled = readJson("clients/web/src/localization/generated/en.json");
  const ids = Object.keys(catalog);
  requireUnique(ids, "web message identifiers");
  const parserUrl = pathToFileURL(
    path.join(
      repositoryRoot,
      "clients/web/node_modules/@formatjs/icu-messageformat-parser/index.js",
    ),
  );
  if (!fs.existsSync(fileURLToPath(parserUrl))) {
    fail("web localization dependencies are not installed; run npm install --prefix clients/web");
  }
  const { parse: parseIcu } = await import(parserUrl.href);
  const babelParserUrl = pathToFileURL(
    path.join(repositoryRoot, "clients/web/node_modules/@babel/parser/lib/index.js"),
  );
  const { parse: parseTypescript } = await import(babelParserUrl.href);
  for (const [id, entry] of Object.entries(catalog)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) fail(`invalid web message ID ${id}`);
    if (
      typeof entry !== "object" ||
      entry === null ||
      Object.keys(entry).sort().join(",") !== "defaultMessage,description" ||
      typeof entry.defaultMessage !== "string" ||
      entry.defaultMessage.trim() === "" ||
      typeof entry.description !== "string" ||
      entry.description.trim() === ""
    ) {
      fail(`web message ${id} must have nonempty defaultMessage and description`);
    }
    try {
      const ast = parseIcu(entry.defaultMessage);
      if (JSON.stringify(compiled[id]) !== JSON.stringify(ast)) {
        fail(`compiled web message ${id} is stale; run npm run generate:localization --prefix clients/web`);
      }
    } catch (error) {
      fail(`web message ${id} has invalid ICU syntax: ${error.message}`);
    }
  }
  // Tactical 333: settings, torrent settings and General tab copy uses user
  // vocabulary and whole messages. Diagnostics tabs are not covered.
  const plainCopyPrefixes = [
    "inspection.components.appearance.settings.section.",
    "inspection.components.connection.seeding.settings.section.",
    "inspection.components.data.reset.",
    "inspection.components.detail.pane.",
    "inspection.components.download.settings.section.",
    "inspection.components.notifications.settings.section.",
    "inspection.components.power.settings.section.",
    "inspection.components.rate.limit.picker.",
    "inspection.components.settings.dialog.",
    "inspection.components.torrent.list.",
    "inspection.components.torrent.settings.dialog.",
    "inspection.seed.stop.",
    "inspection.transfer.rate.",
  ];
  const webMaintainerVocabulary =
    /\b(?:effective|applied|genuinely|durable|payload|registrations?|registered|fresh-profile|inactive-exempt|desired-running|root|KiB|MiB|GiB|engine|runtime|snapshot|projection|scaffold|converged|edge-triggered|IGD|MSE\/PE|pinhole|gateway|admitted|choked)\b|Not available yet/i;
  for (const [id, entry] of Object.entries(catalog)) {
    if (!plainCopyPrefixes.some((prefix) => id.startsWith(prefix))) continue;
    const term = entry.defaultMessage.match(webMaintainerVocabulary);
    if (term) fail(`web message ${id} uses maintainer vocabulary "${term[0]}"`);
    if (/^[\s:;,.)·-]|\($/.test(entry.defaultMessage)) {
      fail(`web message ${id} is a sentence fragment: "${entry.defaultMessage}"`);
    }
  }
  for (const relative of [
    "clients/web/src/inspection/components/ConnectionSeedingSettingsSection.tsx",
    "clients/web/src/inspection/components/DetailPane.tsx",
    "clients/web/src/inspection/components/TorrentSettingsDialog.tsx",
  ]) {
    for (const line of fs.readFileSync(path.join(repositoryRoot, relative), "utf8").split("\n")) {
      if (/\.replaceAll\("_", " "\)/.test(line)) {
        fail(`raw enum name shown as product copy in ${relative}: ${line.trim()}`);
      }
    }
  }

  const compiledOrphans = Object.keys(compiled).filter((id) => !(id in catalog));
  if (compiledOrphans.length > 0) fail(`compiled web catalog has orphaned IDs: ${compiledOrphans.join(", ")}`);

  const locales = readJson("localization/locales.json");
  for (const tag of [...locales.supportedLocales.web, ...(locales.previewLocales?.web ?? [])]) {
    if (tag === "en") continue;
    checkReviewedCatalog("web", tag);
    const translated = readJson(`clients/web/src/localization/messages/${tag}.json`);
    const generated = readJson(`clients/web/src/localization/generated/${tag}.json`);
    if (JSON.stringify(Object.keys(generated).sort()) !== JSON.stringify(ids.slice().sort())) {
      fail(`compiled web ${tag} catalog has different keys`);
    }
    for (const [id, entry] of Object.entries(translated)) {
      if (JSON.stringify(generated[id]) !== JSON.stringify(parseIcu(entry.defaultMessage))) {
        fail(`compiled web ${tag} message ${id} is stale; run npm run generate:localization --prefix clients/web`);
      }
    }
  }

  const referenced = new Set();
  const sourceFiles = walkFiles("clients/web/src").filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:localizedMessage|richMessage|message)\(\s*"([^"]+)"/g)) {
      referenced.add(match[1]);
    }
    const relative = path.relative(repositoryRoot, file);
    if (relative === "clients/web/src/inspection/torrent-actions.ts" &&
        /(?:\b(?:label|pendingLabel)\s*:\s*(?:\([^)]*\)\s*=>\s*)?|\breturn\s+)["'`]([A-Za-z][^"'`]*[A-Za-z])["'`]/.test(source)) {
      fail(`uncataloged torrent action copy in ${relative}`);
    }
    if (relative === "clients/web/src/inspection/components/SpeedPanel.tsx") {
      const metricLabels = source.match(/const METRIC_LABELS\b[\s\S]*?\n\};/)?.[0];
      if (!metricLabels || /:\s*["'`][A-Za-z]/.test(metricLabels)) {
        fail(`speed metric labels must use the message catalog in ${relative}`);
      }
    }
    if (file.endsWith(".tsx")) {
      const inline = findInlineWebCopy(source, parseTypescript);
      if (inline !== undefined) fail(`unclassified JSX product copy in ${relative}: ${inline}`);
    }
  }
  for (const htmlFile of ["index.html", "companion.html", "remote.html"]) {
    const source = fs.readFileSync(path.join(repositoryRoot, "clients/web", htmlFile), "utf8");
    for (const match of source.matchAll(/data-l10n-id="([^"]+)"[^>]*>([^<]*)</g)) {
      const [, id, english] = match;
      referenced.add(id);
      if (catalog[id]?.defaultMessage !== english.trim()) {
        fail(`${htmlFile} fallback for ${id} differs from the English catalog`);
      }
    }
    for (const match of source.matchAll(/data-l10n-failure-id="([^"]+)"/g)) {
      referenced.add(match[1]);
      const fallback = catalog[match[1]]?.defaultMessage;
      if (
        typeof fallback !== "string" ||
        !fs.readFileSync(path.join(repositoryRoot, "clients/web/public/rstorrent-boot.js"), "utf8")
          .includes(JSON.stringify(fallback).slice(1, -1))
      ) {
        fail(`${htmlFile} boot failure for ${match[1]} differs from the English catalog`);
      }
    }
  }
  for (const id of referenced) {
    if (!(id in catalog)) fail(`web source references missing message ${id}`);
  }
  const orphaned = ids.filter((id) => !referenced.has(id));
  if (orphaned.length > 0) fail(`orphaned web messages: ${orphaned.slice(0, 12).join(", ")}`);

  const packageJson = readJson("clients/web/package.json");
  const requiredPins = {
    "react-intl": "10.1.25",
    "@formatjs/icu-messageformat-parser": "3.5.17",
  };
  for (const [dependency, version] of Object.entries(requiredPins)) {
    if (packageJson.dependencies?.[dependency] !== version) {
      fail(`web localization dependency ${dependency} must be pinned to ${version}`);
    }
  }
  if (packageJson.devDependencies?.["@formatjs/cli"] !== "6.16.22") {
    fail("@formatjs/cli must be pinned to 6.16.22");
  }
  console.log(`Web localization catalog is valid (${ids.length} English messages)`);
}

function placeholders(message) {
  return [...message.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

function checkDesktopCatalog() {
  const catalog = readJson("clients/desktop/src-tauri/locales/en.json");
  const comments = readJson("clients/desktop/src-tauri/locales/en.comments.json");
  const ids = Object.keys(catalog).sort();
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(comments).sort())) {
    fail("desktop English messages and translator comments have different keys");
  }
  const referenced = new Map();
  for (const file of walkFiles("clients/desktop/src-tauri/src").filter((file) => file.endsWith(".rs"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/desktop_localization::(text|format)(?:_for_locale)?\(\s*"([^"]+)"/g)) {
      const [, kind, id] = match;
      referenced.set(id, kind);
    }
  }
  for (const id of ids) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) fail(`invalid desktop message ID ${id}`);
    if (typeof catalog[id] !== "string" || catalog[id].trim() === "") {
      fail(`desktop message ${id} is empty`);
    }
    if (typeof comments[id] !== "string" || comments[id].trim() === "") {
      fail(`desktop translator comment ${id} is empty`);
    }
    if (!referenced.has(id)) fail(`orphaned desktop message ${id}`);
    const names = placeholders(catalog[id]);
    if (names.length > 0 && referenced.get(id) !== "format") {
      fail(`desktop message ${id} has placeholders but is not formatted`);
    }
    if (names.length === 0 && referenced.get(id) === "format") {
      fail(`desktop message ${id} is formatted without placeholders`);
    }
  }
  for (const id of referenced.keys()) {
    if (!(id in catalog)) fail(`desktop source references missing message ${id}`);
  }
  const locales = readJson("localization/locales.json");
  for (const tag of [...locales.supportedLocales.desktop, ...(locales.previewLocales?.desktop ?? [])]) {
    if (tag !== "en") checkReviewedCatalog("desktop", tag);
  }
  console.log(`Desktop native localization catalog is valid (${ids.length} English messages)`);
}

function checkReviewedCatalog(platform, tag) {
  execFileSync("python3", ["scripts/localization.py", "check", platform, tag], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}

function checkAndroidCatalog() {
  const relativeCatalog = "clients/android/app/src/main/res/values/strings.xml";
  const source = fs.readFileSync(path.join(repositoryRoot, relativeCatalog), "utf8");
  const resources = new Map();
  for (const match of source.matchAll(/<(string|plurals)\s+name="([a-z0-9_]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, kind, name, body] = match;
    if (resources.has(name)) fail(`duplicate Android resource ${name}`);
    resources.set(name, { kind, body });
    if (kind === "plurals") {
      const quantities = [...body.matchAll(/<item\s+quantity="([a-z]+)"/g)].map((item) => item[1]);
      for (const required of ["one", "other"]) {
        if (!quantities.includes(required)) fail(`Android plurals ${name} is missing ${required}`);
      }
    }
    for (const placeholder of body.matchAll(/%(?!%)(\d+)\$([a-z])/g)) {
      if (!/[dfs]/.test(placeholder[2])) {
        fail(`Android resource ${name} has unsupported placeholder ${placeholder[0]}`);
      }
    }
  }
  if (resources.size === 0) fail("Android English catalog is empty");
  // Tactical 331: product copy uses user vocabulary, not engine or policy terms.
  const maintainerVocabulary =
    /\b(?:effective|applied|genuinely|durable|payload|registrations?|fresh-profile|inactive-exempt|desired-running|root|KiB|MiB|GiB)\b|Not available yet/i;
  for (const [name, { body }] of resources) {
    const term = body.match(maintainerVocabulary);
    if (term) fail(`Android resource ${name} uses maintainer vocabulary "${term[0]}"`);
  }

  const referenced = new Set();
  const sourceFiles = walkFiles("clients/android/app/src/main/java").filter((file) => file.endsWith(".kt"));
  for (const file of sourceFiles) {
    const kotlin = fs.readFileSync(file, "utf8");
    for (const match of kotlin.matchAll(/R\.(?:string|plurals)\.([a-z0-9_]+)/g)) {
      referenced.add(match[1]);
    }
    const relative = path.relative(repositoryRoot, file);
    // Settings and torrent detail copy must map enums to catalog labels. Log
    // severity and profile names in the Logs screen are verbatim diagnostics.
    if (/ui\/Product(?:App|Formatting|SettingsScreens)\.kt$/.test(relative)) {
      for (const line of kotlin.split("\n")) {
        if (/\.name\.lowercase\(\)/.test(line) && !/\b(?:severity|profile)\.name/.test(line)) {
          fail(`raw enum name shown as product copy in ${relative}: ${line.trim()}`);
        }
      }
    }
    for (const [pattern, interpolationAware] of [
      [/\bText\(\s*"([^"\n]*)"/, true],
      [/contentDescription\s*=\s*"([^"\n]*)"/, false],
      [/\.setContent(?:Title|Text)\(\s*"([^"\n]*)"/, false],
      [/(?:error|preferenceError|runtimeError)\s*=\s*"([^"\n]*)"/, false],
    ]) {
      const inline = kotlin.match(pattern);
      const candidate =
        interpolationAware ? inline?.[1].replace(/\$\{[^}]+\}/g, "") : inline?.[1];
      if (candidate && /[A-Za-z]/.test(candidate)) {
        fail(`unclassified Android product copy in ${relative}: ${inline[1]}`);
      }
    }
  }
  const manifest = fs.readFileSync(
    path.join(repositoryRoot, "clients/android/app/src/main/AndroidManifest.xml"),
    "utf8",
  );
  if (!manifest.includes('android:label="@string/app_name"')) {
    fail("Android application label must use @string/app_name");
  }
  referenced.add("app_name");
  for (const name of referenced) {
    if (!resources.has(name)) fail(`Android source references missing resource ${name}`);
  }
  const orphaned = [...resources.keys()].filter((name) => !referenced.has(name));
  if (orphaned.length > 0) {
    fail(`orphaned Android resources: ${orphaned.slice(0, 16).join(", ")}`);
  }
  const resourceRoot = path.join(repositoryRoot, "clients/android/app/src/main/res");
  const pseudoDirectories = fs.readdirSync(resourceRoot).filter((name) => /-(?:en-rXA|ar-rXB)$/.test(name));
  if (pseudoDirectories.length > 0) fail("Android pseudo-locales must be generated debug assets only");
  const gradle = fs.readFileSync(
    path.join(repositoryRoot, "clients/android/app/build.gradle.kts"),
    "utf8",
  );
  if (!/debug\s*\{[\s\S]*?isPseudoLocalesEnabled\s*=\s*true/.test(gradle)) {
    fail("Android debug builds must enable generated pseudo-locales");
  }
  execFileSync(process.execPath, ["clients/android/scripts/check-locale-config.mjs"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  const locales = readJson("localization/locales.json");
  for (const tag of [...locales.supportedLocales.android, ...(locales.previewLocales.android ?? [])]) {
    if (tag === "en") continue;
    execFileSync("python3", ["clients/android/scripts/localization.py", "check", tag], {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
  }
  console.log(`Android localization catalog is valid (${resources.size} English resources)`);
}

function checkIOSCatalog() {
  const catalogPath = "clients/ios/App/Localization/Localizable.xcstrings";
  const infoCatalogPath = "clients/ios/App/Localization/InfoPlist.xcstrings";
  const catalog = readJson(catalogPath);
  const infoCatalog = readJson(infoCatalogPath);
  for (const [label, value] of [["iOS", catalog], ["iOS Info.plist", infoCatalog]]) {
    if (value.sourceLanguage !== "en" || value.version !== "1.0") {
      fail(`${label} String Catalog must use English source language and version 1.0`);
    }
    for (const pseudo of ["en-XA", "ar-XB"]) {
      if (JSON.stringify(value).includes(`"${pseudo}"`)) {
        fail(`${label} String Catalog must not package pseudo-locale ${pseudo}`);
      }
    }
  }

  const ids = Object.keys(catalog.strings).sort();
  requireUnique(ids, "iOS String Catalog identifiers");
  for (const id of ids) {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id)) fail(`invalid iOS message ID ${id}`);
    const entry = catalog.strings[id];
    if (typeof entry.comment !== "string" || entry.comment.trim() === "") {
      fail(`iOS message ${id} is missing translator context`);
    }
    if (entry.extractionState !== "manual") {
      fail(`iOS message ${id} must record manual catalog ownership`);
    }
    const english = entry.localizations?.en;
    if (!english) fail(`iOS message ${id} is missing English`);
    if (english.stringUnit) {
      checkIOSStringUnit(id, english.stringUnit);
    } else {
      const plural = english.variations?.plural;
      if (!plural || !plural.one || !plural.other) {
        fail(`iOS message ${id} must contain one and other plural variants`);
      }
      checkIOSStringUnit(`${id}.one`, plural.one.stringUnit);
      checkIOSStringUnit(`${id}.other`, plural.other.stringUnit);
      const onePlaceholders = iosPlaceholders(plural.one.stringUnit.value);
      const otherPlaceholders = iosPlaceholders(plural.other.stringUnit.value);
      if (JSON.stringify(onePlaceholders) !== JSON.stringify(otherPlaceholders)) {
        fail(`iOS plural ${id} has incompatible placeholders`);
      }
    }
  }

  const referenced = new Set();
  for (const file of walkFiles("clients/ios/App").filter((candidate) => candidate.endsWith(".swift"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:String\(localized:|LocalizedStringResource\()\s*"([^"]+)"/g,
    )) {
      referenced.add(match[1]);
    }
    const relative = path.relative(repositoryRoot, file);
    for (const pattern of [
      /\b(?:Text|Button|Section|Toggle|navigationTitle|accessibilityLabel)\(\s*"([^"\n]*[A-Za-z][^"\n]*)"/,
      /\bLabel\(\s*"([^"\n]*[A-Za-z][^"\n]*)"\s*,\s*systemImage:/,
      /\b(?:engineStatus|selectionStatus|backgroundStatus)\s*=\s*"([^"\n]*[A-Za-z][^"\n]*)"/,
      /\breportStatus\(\s*"([^"\n]*[A-Za-z][^"\n]*)"/,
      /content\.(?:title|body)\s*=\s*"([^"\n]*[A-Za-z][^"\n]*)"/,
    ]) {
      const inline = source.match(pattern);
      if (inline) fail(`unclassified iOS product copy in ${relative}: ${inline[1]}`);
    }
    if (/\b(?:L10n|LocalizationStore)\b/.test(source)) {
      fail(`legacy iOS localization wrapper remains in ${relative}`);
    }
  }
  for (const id of referenced) {
    if (!(id in catalog.strings)) fail(`iOS source references missing message ${id}`);
  }
  const orphaned = ids.filter((id) => !referenced.has(id));
  if (orphaned.length > 0) fail(`orphaned iOS messages: ${orphaned.slice(0, 16).join(", ")}`);

  const info = fs.readFileSync(path.join(repositoryRoot, "clients/ios/App/Info.plist"), "utf8");
  const requiredInfo = {
    "BitTorrent metainfo": { plistKey: "UTTypeDescription", value: "BitTorrent metainfo" },
    CFBundleDisplayName: { plistKey: "CFBundleDisplayName", value: "JSTorrent" },
    CFBundleName: { plistKey: "CFBundleName", value: "JSTorrent" },
    CFBundleTypeName: { plistKey: "CFBundleTypeName", value: "BitTorrent metainfo" },
    CFBundleURLName: { plistKey: "CFBundleURLName", value: "Magnet link" },
    NSLocalNetworkUsageDescription: {
      plistKey: "NSLocalNetworkUsageDescription",
      value: "JSTorrent connects directly to peers on your local network.",
    },
  };
  const infoIds = Object.keys(infoCatalog.strings).sort();
  if (JSON.stringify(infoIds) !== JSON.stringify(Object.keys(requiredInfo).sort())) {
    fail("iOS Info.plist String Catalog has missing or orphaned keys");
  }
  for (const [id, requirement] of Object.entries(requiredInfo)) {
    const entry = infoCatalog.strings[id];
    if (
      entry?.localizations?.en?.stringUnit?.value !== requirement.value ||
      entry.extractionState !== "manual" ||
      !entry.comment?.trim()
    ) {
      fail(`iOS Info.plist message ${id} is incomplete`);
    }
    const escapedKey = requirement.plistKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedSource = (requirement.source ?? requirement.value)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`<key>${escapedKey}</key>[\\s\\S]*?<string>${escapedSource}</string>`).test(info)) {
      fail(`iOS Info.plist source for ${id} differs from its String Catalog`);
    }
  }
  if (fs.existsSync(path.join(repositoryRoot, "clients/ios/App/Localization/en.json"))) {
    fail("legacy iOS JSON localization authority must be removed");
  }
  const project = fs.readFileSync(path.join(repositoryRoot, "clients/ios/project.yml"), "utf8");
  if (!/SWIFT_EMIT_LOC_STRINGS:\s*YES/.test(project)) {
    fail("iOS project must enable native localization extraction");
  }
  if (/CFBundleLocalizations/.test(info)) {
    fail("English-only iOS must not advertise a per-app language list");
  }
  console.log(
    `iOS localization catalogs are valid (${ids.length} product messages, ${infoIds.length} Info.plist messages)`,
  );
}

function checkIOSStringUnit(id, unit) {
  if (unit?.state !== "translated" || typeof unit.value !== "string" || unit.value.trim() === "") {
    fail(`iOS message ${id} has an incomplete English string unit`);
  }
  iosPlaceholders(unit.value);
}

function iosPlaceholders(value) {
  const scrubbed = value.replaceAll("%%", "");
  const placeholders = [...scrubbed.matchAll(/%(?:(\d+)\$)?(lld|ld|d|u|@|f)/g)]
    .map((match) => `${match[1] ?? ""}:${match[2]}`)
    .sort();
  const residue = scrubbed.replace(/%(?:(\d+)\$)?(lld|ld|d|u|@|f)/g, "");
  if (/%/.test(residue)) fail(`iOS message contains unsupported format syntax: ${value}`);
  return placeholders;
}

function findInlineWebCopy(source, parseTypescript) {
  const attributeNames = new Set([
    "alt", "aria-description", "aria-label", "data-label", "emptyMessage",
    "label", "placeholder", "title",
  ]);
  const tree = parseTypescript(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  let found;
  visit(tree);
  return found;

  function visit(node) {
    if (found !== undefined) return;
    if (node.type === "JSXText") {
      const value = node.value.replace(/\s+/g, " ").trim();
      if (value.length > 1 && /[A-Za-z]/.test(value)) found = value;
    } else if (
      node.type === "JSXAttribute" &&
      node.name.type === "JSXIdentifier" &&
      attributeNames.has(node.name.name) &&
      node.value?.type === "StringLiteral" &&
      /[A-Za-z]/.test(node.value.value)
    ) {
      found = node.value.value;
    }
    for (const value of Object.values(node)) {
      if (found !== undefined) return;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && typeof child.type === "string") visit(child);
        }
      } else if (value && typeof value === "object" && typeof value.type === "string") {
        visit(value);
      }
    }
  }
}

export async function main() {
  checkPolicy();
  await checkWebCatalog();
  checkDesktopCatalog();
  checkAndroidCatalog();
  checkIOSCatalog();
  const locales = readJson("localization/locales.json");
  console.log(`Localization policy is valid (shipping: ${Object.entries(locales.supportedLocales)
    .map(([platform, tags]) => `${platform}=${tags.join(",")}`).join("; ")}; test: en-XA, ar-XB)`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(`Localization validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

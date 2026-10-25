#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const androidRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(androidRoot, "../..");
const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "localization/locales.json"), "utf8"));
const shipping = policy.supportedLocales.android;
const preview = policy.previewLocales.android ?? [];
const configurations = [
  ["main", shipping],
  ["debug", [...shipping, ...preview]],
];
const manifest = fs.readFileSync(path.join(androidRoot, "app/src/main/AndroidManifest.xml"), "utf8");
if (!manifest.includes('android:localeConfig="@xml/locales_config"')) {
  throw new Error("AndroidManifest.xml must reference @xml/locales_config");
}

for (const [sourceSet, tags] of configurations) {
  const configPath = path.join(androidRoot, `app/src/${sourceSet}/res/xml/locales_config.xml`);
  const entries = tags.map((tag) => `    <locale android:name="${tag}" />`).join("\n");
  if (process.argv.includes("--generate")) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath,
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      `${entries}\n</locale-config>\n`);
  }
  const config = fs.readFileSync(configPath, "utf8");
  const actual = [...config.matchAll(/<locale\s+android:name="([^"]+)"\s*\/>/g)].map((match) => match[1]);
  if (JSON.stringify(actual) !== JSON.stringify(tags)) {
    throw new Error(`${sourceSet} Android LocaleConfig differs from localization/locales.json`);
  }
}

const translations = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "localization/android/locales.json"), "utf8")).locales;
for (const [tag, config] of Object.entries(translations)) {
  const sourceSet = shipping.includes(tag) ? "main" : preview.includes(tag) ? "debug" : null;
  if (!sourceSet || !config.catalog.startsWith(`clients/android/app/src/${sourceSet}/res/`)) {
    throw new Error(`Android translation ${tag} has an undeclared or incorrect release/preview resource path`);
  }
}
for (const tag of [...shipping, ...preview].filter((tag) => tag !== "en")) {
  if (!translations[tag]) throw new Error(`Android locale ${tag} has no translation configuration`);
}
// A hidden locale list alone cannot keep a draft out of release resolution.
for (const sourceSet of ["main", "release"]) {
  const root = path.join(androidRoot, `app/src/${sourceSet}/res`);
  if (!fs.existsSync(root)) continue;
  for (const directory of fs.readdirSync(root)) {
    const match = /^values-([a-z]{2,3})(?:-r([A-Z]{2}))?$/.exec(directory);
    const bcp = directory.startsWith("values-b+") ? directory.slice(9).replaceAll("+", "-") : null;
    const tag = bcp ?? (match ? match[1] + (match[2] ? `-${match[2]}` : "") : null);
    if (tag && !shipping.includes(tag)) {
      throw new Error(`Nonshipping Android locale ${tag} is present in release resource inputs`);
    }
  }
}
console.log(`Android locale configuration is valid (release: ${shipping.join(", ")}; preview: ${preview.join(", ")})`);

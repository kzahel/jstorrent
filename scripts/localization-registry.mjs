// Shared build-time locale registration; runtime catalogs remain platform-native.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const platforms = ["web", "desktop", "android", "ios"];

function canonical(tag) {
  if (typeof tag !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag) ||
      Intl.getCanonicalLocales(tag)[0] !== tag || ["en-XA", "ar-XB"].includes(tag)) {
    throw new Error(`invalid product locale tag: ${tag}`);
  }
}

export function validateLocaleRegistry(registry) {
  if (registry.sourceLocale !== "en" || registry.fallbackLocale !== "en") {
    throw new Error("English must remain the source and final fallback");
  }
  if (!registry.localeDefinitions || typeof registry.localeDefinitions !== "object" ||
      Array.isArray(registry.localeDefinitions) || Object.keys(registry.localeDefinitions).length > 100) {
    throw new Error("expected at most 100 locale definitions");
  }
  for (const [tag, definition] of Object.entries(registry.localeDefinitions)) {
    canonical(tag);
    if (!definition || Object.keys(definition).join(",") !== "direction" ||
        !["ltr", "rtl"].includes(definition.direction)) {
      throw new Error(`invalid direction metadata for locale ${tag}`);
    }
  }
  for (const [label, values] of [["supported", registry.supportedLocales], ["preview", registry.previewLocales]]) {
    if (!values || typeof values !== "object" || Array.isArray(values) ||
        Object.keys(values).some((platform) => !platforms.includes(platform) || (label === "preview" && platform === "ios"))) {
      throw new Error(`invalid ${label} platform map`);
    }
  }
  for (const platform of platforms) {
    const shipping = registry.supportedLocales[platform];
    const preview = registry.previewLocales[platform] ?? [];
    if (!Array.isArray(shipping) || !shipping.includes("en") || !Array.isArray(preview)) {
      throw new Error(`${platform} requires English shipping and a locale list`);
    }
    const tags = [...shipping, ...preview];
    if (new Set(tags).size !== tags.length || tags.length > 100) {
      throw new Error(`${platform} has duplicate/overlapping or too many locales`);
    }
    for (const tag of tags) {
      canonical(tag);
      if (!Object.hasOwn(registry.localeDefinitions, tag)) throw new Error(`missing locale definition: ${tag}`);
    }
  }
  for (const tag of registry.supportedLocales.desktop) {
    if (!registry.supportedLocales.web.includes(tag)) throw new Error(`desktop shipping locale ${tag} requires shipping React support`);
  }
  for (const tag of registry.previewLocales.desktop ?? []) {
    if (!platformLocales(registry, "web", true).includes(tag)) throw new Error(`desktop preview locale ${tag} requires React support`);
  }
  if (!registry.catalogs || platforms.some((platform) => typeof registry.catalogs[platform] !== "string" || !registry.catalogs[platform])) {
    throw new Error("each platform needs its source catalog path");
  }
  if (!Array.isArray(registry.testLocales) || registry.testLocales.length !== 2 ||
      !registry.testLocales.some((entry) => entry.tag === "en-XA" && entry.direction === "ltr") ||
      !registry.testLocales.some((entry) => entry.tag === "ar-XB" && entry.direction === "rtl")) {
    throw new Error("the LTR and RTL test locale definitions must remain separate from product locales");
  }
  return registry;
}

export function readLocaleRegistry(root = repositoryRoot) {
  const file = path.join(root, "localization/locales.json");
  if (fs.statSync(file).size > 1024 * 1024) throw new Error("locale registry exceeds its size limit");
  return validateLocaleRegistry(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function platformLocales(registry, platform, includePreview = false) {
  if (!platforms.includes(platform)) throw new Error(`unknown locale platform: ${platform}`);
  return [...registry.supportedLocales[platform], ...(includePreview ? registry.previewLocales[platform] ?? [] : [])];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  readLocaleRegistry();
  console.log("Locale registry is valid");
}

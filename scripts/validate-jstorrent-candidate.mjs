#!/usr/bin/env node
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extensionIdFromPublicKey, validateSource } from "../clients/extension/scripts/validate.mjs";
import { validateDesktopReleaseRepository } from "./validate-desktop-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));

export function mergeConfig(base, overlay) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = value !== null && typeof value === "object" && !Array.isArray(value)
      ? mergeConfig(base[key] ?? {}, value) : value;
  }
  return merged;
}

function version(value) {
  assert.match(value, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u);
  return value.split(".").map(Number);
}
function newer(current, previous) {
  const a = version(current), b = version(previous);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function validateCandidate({ trust, desktop, extension, certificate, gradle, nsis }) {
  assert.equal(desktop.identifier, trust.desktop.identifier, "wrong desktop identity");
  assert.equal(desktop.productName, trust.desktop.productName, "wrong desktop name");
  assert.deepEqual(desktop.plugins.updater.endpoints, [trust.desktop.endpoint], "wrong updater route");
  assert.equal(desktop.plugins.updater.pubkey, trust.desktop.publicKey, "wrong updater trust root");
  assert(newer(desktop.version, trust.desktop.baselineVersion), "desktop version does not replace the legacy baseline");
  assert.deepEqual(desktop.plugins["deep-link"].desktop.schemes, ["magnet"]);
  const file = desktop.bundle.fileAssociations[0];
  assert.equal(file.name, trust.desktop.fileClass);
  assert.equal(file.exportedType.identifier, trust.desktop.fileClass);
  assert(nsis.includes(`Software\\Classes\\${trust.desktop.fileClass}\\shell\\open\\command`));
  assert(nsis.includes("$APPDATA\\com.jstorrent.desktop\\native-host"));
  assert.equal(extensionIdFromPublicKey(extension.key), trust.extension.id, "wrong production extension ID");
  assert.equal(extension.key, trust.extension.publicKey);
  assert(newer(extension.version, trust.extension.baselineVersion), "extension version does not replace the legacy baseline");
  assert.equal(new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toLowerCase(), trust.android.uploadCertificateSha256, "wrong Android upload certificate");
  assert(gradle.includes(`applicationId = "${trust.android.package}"`));
  const code = Number(gradle.match(/^\s*versionCode = (\d+)$/mu)?.[1]);
  assert(Number.isInteger(code) && code > trust.android.baselineVersionCode && code <= 2100000000, "Android versionCode does not replace the legacy baseline");
  assert.match(
    gradle,
    /\bvariant\.applicationId\.set\(\s*qualificationPackage\s*\?:\s*upgradePackage\s*\?:\s*"org\.rstorrent\.bootstrap"\s*\)/u,
    "normal debug identity must stay isolated",
  );
  return { desktop: desktop.version, androidVersionCode: code, extension: extension.version };
}

export function candidateInputs() {
  return {
    trust: json("distribution/jstorrent-production.json"),
    desktop: mergeConfig(json("clients/desktop/src-tauri/tauri.conf.json"), json("clients/desktop/src-tauri/tauri.jstorrent.conf.json")),
    extension: validateSource(true),
    certificate: read("clients/android/upload-certificate.pem"),
    gradle: read("clients/android/app/build.gradle.kts"),
    nsis: read("clients/desktop/src-tauri/nsis/jstorrent-hooks.nsh"),
  };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateDesktopReleaseRepository(root);
  console.log("Validated JSTorrent production candidate configuration:", validateCandidate(candidateInputs()));
  console.log("Store maximum versions, private signing material and installed delivery remain checklist gates.");
}

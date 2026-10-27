import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const productionExtensionId = "dbokmlpefliilbjldladbimlcfgbolhk";
export const storeExtensionId = "gcgoepclopkgijmclmlheafaglmbjlcc";

export const companionPackagedFiles = Object.freeze([
  "companion/companion.html",
  "companion/assets/companion.css",
  "companion/assets/companion.js",
  "companion/assets/companion.png",
]);

export const packagedFiles = Object.freeze([
  "manifest.json",
  "LICENSE.jstorrent.txt",
  "icons/icon-32.png",
  "icons/icon-128.png",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "popup/platform.js",
  "crostini/setup.html",
  "crostini/setup.css",
  "crostini/setup.js",
  "crostini/connect.html",
  "crostini/connect.js",
  "src/service-worker.js",
  "src/product-metrics.js",
  "src/support-context.js",
  ...companionPackagedFiles,
]);

const sourcePackagedFiles = packagedFiles.filter(
  (relativePath) => !companionPackagedFiles.includes(relativePath),
);

function fail(message) {
  throw new Error(`extension validation failed: ${message}`);
}

export function extensionIdFromPublicKey(publicKey) {
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    fail("manifest key must be a nonempty base64 public key");
  }
  const der = Buffer.from(publicKey, "base64");
  if (der.length === 0 || der.toString("base64") !== publicKey) {
    fail("manifest key must be canonical unwrapped base64");
  }
  return createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/gu, (nibble) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16)),
    );
}

export function validateSource(production = false) {
  let manifest = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
  if (production) {
    const overlay = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.jstorrent.json"), "utf8"));
    if (JSON.stringify(Object.keys(overlay).sort()) !== JSON.stringify(["key", "version"])) {
      fail("production overlay may change only the key and version");
    }
    manifest = { ...manifest, ...overlay };
    if (typeof manifest.version !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(manifest.version)) {
      fail("production version must contain three canonical integers");
    }
    const version = manifest.version.split(".").map(Number);
    if (version.some((v) => !Number.isInteger(v) || v > 65535) ||
        (version[0] < 1 || (version[0] === 1 && version[1] < 1) ||
         (version[0] === 1 && version[1] === 1 && version[2] <= 1))) {
      fail("production version must exceed pinned JSTorrent 1.1.1");
    }
  }
  const expectedExtensionId = production ? productionExtensionId : storeExtensionId;
  if (manifest.manifest_version !== 3 || manifest.name !== "JSTorrent") {
    fail("expected the reviewed JSTorrent Manifest V3 identity");
  }
  const derivedExtensionId = extensionIdFromPublicKey(manifest.key);
  if (derivedExtensionId !== expectedExtensionId) {
    fail(`manifest key derives ${derivedExtensionId}, expected store item ${expectedExtensionId}`);
  }
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(["nativeMessaging", "storage"])) {
    fail("only nativeMessaging and storage permissions are accepted");
  }
  if (
    JSON.stringify(manifest.optional_host_permissions) !==
    JSON.stringify(["http://100.115.92.2/*", "http://jstorrent.localhost/*"])
  ) {
    fail("optional host permission must contain only the exact ARC and Crostini hosts");
  }
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(["http://127.0.0.1/*"])) {
    fail("desktop control requires only the exact loopback host permission");
  }
  for (const forbidden of ["content_scripts", "web_accessible_resources"]) {
    if (manifest[forbidden] !== undefined) {
      fail(`manifest must not declare ${forbidden}`);
    }
  }
  if (
    JSON.stringify(manifest.externally_connectable) !==
    JSON.stringify({ matches: ["http://jstorrent.localhost/*", "https://jstorrent.com/chrome-extension", "https://jstorrent.com/chrome-extension.html"] })
  ) {
    fail("externally_connectable must contain only Crostini and the exact JSTorrent Android handoff");
  }
  if (manifest.background?.service_worker !== "src/service-worker.js") {
    fail("unexpected service worker entry point");
  }
  if (manifest.background?.type !== "module") {
    fail("product metrics require the reviewed module service worker");
  }
  if (manifest.action?.default_popup !== "popup/popup.html") {
    fail("unexpected popup entry point");
  }
  const expectedCsp =
    "script-src 'self'; object-src 'none'; connect-src " +
    ["http", "ws"]
      .flatMap((scheme) =>
        [3030, 3031, 3032, 3033, 3034].map(
          (port) => `${scheme}://100.115.92.2:${port}`,
        ),
      )
      .join(" ") + " " + [7800, 7805, 7814, 7827, 7844]
        .map((port) => `http://100.115.92.2:${port}`).join(" ") + " ws://127.0.0.1:* http://jstorrent.localhost:3030";
  if (manifest.content_security_policy?.extension_pages !== expectedCsp) {
    fail("extension-page CSP must contain only local scripts and the five exact ARC endpoints");
  }

  for (const relativePath of sourcePackagedFiles) {
    readFileSync(path.join(extensionRoot, relativePath));
  }

  for (const relativePath of sourcePackagedFiles.filter((file) => file.endsWith(".js"))) {
    const absolutePath = path.join(extensionRoot, relativePath);
    const source = readFileSync(absolutePath, "utf8");
    if (/\beval\s*\(|\bnew\s+Function\b/u.test(source)) {
      fail(`${relativePath} contains dynamic-code syntax`);
    }
    const urls = source.match(/https?:\/\/[^"'`\s)]+/gu) ?? [];
    if (
      urls.some(
        (url) =>
          url !== "http://jstorrent.localhost:3030" &&
          url !== "http://100.115.92.2/*" &&
          url !== "http://jstorrent.localhost/*" &&
          url !== "https://jstorrent.com/privacy.html" &&
          url !== "https://jstorrent.com/chrome-extension" &&
          url !== "https://jstorrent.com/chrome-extension.html" &&
          url !== "https://jstorrent.com/feedback.html" &&
          url !== "https://jstorrent.com/uninstall.html",
      )
    ) {
      fail(`${relativePath} contains an unexpected remote URL`);
    }
    execFileSync(process.execPath, ["--check", absolutePath], { stdio: "pipe" });
  }

  const popup = readFileSync(path.join(extensionRoot, "popup/popup.html"), "utf8");
  if (/<script(?![^>]*\bsrc=)/iu.test(popup) || /\son[a-z]+\s*=/iu.test(popup)) {
    fail("popup contains inline executable markup");
  }
  if (!popup.includes('<script type="module" src="popup.js"></script>')) {
    fail("popup script must remain a local external module");
  }
  const playStoreUrl = "https://play.google.com/store/apps/details?id=com.jstorrent.app";
  const popupUrls = popup.match(/https?:\/\/[^"'\s<]+/gu) ?? [];
  if (JSON.stringify(popupUrls) !== JSON.stringify([playStoreUrl])) {
    fail("popup must link only to the exact published JSTorrent Android listing");
  }
  if (!popup.includes('id="desktop-surface" hidden') || !popup.includes('id="chromeos-surface" hidden')) {
    fail("popup surfaces must start hidden until the platform decision completes");
  }
  const setup = readFileSync(path.join(extensionRoot, "crostini/setup.html"), "utf8");
  const setupModule = '<script type="module" src="setup.js"></script>';
  if (!setup.includes(setupModule) || /<script/iu.test(setup.replace(setupModule, "")) || /\son[a-z]+\s*=/iu.test(setup)) {
    fail("Crostini setup must use only its local clipboard module");
  }
  const setupScript = readFileSync(path.join(extensionRoot, "crostini/setup.js"), "utf8");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|eval|import)\b/u.test(setupScript)) {
    fail("Crostini setup clipboard module must remain offline");
  }
  const connection = readFileSync(path.join(extensionRoot, "crostini/connect.html"), "utf8");
  if (/<script(?![^>]*\bsrc=)/iu.test(connection) || /\son[a-z]+\s*=/iu.test(connection) ||
      !connection.includes('<script type="module" src="connect.js"></script>')) {
    fail("Linux connection must use only its local external module");
  }
  return manifest;
}

export function validateCompanionBuild(companionRoot) {
  const expected = ["assets/companion.css", "assets/companion.js", "assets/companion.png", "companion.html"];
  const actual = listFiles(companionRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`companion build file set drifted: ${actual.join(", ")}`);
  }
  for (const relativePath of expected) {
    readFileSync(path.join(companionRoot, relativePath));
  }
  const html = readFileSync(path.join(companionRoot, "companion.html"), "utf8");
  if (/<script(?![^>]*\bsrc=)/iu.test(html) || /\son[a-z]+\s*=/iu.test(html)) {
    fail("companion application contains inline executable markup");
  }
  const source = readFileSync(path.join(companionRoot, "assets/companion.js"), "utf8");
  if (/\beval\s*\(|\bnew\s+Function\b|\brequire\s*\(/u.test(source)) {
    fail("companion application contains dynamic-code syntax");
  }
  if (!source.includes("100.115.92.2") || !source.includes("rstorrent/companion/v1")) {
    fail("companion application omits the fixed ARC endpoint contract");
  }
  const remoteHosts = source.match(/(?:https?|wss?):\/\/[A-Za-z0-9.${}_-]+/gu) ?? [];
  const allowedHosts = new Set([
    "http://127.0.0.1",
    "ws://127.0.0.1",
    "http://100.115.92.2",
    "ws://100.115.92.2",
    "http://www.w3.org",
    "https://react.dev",
    "https://github.com",
    // FormatJS embeds these documentation links in diagnostic strings.
    // The manifest's exact ARC-only connect-src remains the network boundary.
    "https://formatjs.github.io",
    // User-initiated product navigation links, not backend request origins.
    // CSP/connect permissions remain unchanged.
    "https://jstorrent.com",
    "https://chromewebstore.google.com",
  ]);
  const unexpectedHosts = [...new Set(remoteHosts.filter((url) => !allowedHosts.has(url)))];
  if (unexpectedHosts.length > 0) {
    fail(`companion application contains an unexpected remote URL: ${unexpectedHosts.join(", ")}`);
  }
  for (const forbidden of ["content://", "documentId", "tree_uri", "tree-uri"]) {
    if (source.includes(forbidden)) {
      fail(`companion application contains forbidden platform locator text: ${forbidden}`);
    }
  }
}

function listFiles(root, relative = "") {
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.posix.join(relative, entry.name);
      return entry.isDirectory() ? listFiles(root, child) : [child];
    })
    .sort();
}

export function validateArchive(archivePath, production = false) {
  const entries = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const expected = [...packagedFiles].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    fail(`archive entries differ from reviewed allowlist: ${entries.join(", ")}`);
  }
  const manifest = JSON.parse(execFileSync("unzip", ["-p", archivePath, "manifest.json"], { encoding: "utf8" }));
  if (JSON.stringify(manifest) !== JSON.stringify(validateSource(production))) {
    fail("archive manifest differs from the selected production/incubation identity");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const production = process.argv.includes("--production");
  validateSource(production);
  const archiveIndex = process.argv.indexOf("--archive");
  if (archiveIndex !== -1) {
    const archivePath = process.argv[archiveIndex + 1];
    if (!archivePath) {
      fail("--archive requires a path");
    }
    validateArchive(path.resolve(archivePath), production);
  }
  console.log("JSTorrent extension validation passed.");
}

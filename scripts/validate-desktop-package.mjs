#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function activationIdentity(product) {
  if (!["RSTorrent", "JSTorrent"].includes(product)) fail("unknown package product");
  const identifier = product === "JSTorrent" ? "com.jstorrent.desktop" : "com.jstorrent.rstorrent";
  return { IDENTIFIER: identifier, TORRENT_FILE_CLASS: `${identifier}.torrent` };
}
const TORRENT_MIME = "application/x-bittorrent";
const MAGNET_MIME = "x-scheme-handler/magnet";

function fail(message) {
  throw new Error(message);
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} is ${JSON.stringify(value)}`);
  }
}

export function validateMacInfo(info, product = "RSTorrent") {
  const { IDENTIFIER, TORRENT_FILE_CLASS } = activationIdentity(product);
  if (info.CFBundleIdentifier !== IDENTIFIER) {
    fail(`unexpected macOS bundle identifier ${info.CFBundleIdentifier}`);
  }
  if (info.CFBundleExecutable !== "jstorrent-client") {
    fail(`unexpected macOS executable ${info.CFBundleExecutable}`);
  }
  const urlType = info.CFBundleURLTypes?.find((candidate) =>
    candidate.CFBundleURLSchemes?.includes("magnet"),
  );
  if (!urlType) fail("macOS bundle does not register magnet");
  exactArray(urlType.CFBundleURLSchemes, ["magnet"], "macOS URL schemes");
  if (urlType.CFBundleURLName !== `${IDENTIFIER} magnet`) {
    fail(`unexpected macOS URL type name ${urlType.CFBundleURLName}`);
  }

  const documentType = info.CFBundleDocumentTypes?.find(
    (candidate) => candidate.CFBundleTypeName === TORRENT_FILE_CLASS,
  );
  if (!documentType) fail("macOS bundle does not declare the RSTorrent torrent type");
  exactArray(documentType.CFBundleTypeExtensions, ["torrent"], "macOS torrent extensions");
  exactArray(
    documentType.LSItemContentTypes,
    [TORRENT_FILE_CLASS],
    "macOS torrent content types",
  );
  if (documentType.CFBundleTypeRole !== "Editor") {
    fail(`unexpected macOS torrent role ${documentType.CFBundleTypeRole}`);
  }

  const exportedType = info.UTExportedTypeDeclarations?.find(
    (candidate) => candidate.UTTypeIdentifier === TORRENT_FILE_CLASS,
  );
  if (!exportedType) fail("macOS bundle does not export its torrent content type");
  if (!exportedType.UTTypeConformsTo?.includes("public.data")) {
    fail("macOS torrent content type does not conform to public.data");
  }
  if (exportedType.UTTypeTagSpecification?.["public.mime-type"] !== TORRENT_MIME) {
    fail("macOS torrent content type has the wrong MIME type");
  }
  exactArray(
    exportedType.UTTypeTagSpecification?.["public.filename-extension"],
    ["torrent"],
    "macOS exported torrent extensions",
  );
}

export function validateMacNativeHost(appPath) {
  const nativeHost = path.join(appPath, "Contents", "MacOS", "rstorrent-native-host");
  let metadata;
  try {
    metadata = fs.statSync(nativeHost);
  } catch {
    fail("macOS bundle does not contain rstorrent-native-host");
  }
  if (!metadata.isFile() || metadata.size === 0) {
    fail("macOS native host must be a nonempty file");
  }
  if ((metadata.mode & 0o111) === 0) {
    fail("macOS native host must be executable");
  }
  return nativeHost;
}

function desktopEntry(contents) {
  const entries = new Map();
  let inDesktopEntry = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inDesktopEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inDesktopEntry || line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) entries.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return entries;
}

export function validateLinuxDesktop(contents, product = "RSTorrent") {
  const { IDENTIFIER, TORRENT_FILE_CLASS } = activationIdentity(product);
  const entries = desktopEntry(contents);
  if (entries.get("Type") !== "Application") fail("Linux handler is not an application");
  if (entries.get("Terminal") !== "false") fail("Linux handler must not open a terminal");
  if (entries.get("Name") !== (product === "RSTorrent" ? "JSTorrent Preview" : product)) fail(`unexpected Linux handler name ${entries.get("Name")}`);
  const mimes = entries
    .get("MimeType")
    ?.split(";")
    .filter(Boolean);
  for (const required of [TORRENT_MIME, MAGNET_MIME]) {
    if (!mimes?.includes(required)) fail(`Linux handler is missing ${required}`);
  }
  const exec = entries.get("Exec") ?? "";
  const fieldCodes = exec.match(/%[uUfF]/g) ?? [];
  if (!exec.endsWith(" %U") || JSON.stringify(fieldCodes) !== JSON.stringify(["%U"])) {
    fail(`Linux handler must forward one URL/file list with %U: ${exec}`);
  }
  if (exec !== "jstorrent-client %U") {
    fail(`unexpected Linux installed executable ${exec}`);
  }
}

export function validateWindowsAssociations(registry, product = "RSTorrent") {
  const { IDENTIFIER, TORRENT_FILE_CLASS } = activationIdentity(product);
  if (!path.win32.isAbsolute(registry.executable ?? "")) {
    fail("Windows installed executable must be absolute");
  }
  if (path.win32.basename(registry.executable).toLowerCase() !== "jstorrent-client.exe") {
    fail(`unexpected Windows installed executable ${registry.executable}`);
  }
  if (registry.torrentProgId !== TORRENT_FILE_CLASS) {
    fail(`unexpected Windows torrent file class ${registry.torrentProgId}`);
  }
  const expectedCommand = `"${registry.executable}" "%1"`;
  if (registry.torrentCommand !== expectedCommand) {
    fail(`unexpected Windows torrent command ${registry.torrentCommand}`);
  }
  if (registry.magnetUrlProtocol !== "") {
    fail("Windows magnet URL Protocol marker is missing");
  }
  if (registry.magnetCommand !== expectedCommand) {
    fail(`unexpected Windows magnet command ${registry.magnetCommand}`);
  }
}

function usage() {
  fail(
    "usage: validate-desktop-package.mjs (--mac-app APP | --linux-desktop FILE | --windows-registry-json FILE)",
  );
}

function main(argv) {
  let product = "RSTorrent";
  if (argv.length === 4 && argv[2] === "--product") {
    product = argv[3]; argv = argv.slice(0, 2);
  }
  activationIdentity(product);
  if (argv.length !== 2) usage();
  const [mode, source] = argv;
  if (mode === "--mac-app") {
    const plist = path.join(source, "Contents", "Info.plist");
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plist], {
      encoding: "utf8",
    });
    validateMacInfo(JSON.parse(json), product);
    validateMacNativeHost(source);
    console.log(`Validated macOS activation metadata in ${path.basename(source)}`);
    return;
  }
  if (mode === "--linux-desktop") {
    validateLinuxDesktop(fs.readFileSync(source, "utf8"), product);
    console.log(`Validated Linux activation metadata in ${path.basename(source)}`);
    return;
  }
  if (mode === "--windows-registry-json") {
    validateWindowsAssociations(JSON.parse(fs.readFileSync(source, "utf8")), product);
    console.log("Validated installed Windows activation registry");
    return;
  }
  usage();
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Desktop package validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

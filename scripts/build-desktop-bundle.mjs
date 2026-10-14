#!/usr/bin/env node
// Lightweight local debug bundle, without installer or release packaging.
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("desktop-bundle requires macOS");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = path.join(root, "clients/desktop/src-tauri");
const base = JSON.parse(readFileSync(path.join(tauriRoot, "tauri.conf.json"), "utf8"));
const override = JSON.parse(process.env.TAURI_CONFIG || "{}");
if (!override || typeof override !== "object" || Array.isArray(override)) {
  throw new Error("TAURI_CONFIG must be a JSON object");
}
const config = { ...base, ...override };
if (typeof config.productName !== "string" || !config.productName ||
    /[\\/\x00-\x1f]/u.test(config.productName) || [".", ".."].includes(config.productName)) {
  throw new Error("productName must be a safe app bundle name");
}
if (typeof config.identifier !== "string" || !/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/u.test(config.identifier) ||
    config.identifier === "com.jstorrent.desktop") {
  throw new Error("desktop-bundle requires an isolated development identifier");
}
if (typeof config.version !== "string" || !config.version) throw new Error("version is required");
const bootstrap = path.join(os.homedir(), "Library/Application Support", config.identifier,
  "native-host/desktop-control-v1.sock");
if (Buffer.byteLength(bootstrap) > 103) {
  throw new Error("macOS bootstrap path is too long; use a shorter development identifier in TAURI_CONFIG");
}

function run(command, args, capture = false) {
  return execFileSync(command, args, {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: capture ? ["inherit", "pipe", "inherit"] : ["inherit", process.stderr, process.stderr],
  });
}
const metadata = JSON.parse(run("cargo", ["metadata", "--locked", "--no-deps", "--format-version=1"], true));
const bundleParent = path.join(metadata.target_directory, "desktop-bundle");
const app = path.join(bundleParent, `${config.productName}.app`);
const executable = path.join(app, "Contents/MacOS/jstorrent-client");
const marker = "Contents/Resources/development-bundle.json";
if (existsSync(app)) {
  if (lstatSync(app).isSymbolicLink() || !existsSync(path.join(app, marker))) {
    throw new Error(`refusing to replace an unrecognized bundle: ${app}`);
  }
  const previous = JSON.parse(readFileSync(path.join(app, marker), "utf8"));
  if (previous.schema !== "jstorrent-development-bundle/v1" || previous.repository !== root) {
    throw new Error(`refusing to replace a bundle owned by another checkout: ${app}`);
  }
}
function requireStopped(extraExecutable) {
  const commands = run("/bin/ps", ["-axo", "comm="], true).split("\n").map(value => value.trim());
  const raw = path.join(metadata.target_directory, "debug/jstorrent-client");
  if (commands.some(command => command === executable || command === raw ||
      (extraExecutable && command === extraExecutable))) {
    throw new Error("Quit the running development app before rebuilding its bundle");
  }
}
requireStopped();

const web = path.join(root, "clients/web");
const installedLock = path.join(web, "node_modules/.package-lock.json");
if (!existsSync(path.join(web, "node_modules/.bin/vite")) || !existsSync(installedLock) ||
    statSync(path.join(web, "package-lock.json")).mtimeMs > statSync(installedLock).mtimeMs) {
  run("npm", ["ci", "--prefix", web, "--no-audit", "--no-fund"]);
}
run("npm", ["run", "build", "--prefix", web]);
const output = run("cargo", ["build", "--locked", "-p", "rstorrent-desktop", "-p", "rstorrent-native-host",
  "--bins", "--message-format=json-render-diagnostics"], true);
const binaries = new Map();
for (const line of output.split("\n").filter(Boolean)) {
  const artifact = JSON.parse(line);
  if (artifact.reason === "compiler-artifact" && artifact.executable) {
    binaries.set(artifact.target.name, artifact.executable);
  }
}
for (const name of ["jstorrent-client", "rstorrent-native-host"]) {
  if (!binaries.has(name) || !run("/usr/bin/file", ["-b", binaries.get(name)], true).includes("Mach-O")) {
    throw new Error(`missing macOS debug executable: ${name}`);
  }
}
requireStopped(binaries.get("jstorrent-client"));

const strings = {
  CFBundleDevelopmentRegion: "English",
  CFBundleDisplayName: config.productName,
  CFBundleName: config.productName,
  CFBundleIdentifier: config.identifier,
  CFBundleExecutable: "jstorrent-client",
  CFBundleInfoDictionaryVersion: "6.0",
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: config.version,
  CFBundleVersion: config.version,
  CFBundleIconFile: "icon.icns",
  LSMinimumSystemVersion: override.bundle?.macOS?.minimumSystemVersion ?? base.bundle.macOS.minimumSystemVersion,
  NSLocalNetworkUsageDescription: "Find routers and connect to torrent peers on your local network.",
};
const escapeXml = value => String(value).replace(/[&<>"']/gu, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${Object.entries(strings).map(([key, value]) => `<key>${key}</key><string>${escapeXml(value)}</string>`).join("\n")}
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
mkdirSync(bundleParent, { recursive: true });
const staging = mkdtempSync(path.join(bundleParent, ".staging-"));
try {
  const staged = path.join(staging, `${config.productName}.app`);
  mkdirSync(path.join(staged, "Contents/MacOS"), { recursive: true });
  mkdirSync(path.join(staged, "Contents/Resources"));
  for (const [name, source] of binaries) {
    if (["jstorrent-client", "rstorrent-native-host"].includes(name)) {
      copyFileSync(source, path.join(staged, "Contents/MacOS", name));
    }
  }
  copyFileSync(path.join(tauriRoot, "icons/icon.icns"), path.join(staged, "Contents/Resources/icon.icns"));
  writeFileSync(path.join(staged, "Contents/Info.plist"), plist);
  writeFileSync(path.join(staged, marker), JSON.stringify({
    schema: "jstorrent-development-bundle/v1", repository: root, identifier: config.identifier,
  }, null, 2) + "\n");
  run("/usr/bin/plutil", ["-lint", path.join(staged, "Contents/Info.plist")]);
  run("/usr/bin/codesign", ["--force", "--sign", "-", staged]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
  requireStopped(binaries.get("jstorrent-client"));
  const previous = path.join(staging, "previous.app");
  if (existsSync(app)) renameSync(app, previous);
  try { renameSync(staged, app); }
  catch (error) {
    if (existsSync(previous)) renameSync(previous, app);
    throw error;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
// stdout is reserved for the shell launcher's executable path.
process.stdout.write(executable + "\n");

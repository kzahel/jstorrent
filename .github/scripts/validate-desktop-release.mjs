#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(message);
}

function requireAsset(assetNames, name) {
  if (!assetNames.has(name)) fail(`missing required release asset: ${name}`);
}

function requireMatchingAsset(assetNames, pattern, label) {
  const matches = [...assetNames].filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    fail(`expected exactly one ${label}, found ${matches.length}: ${matches.join(", ")}`);
  }
  return matches[0];
}

export function validateDesktopRelease({ release, latest, tag, repository }) {
  if (!/^desktop-(?:latest-)?v\d+\.\d+\.\d+$/.test(tag)) {
    fail(`unexpected desktop tag: ${tag}`);
  }
  const version = tag.slice(tag.lastIndexOf("-v") + 2);
  if (release.tagName !== tag) {
    fail(`release tag ${release.tagName} does not match ${tag}`);
  }
  if (!release.isDraft) fail("release must remain a draft until validation succeeds");
  if (release.isPrerelease !== tag.startsWith("desktop-latest-v")) {
    fail("release prerelease kind does not match its update channel");
  }
  if (!Array.isArray(release.assets)) fail("release assets are missing");

  const assetNames = new Set();
  for (const asset of release.assets) {
    if (!asset.name || assetNames.has(asset.name)) {
      fail(`missing or duplicate release asset name: ${asset.name ?? "<empty>"}`);
    }
    assetNames.add(asset.name);
    if (!/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? "")) {
      fail(`release asset ${asset.name} is missing a GitHub SHA-256 digest`);
    }
  }
  requireAsset(assetNames, "latest.json");
  const production = [...assetNames].some(name => /^JSTorrent_[0-9]/.test(name));
  if (production && [...assetNames].some(name => /\.(?:deb|rpm)(?:\.sig)?$/.test(name))) {
    fail("production Linux release excludes DEB/RPM assets");
  }

  for (const [pattern, label] of [
    [/_\d+\.\d+\.\d+_aarch64\.dmg$/, "macOS Apple-silicon DMG"],
    [/_\d+\.\d+\.\d+_x64\.dmg$/, "macOS Intel DMG"],
    [/_\d+\.\d+\.\d+_x64-setup\.exe$/, "Windows NSIS installer"],
    [/_\d+\.\d+\.\d+_x64(?:_en-US)?\.msi$/, "Windows MSI installer"],
    [/_\d+\.\d+\.\d+_amd64\.AppImage$/, "Linux x86_64 AppImage"],
    [/_\d+\.\d+\.\d+_amd64\.deb$/, "Linux x86_64 DEB"],
    [/-\d+\.\d+\.\d+-1\.x86_64\.rpm$/, "Linux x86_64 RPM"],
    [/_\d+\.\d+\.\d+_aarch64\.AppImage$/, "Linux ARM64 AppImage"],
    [/_\d+\.\d+\.\d+_arm64\.deb$/, "Linux ARM64 DEB"],
    [/-\d+\.\d+\.\d+-1\.aarch64\.rpm$/, "Linux ARM64 RPM"],
  ]) {
    if (production && /DEB|RPM/.test(label)) continue;
    requireMatchingAsset(assetNames, pattern, label);
  }

  if (latest.version !== version) {
    fail(`latest.json version ${latest.version} does not match ${version}`);
  }
  if (!latest.platforms || typeof latest.platforms !== "object") {
    fail("latest.json platforms are missing");
  }
  const requiredPlatforms = {
    "darwin-aarch64": ".app.tar.gz",
    "darwin-aarch64-app": ".app.tar.gz",
    "darwin-x86_64": ".app.tar.gz",
    "darwin-x86_64-app": ".app.tar.gz",
    "linux-aarch64": ".AppImage",
    "linux-aarch64-appimage": ".AppImage",
    "linux-aarch64-deb": ".deb",
    "linux-aarch64-rpm": ".rpm",
    "linux-x86_64": ".AppImage",
    "linux-x86_64-appimage": ".AppImage",
    "linux-x86_64-deb": ".deb",
    "linux-x86_64-rpm": ".rpm",
    "windows-x86_64": "-setup.exe",
    "windows-x86_64-nsis": "-setup.exe",
    "windows-x86_64-msi": ".msi",
  };
  if (production) {
    for (const key of Object.keys(requiredPlatforms)) {
      if (/^linux-.*-(?:deb|rpm)$/.test(key)) delete requiredPlatforms[key];
    }
  }
  if (JSON.stringify(Object.keys(latest.platforms).sort()) !== JSON.stringify(Object.keys(requiredPlatforms).sort())) {
    fail(`latest.json must contain exactly the ${Object.keys(requiredPlatforms).length} desktop updater keys`);
  }
  const expectedUrlPrefix =
    `https://github.com/${repository}/releases/download/${tag}/`;
  for (const [platform, expectedSuffix] of Object.entries(requiredPlatforms)) {
    const metadata = latest.platforms[platform];
    if (!metadata) fail(`latest.json is missing platform ${platform}`);
    if (typeof metadata.signature !== "string" || metadata.signature.length < 32) {
      fail(`latest.json platform ${platform} has no usable signature`);
    }
    if (
      typeof metadata.url !== "string" ||
      !metadata.url.startsWith(expectedUrlPrefix)
    ) {
      fail(`latest.json platform ${platform} has an unexpected URL: ${metadata.url}`);
    }
    const assetName = decodeURIComponent(metadata.url.slice(expectedUrlPrefix.length));
    requireAsset(assetNames, assetName);
    requireAsset(assetNames, `${assetName}.sig`);
    if (!assetName.endsWith(expectedSuffix)) {
      fail(`updater for ${platform} must use ${expectedSuffix}: ${assetName}`);
    }
  }
  for (const [defaultKey, packageKey] of [
    ["darwin-aarch64", "darwin-aarch64-app"],
    ["darwin-x86_64", "darwin-x86_64-app"],
    ["linux-aarch64", "linux-aarch64-appimage"],
    ["linux-x86_64", "linux-x86_64-appimage"],
    ["windows-x86_64", "windows-x86_64-nsis"],
  ]) {
    if (JSON.stringify(latest.platforms[defaultKey]) !== JSON.stringify(latest.platforms[packageKey])) {
      fail(`default and package-specific updater entries disagree: ${defaultKey}`);
    }
  }
  return { version, platforms: Object.keys(requiredPlatforms) };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      fail(`invalid argument near ${name ?? "<end>"}`);
    }
    result[name.slice(2)] = value;
  }
  for (const name of ["release", "latest", "tag", "repository"]) {
    if (!result[name]) fail(`missing --${name}`);
  }
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = validateDesktopRelease({
      release: readJson(args.release),
      latest: readJson(args.latest),
      tag: args.tag,
      repository: args.repository,
    });
    console.log(`Validated complete desktop release ${result.version}`);
  } catch (error) {
    console.error(`Desktop release validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

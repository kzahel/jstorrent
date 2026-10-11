#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

export const MANIFEST_NAME = "rstorrent-headless-release.manifest";
export const SIGNATURE_NAME = "rstorrent-headless-release.manifest.minisig";
export const INSTALL_PROTOCOL_VERSION = 1;
// Signed v1 protocol identity; not a mutable GitHub transport URL.
export const REPOSITORY = "kzahel/rstorrent";
export const RUNTIME = "linux-gnu-headless-package";

const ARCHITECTURES = ["x86_64", "aarch64"];
const MAX_ASSET_BYTES = 128 * 1024 * 1024;

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    throw new Error(`invalid final headless version: ${version}`);
  }
}

function validateCommit(commit) {
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error(`invalid source commit: ${commit}`);
  }
}

function describeAsset(filePath, arch, version) {
  const expectedName = `rstorrent-headless-${version}-linux-${arch}.tar.gz`;
  if (basename(filePath) !== expectedName) {
    throw new Error(`${arch} asset must be named ${expectedName}`);
  }
  const size = statSync(filePath).size;
  if (size <= 0 || size > MAX_ASSET_BYTES) {
    throw new Error(`${expectedName} has invalid size ${size}`);
  }
  return { name: expectedName, sha256: sha256(filePath), size };
}

export function createHeadlessReleaseManifest({
  version,
  sourceCommit,
  x86_64Path,
  aarch64Path,
}) {
  validateVersion(version);
  validateCommit(sourceCommit);
  const assets = {
    x86_64: describeAsset(x86_64Path, "x86_64", version),
    aarch64: describeAsset(aarch64Path, "aarch64", version),
  };
  const lines = [
    "rstorrent-headless-release-v1",
    `version=${version}`,
    `tag=headless-v${version}`,
    `repository=${REPOSITORY}`,
    `source_commit=${sourceCommit}`,
    `install_protocol=${INSTALL_PROTOCOL_VERSION}`,
    `runtime=${RUNTIME}`,
  ];
  for (const arch of ARCHITECTURES) {
    const asset = assets[arch];
    lines.push(`${arch}_asset=${asset.name}`);
    lines.push(`${arch}_sha256=${asset.sha256}`);
    lines.push(`${arch}_size=${asset.size}`);
  }
  lines.push(`manifest_asset=${MANIFEST_NAME}`);
  lines.push(`signature_asset=${SIGNATURE_NAME}`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const [version, sourceCommit, x86_64Path, aarch64Path, outputPath] =
    process.argv.slice(2);
  if (
    !version ||
    !sourceCommit ||
    !x86_64Path ||
    !aarch64Path ||
    !outputPath ||
    process.argv.length !== 7
  ) {
    throw new Error(
      "usage: write-headless-release-manifest.mjs <version> <commit> <x86_64-package> <aarch64-package> <output>",
    );
  }
  writeFileSync(
    outputPath,
    createHeadlessReleaseManifest({
      version,
      sourceCommit,
      x86_64Path,
      aarch64Path,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

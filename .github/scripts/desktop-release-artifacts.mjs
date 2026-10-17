#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync, lstatSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const SHA = /^[0-9a-f]{64}$/;
const SOURCE_SHA = /^[0-9a-f]{40}$/;

function fail(message) {
  throw new Error(message);
}

function requireValue(value, pattern, label) {
  if (!pattern.test(value ?? "")) fail(`invalid ${label}: ${value ?? "<missing>"}`);
  return value;
}

function laneFiles(lane, version, product = "RSTorrent") {
  if (!["RSTorrent", "JSTorrent"].includes(product)) fail("unknown release product");
  product = product === "RSTorrent" ? "JSTorrent Preview" : product;
  const mac = (arch, target) => [
    [`target/${target}/release/bundle/dmg/${product}_${version}_${arch}.dmg`, `${product}_${version}_${arch}.dmg`, false],
    [`target/${target}/release/bundle/macos/${product}.app.tar.gz`, `${product}_${arch}.app.tar.gz`, true],
  ];
  const linux = (appArch, debArch, rpmArch) => [
    [`target/release/bundle/appimage/${product}_${version}_${appArch}.AppImage`, `${product}_${version}_${appArch}.AppImage`, true],
    ...(product === "JSTorrent" ? [] : [
    [`target/release/bundle/deb/${product}_${version}_${debArch}.deb`, `${product}_${version}_${debArch}.deb`, true],
    [`target/release/bundle/rpm/${product}-${version}-1.${rpmArch}.rpm`, `${product}-${version}-1.${rpmArch}.rpm`, true],
    ]),
  ];
  const windows = [
    [`target/release/bundle/nsis/${product}_${version}_x64-setup.exe`, `${product}_${version}_x64-setup.exe`, true],
    [`target/release/bundle/msi/${product}_${version}_x64_en-US.msi`, `${product}_${version}_x64_en-US.msi`, true],
  ];
  const definitions = {
    "macos-aarch64": mac("aarch64", "aarch64-apple-darwin"),
    "macos-x86_64": mac("x64", "x86_64-apple-darwin"),
    "linux-aarch64": linux("aarch64", "arm64", "aarch64"),
    "linux-x86_64": linux("amd64", "amd64", "x86_64"),
    "windows-x86_64": windows,
  };
  const packages = definitions[lane];
  if (!packages) fail(`unknown desktop release lane: ${lane}`);
  return packages.flatMap(([source, name, signed]) =>
    signed ? [{ source, name }, { source: `${source}.sig`, name: `${name}.sig` }] : [{ source, name }],
  );
}

export const RELEASE_LANES = [
  "macos-aarch64",
  "macos-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-x86_64",
];

function exactNames(directory, expected) {
  const actual = readdirSync(directory).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`unexpected files in ${directory}: ${actual.join(", ")}; expected ${wanted.join(", ")}`);
  }
}

function checkedFile(file, maxBytes = MAX_FILE_BYTES) {
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") fail(`missing release file: ${file}`);
    throw error;
  }
  if (!info.isFile() || info.size === 0 || info.size > maxBytes) {
    fail(`invalid release file ${file} (${info.size} bytes)`);
  }
  return info.size;
}

async function digestFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

function signature(file) {
  checkedFile(file, 8192);
  const value = readFileSync(file, "utf8");
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value) ||
      !Buffer.from(value, "base64").toString("utf8").startsWith("untrusted comment:")) {
    fail(`invalid Tauri updater signature: ${file}`);
  }
  return value;
}

function emptyOutput(directory) {
  if (existsSync(directory) && readdirSync(directory).length !== 0) {
    fail(`release output is not empty: ${directory}`);
  }
  mkdirSync(directory, { recursive: true });
}

export async function stageDesktopReleaseLeg({ root, lane, sourceSha, runId, attempt, expectedVersion, output, product = "RSTorrent" }) {
  requireValue(sourceSha, SOURCE_SHA, "source SHA");
  requireValue(runId, /^\d+$/, "run ID");
  requireValue(attempt, /^\d+$/, "run attempt");
  const version = JSON.parse(readFileSync(join(root, "clients/desktop/src-tauri/tauri.conf.json"), "utf8")).version;
  requireValue(version, /^\d+\.\d+\.\d+$/, "package version");
  if (expectedVersion && version !== expectedVersion) fail(`package version ${version} does not match ${expectedVersion}`);
  const files = laneFiles(lane, version, product);
  emptyOutput(output);
  const assets = [];
  for (const file of files) {
    const source = join(root, file.source);
    checkedFile(source, file.name.endsWith(".sig") ? 8192 : MAX_FILE_BYTES);
    if (file.name.endsWith(".sig")) signature(source);
    const destination = join(output, file.name);
    copyFileSync(source, destination);
    assets.push({ name: file.name, size: checkedFile(destination), sha256: await digestFile(destination) });
  }
  const metadata = { product, lane, version, sourceSha, runId, attempt, assets };
  const privateReceipt = join(root, "distribution/private-update-qualification.json");
  if (existsSync(privateReceipt)) {
    checkedFile(privateReceipt, MAX_METADATA_BYTES);
    metadata.privateQualification = JSON.parse(readFileSync(privateReceipt, "utf8"));
  }
  writeFileSync(join(output, "meta.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

function releaseNotes({ root, channel, version, publish, product }) {
  if (!publish) return `Signed ${product === "RSTorrent" ? "JSTorrent Preview" : product} desktop release rehearsal.`;
  if (channel === "latest") return "Signed Latest build from verified main source.";
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const marker = `## [${version}]`;
  const start = changelog.indexOf(marker);
  if (start < 0 || (start > 0 && changelog[start - 1] !== "\n")) fail(`missing changelog section ${marker}`);
  const bodyStart = start + marker.length;
  const next = changelog.indexOf("\n## [", bodyStart);
  const notes = changelog.slice(bodyStart, next < 0 ? undefined : next).trim();
  if (!notes || notes.length > MAX_METADATA_BYTES) fail(`empty or oversized release notes for ${version}`);
  return notes;
}

function updaterPlatforms(version, tag, repository, assetDirectory, product) {
  product = product === "RSTorrent" ? "JSTorrent Preview" : product;
  const prefix = `https://github.com/${repository}/releases/download/${tag}/`;
  const platforms = {};
  function add(keys, name) {
    const sig = signature(join(assetDirectory, `${name}.sig`));
    for (const key of keys) platforms[key] = { signature: sig, url: `${prefix}${name}` };
  }
  add(["darwin-aarch64", "darwin-aarch64-app"], `${product}_aarch64.app.tar.gz`);
  add(["darwin-x86_64", "darwin-x86_64-app"], `${product}_x64.app.tar.gz`);
  add(["linux-aarch64", "linux-aarch64-appimage"], `${product}_${version}_aarch64.AppImage`);
  if (product !== "JSTorrent") {
    add(["linux-aarch64-deb"], `${product}_${version}_arm64.deb`);
    add(["linux-aarch64-rpm"], `${product}-${version}-1.aarch64.rpm`);
  }
  add(["linux-x86_64", "linux-x86_64-appimage"], `${product}_${version}_amd64.AppImage`);
  if (product !== "JSTorrent") {
    add(["linux-x86_64-deb"], `${product}_${version}_amd64.deb`);
    add(["linux-x86_64-rpm"], `${product}-${version}-1.x86_64.rpm`);
  }
  add(["windows-x86_64", "windows-x86_64-nsis"], `${product}_${version}_x64-setup.exe`);
  add(["windows-x86_64-msi"], `${product}_${version}_x64_en-US.msi`);
  return platforms;
}

export async function assembleDesktopRelease({ root, input, output, sourceSha, runId, attempt, repository, channel, version, tag, now = new Date(), product = "RSTorrent", productionPublication = false }) {
  requireValue(sourceSha, SOURCE_SHA, "source SHA");
  requireValue(runId, /^\d+$/, "run ID");
  requireValue(attempt, /^\d+$/, "run attempt");
  requireValue(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repository");
  if (!["stable", "latest"].includes(channel)) fail(`invalid channel: ${channel}`);
  if (!["RSTorrent", "JSTorrent"].includes(product)) fail("unknown release product");
  if (productionPublication && (product !== "JSTorrent" || !["stable", "latest"].includes(channel) || !tag)) {
    fail("Production publication requires a tagged JSTorrent release");
  }
  if (product === "JSTorrent" && tag && productionPublication !== true) fail("JSTorrent candidate publication is not enabled");
  const publish = Boolean(tag);
  const metadataDirs = readdirSync(input, { withFileTypes: true });
  if (metadataDirs.length !== RELEASE_LANES.length || metadataDirs.some((entry) => !entry.isDirectory())) {
    fail(`expected exactly ${RELEASE_LANES.length} release leg artifacts`);
  }
  const legs = new Map();
  for (const directory of metadataDirs) {
    const legPath = join(input, directory.name);
    checkedFile(join(legPath, "meta.json"), MAX_METADATA_BYTES);
    const meta = JSON.parse(readFileSync(join(legPath, "meta.json"), "utf8"));
    if (meta.product !== product) fail("mixed release products");
    if (meta.privateQualification && publish) fail("Private schema qualification packages cannot be published");
    if (!RELEASE_LANES.includes(meta.lane) || legs.has(meta.lane)) fail(`duplicate or unknown release lane: ${meta.lane}`);
    if (meta.sourceSha !== sourceSha || meta.runId !== runId || meta.attempt !== attempt) {
      fail(`stale release leg: ${meta.lane}`);
    }
    requireValue(meta.version, /^\d+\.\d+\.\d+$/, "leg version");
    if (version && meta.version !== version) fail(`release leg version mismatch: ${meta.lane}`);
    const expectedFiles = laneFiles(meta.lane, meta.version, product).map((file) => file.name);
    exactNames(legPath, ["meta.json", ...expectedFiles]);
    if (!Array.isArray(meta.assets) ||
        JSON.stringify(meta.assets.map((asset) => asset.name).sort()) !== JSON.stringify([...expectedFiles].sort())) {
      fail(`release leg asset inventory mismatch: ${meta.lane}`);
    }
    for (const asset of meta.assets) {
      const file = join(legPath, asset.name);
      if (checkedFile(file, asset.name.endsWith(".sig") ? 8192 : MAX_FILE_BYTES) !== asset.size ||
          !SHA.test(asset.sha256) || await digestFile(file) !== asset.sha256) {
        fail(`release leg digest mismatch: ${meta.lane}/${asset.name}`);
      }
      if (asset.name.endsWith(".sig")) signature(file);
    }
    legs.set(meta.lane, { meta, directory: legPath });
  }
  const qualificationReceipts = [...legs.values()].map(leg => JSON.stringify(leg.meta.privateQualification ?? null));
  if (new Set(qualificationReceipts).size !== 1) fail("Mixed private qualification source receipts");
  const releaseVersion = version || legs.get(RELEASE_LANES[0])?.meta.version;
  requireValue(releaseVersion, /^\d+\.\d+\.\d+$/, "release version");
  if ([...legs.values()].some((leg) => leg.meta.version !== releaseVersion)) fail("release leg versions differ");
  const releaseTag = tag || `desktop-v${releaseVersion}`;
  const expectedTag = `${channel === "latest" ? "desktop-latest-v" : "desktop-v"}${releaseVersion}`;
  if (publish && releaseTag !== expectedTag) fail(`release tag ${releaseTag} does not match ${expectedTag}`);
  emptyOutput(output);
  const assetsDir = join(output, "assets");
  mkdirSync(assetsDir);
  const assets = [];
  for (const lane of RELEASE_LANES) {
    const leg = legs.get(lane);
    if (!leg) fail(`missing release lane: ${lane}`);
    for (const asset of leg.meta.assets) {
      const destination = join(assetsDir, asset.name);
      if (existsSync(destination)) fail(`duplicate release asset: ${asset.name}`);
      copyFileSync(join(leg.directory, asset.name), destination);
      const digest = await digestFile(destination);
      if (digest !== asset.sha256) fail(`copied release asset changed: ${asset.name}`);
      assets.push({ name: asset.name, size: asset.size, digest: `sha256:${digest}` });
    }
  }
  const notes = releaseNotes({ root, channel, version: releaseVersion, publish, product });
  const latest = { version: releaseVersion, notes, pub_date: now.toISOString(), platforms: updaterPlatforms(releaseVersion, releaseTag, repository, assetsDir, product) };
  const latestPath = join(assetsDir, "latest.json");
  writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  assets.push({ name: "latest.json", size: statSync(latestPath).size, digest: `sha256:${await digestFile(latestPath)}` });
  const release = { tagName: releaseTag, isDraft: true, isPrerelease: channel === "latest" && publish, assets };
  writeFileSync(join(output, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  writeFileSync(join(output, "notes.md"), `${notes}\n`);
  return { release, latest };
}

export function verifyUploadedAssets(local, remote) {
  if (local.tagName !== remote.tagName || remote.isDraft !== true || local.isPrerelease !== remote.isPrerelease) {
    fail("uploaded release identity or draft state mismatch");
  }
  const expected = new Map(local.assets.map((asset) => [asset.name, asset]));
  if (remote.assets.length !== expected.size) fail("uploaded release asset count mismatch");
  for (const asset of remote.assets) {
    const original = expected.get(asset.name);
    if (!original || original.digest !== asset.digest || original.size !== asset.size) {
      fail(`uploaded asset differs from assembled bytes: ${asset.name}`);
    }
    expected.delete(asset.name);
  }
  if (expected.size) fail(`missing uploaded release assets: ${[...expected.keys()].join(", ")}`);
}

export async function verifyProductionFinalDraft({ local, remote, checksumPath, sourcePath }) {
  const match = /^desktop-v(\d+\.\d+\.\d+)$/.exec(local.tagName ?? "");
  if (!match || local.isPrerelease !== false || local.isDraft !== true) {
    fail("final production draft requires a Stable candidate");
  }
  const expected = RELEASE_LANES.flatMap(lane => laneFiles(lane, match[1], "JSTorrent").map(asset => asset.name));
  expected.push("latest.json");
  if (!Array.isArray(local.assets) ||
      JSON.stringify(local.assets.map(asset => asset.name).sort()) !== JSON.stringify(expected.sort())) {
    fail(`final production draft requires exactly ${expected.length} JSTorrent core assets`);
  }
  const checksum = { name: "SHA256SUMS", size: checkedFile(checksumPath, MAX_METADATA_BYTES),
    digest: `sha256:${await digestFile(checksumPath)}` };
  const extra = [];
  if (sourcePath !== undefined) {
    const name = `JSTorrent_${match[1]}_AppImage-sources-final.tar.gz`;
    if (basename(sourcePath) !== name) fail("production source asset version/name mismatch");
    extra.push({ name, size: checkedFile(sourcePath, 2 * 1024 * 1024 * 1024),
      digest: `sha256:${await digestFile(sourcePath)}` });
    const inventory = [...local.assets, ...extra].filter(asset => !asset.name.endsWith(".sig"))
      .map(asset => `${asset.digest.slice(7)}  ${asset.name}`).sort().join("\n") + "\n";
    if (readFileSync(checksumPath, "utf8") !== inventory) {
      fail("production checksum inventory does not bind exact core and source bytes");
    }
  }
  verifyUploadedAssets({ ...local, assets: [...local.assets, ...extra, checksum] }, remote);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) fail(`invalid argument: ${key ?? "<end>"}`);
    options[key.slice(2)] = argv[index + 1];
  }
  return options;
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  const args = parseArgs(arguments_);
  if (command === "stage") {
    const result = await stageDesktopReleaseLeg({
      root: process.cwd(), lane: args.lane, sourceSha: args["source-sha"],
      runId: args["run-id"], attempt: args.attempt,
      expectedVersion: args.version, output: resolve(args.output), product: args.product,
    });
    console.log(`Staged ${result.lane} ${result.version}: ${result.assets.length} files`);
  } else if (command === "assemble") {
    const result = await assembleDesktopRelease({
      root: process.cwd(), input: resolve(args.input), output: resolve(args.output),
      sourceSha: args["source-sha"], runId: args["run-id"], attempt: args.attempt,
      repository: args.repository, channel: args.channel, version: args.version, tag: args.tag, product: args.product,
      productionPublication: args["production-publication"] === "true",
    });
    console.log(`Assembled ${result.release.tagName}: ${result.release.assets.length} assets, ${Object.keys(result.latest.platforms).length} updater keys`);
  } else if (command === "verify-upload") {
    const local = JSON.parse(readFileSync(resolve(args.local), "utf8"));
    const remote = JSON.parse(readFileSync(resolve(args.remote), "utf8"));
    verifyUploadedAssets(local, remote);
    console.log(`Verified ${local.assets.length} uploaded release assets`);
  } else if (command === "verify-production-draft") {
    await verifyProductionFinalDraft({
      local: JSON.parse(readFileSync(resolve(args.local), "utf8")),
      remote: JSON.parse(readFileSync(resolve(args.remote), "utf8")),
      checksumPath: resolve(args.checksums),
      sourcePath: args.sources ? resolve(args.sources) : undefined,
    });
    console.log(`Verified 15 production core assets${args.sources ? ", AppImage sources" : ""} and SHA256SUMS in the complete private draft`);
  } else {
    fail(`unknown desktop release artifact command: ${command}`);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Desktop release artifact validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

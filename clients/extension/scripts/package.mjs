import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  companionPackagedFiles,
  extensionRoot,
  packagedFiles,
  productionExtensionId,
  validateArchive,
  validateCompanionBuild,
  validateSource,
} from "./validate.mjs";

const production = process.argv.includes("--production");
const manifest = validateSource(production);
const webRoot = path.resolve(extensionRoot, "../web");
execFileSync("npm", ["run", "build:companion"], {
  cwd: webRoot,
  env: process.env,
  stdio: "inherit",
});
const companionRoot = path.join(webRoot, "dist/companion");
validateCompanionBuild(companionRoot);

const outputDirectory = path.resolve(extensionRoot, "../../target/extension");
const outputPath = path.join(outputDirectory, `${production ? "jstorrent" : "jstorrent-beta"}-${manifest.version}.zip`);
const staging = mkdtempSync(path.join(os.tmpdir(), "jstorrent-beta-extension-"));
const fixedTime = new Date("2020-01-01T00:00:00.000Z");

try {
  for (const relativePath of packagedFiles) {
    const destination = path.join(staging, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    const source = companionPackagedFiles.includes(relativePath)
      ? path.join(companionRoot, relativePath.replace(/^companion\//u, ""))
      : path.join(extensionRoot, relativePath);
    if (relativePath === "manifest.json") writeFileSync(destination, JSON.stringify(manifest, null, 2) + "\n");
    else copyFileSync(source, destination);
    chmodSync(destination, 0o644);
    utimesSync(destination, fixedTime, fixedTime);
  }
  mkdirSync(outputDirectory, { recursive: true });
  rmSync(outputPath, { force: true });
  execFileSync("zip", ["-X", "-q", outputPath, ...packagedFiles], {
    cwd: staging,
    env: { ...process.env, TZ: "UTC" },
    stdio: "inherit",
  });
  validateArchive(outputPath, production);
  if (production) {
    // The record scripts/publish-store.mjs verifies before any store upload.
    const git = (...args) =>
      execFileSync("git", args, { cwd: extensionRoot, encoding: "utf8" }).trim();
    const filename = path.basename(outputPath);
    const sha256 = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
    const build = {
      version: manifest.version,
      filename,
      sha256,
      extensionId: productionExtensionId,
      revision: git("rev-parse", "HEAD"),
      sourceDirty: git("status", "--porcelain") !== "",
    };
    writeFileSync(path.join(outputDirectory, "build.json"), `${JSON.stringify(build, null, 2)}\n`);
    writeFileSync(`${outputPath}.sha256`, `${sha256}  ${filename}\n`);
  }
  console.log(outputPath);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

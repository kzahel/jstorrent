import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function applyNightlyVersion(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Numeric desktop package version required");
  for (const name of ["clients/web/package.json", "clients/desktop/src-tauri/tauri.conf.json"]) {
    const path = resolve(root, name);
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.version = version;
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  const lockPath = resolve(root, "clients/web/package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.version = version;
  lock.packages[""].version = version;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const cargoPath = resolve(root, "clients/desktop/src-tauri/Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf8");
  writeFileSync(cargoPath, cargo.replace(/^(version = )"[^"]+"/m, `$1"${version}"`));
  const cargoLockPath = resolve(root, "Cargo.lock");
  const cargoLock = readFileSync(cargoLockPath, "utf8").replace(/\r\n/g, "\n");
  writeFileSync(cargoLockPath, cargoLock.replace(/(name = "rstorrent-desktop"\nversion = )"[^"]+"/, `$1"${version}"`));
  const changelogPath = resolve(root, "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");
  if (!changelog.includes(`## [${version}]`)) {
    writeFileSync(changelogPath, `# Changelog\n\n## [${version}]\n\n- Signed Latest desktop build from verified main source.\n\n${changelog.replace(/^# Changelog\s*/, "")}`);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  applyNightlyVersion(root, process.argv[2]);
}

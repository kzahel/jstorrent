#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const formatjs = path.join(root, "node_modules/.bin/formatjs");
for (const locale of ["en", "de"]) {
  const source = path.join(root, `src/localization/messages/${locale}.json`);
  if (!fs.existsSync(source)) {
    if (locale === "en") throw new Error("English source catalog is missing");
    continue;
  }
  execFileSync(formatjs, ["compile", source, "--ast", "--out-file", path.join(root, `src/localization/generated/${locale}.json`)], { stdio: "inherit" });
}

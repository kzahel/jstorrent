import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(new URL("../workflows/desktop-release.yml", import.meta.url), "utf8");
function shellFor(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert(start >= 0);
  const end = workflow.indexOf("\n      - name:", start + 1);
  const step = workflow.slice(start, end < 0 ? undefined : end);
  const block = /        run: \|\n([\s\S]*)$/u.exec(step);
  assert(block, "selected publication step must have a shell body");
  return block[1].split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

test("actual publication shells refuse a moved production tag before any GitHub write", () => {
  const root = mkdtempSync(join(tmpdir(), "jstorrent-publisher-guard-"));
  const bin = join(root, "bin");mkdirSync(bin);
  const marker = join(root, "github-write.json");
  try {
    writeFileSync(join(bin, "git"), `#!${process.execPath}\nif(process.argv[2]==='fetch')process.exit(0);if(process.argv[2]==='rev-parse'){process.stdout.write(process.env.TAG_COMMIT_FIXTURE+'\\n');process.exit(0)}process.exit(2);\n`, { mode:0o700 });
    writeFileSync(join(bin, "gh"), `#!${process.execPath}\nif(process.argv[2]==='release'&&process.argv[3]==='view')process.exit(1);require('node:fs').writeFileSync(process.env.WRITE_MARKER,JSON.stringify(process.argv.slice(2)));\n`, { mode:0o700 });
    // Exported personal shell functions must not override the fake commands.
    // This test has no account tokens, shell startup files or network tools.
    const environment = { PATH:bin+':/usr/bin:/bin', LANG:"C", WRITE_MARKER:marker,
      PRODUCTION_PUBLICATION:"true", SOURCE_SHA:"a".repeat(40), RELEASE_TAG:"desktop-v0.3.0",
      RELEASE_VERSION:"0.3.0", RELEASE_CHANNEL:"stable", PACKAGE_DISPLAY_NAME:"JSTorrent" };
    for (const name of ["Create private tagged draft", "Publish validated release"]) {
      const body = shellFor(name);
      assert.throws(() => execFileSync("/bin/bash", ["-e", "-c", body], { cwd:root, env:{ ...environment, TAG_COMMIT_FIXTURE:"b".repeat(40) }, stdio:"pipe", timeout:5000 }), /Command failed/u);
      assert.equal(existsSync(marker), false, name + " must refuse before writing");
      execFileSync("/bin/bash", ["-e", "-c", body], { cwd:root, env:{ ...environment, TAG_COMMIT_FIXTURE:environment.SOURCE_SHA }, stdio:"pipe", timeout:5000 });
      const called = JSON.parse(readFileSync(marker, "utf8"));
      assert(called.includes(environment.RELEASE_TAG));
      if (name === "Create private tagged draft") assert(called.includes("JSTorrent Desktop v0.3.0"));
      rmSync(marker);
    }
  } finally { rmSync(root, { recursive:true, force:true }); }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  RELEASE_LANES,
  assembleDesktopRelease,
  stageDesktopReleaseLeg,
  verifyUploadedAssets,
  verifyProductionFinalDraft,
} from "./desktop-release-artifacts.mjs";
import { validateDesktopRelease } from "./validate-desktop-release.mjs";

const version = "1.2.3";
const sourceSha = "a".repeat(40);
const runId = "77";
const attempt = "1";
const repository = "kzahel/jstorrent";
const signature = Buffer.from("untrusted comment: fixture signature\nfixture\n").toString("base64");

function fixture(product = "RSTorrent") {
  const root = mkdtempSync(join(tmpdir(), "rstorrent-parallel-release-"));
  const input = join(root, "input");
  const output = join(root, "output");
  mkdirSync(input);
  const config = join(root, "clients/desktop/src-tauri/tauri.conf.json");
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, JSON.stringify({ version }));
  writeFileSync(join(root, "CHANGELOG.md"), `# Changelog\n\n## [${version}]\n\n- Fixed test release.\n\n## [1.2.2]\n\n- Older.\n`);
  const packages = {
    "macos-aarch64": [
      [`target/aarch64-apple-darwin/release/bundle/dmg/JSTorrent Preview_${version}_aarch64.dmg`, false],
      ["target/aarch64-apple-darwin/release/bundle/macos/JSTorrent Preview.app.tar.gz", true],
    ],
    "macos-x86_64": [
      [`target/x86_64-apple-darwin/release/bundle/dmg/JSTorrent Preview_${version}_x64.dmg`, false],
      ["target/x86_64-apple-darwin/release/bundle/macos/JSTorrent Preview.app.tar.gz", true],
    ],
    "linux-aarch64": [
      [`target/release/bundle/appimage/JSTorrent Preview_${version}_aarch64.AppImage`, true],
      [`target/release/bundle/deb/JSTorrent Preview_${version}_arm64.deb`, true],
      [`target/release/bundle/rpm/JSTorrent Preview-${version}-1.aarch64.rpm`, true],
    ],
    "linux-x86_64": [
      [`target/release/bundle/appimage/JSTorrent Preview_${version}_amd64.AppImage`, true],
      [`target/release/bundle/deb/JSTorrent Preview_${version}_amd64.deb`, true],
      [`target/release/bundle/rpm/JSTorrent Preview-${version}-1.x86_64.rpm`, true],
    ],
    "windows-x86_64": [
      [`target/release/bundle/nsis/JSTorrent Preview_${version}_x64-setup.exe`, true],
      [`target/release/bundle/msi/JSTorrent Preview_${version}_x64_en-US.msi`, true],
    ],
  };
  async function stage() {
    for (const lane of RELEASE_LANES) {
      for (const [originalPath, signed] of packages[lane]) {
        const path = originalPath.replaceAll("JSTorrent Preview", product === "RSTorrent" ? "JSTorrent Preview" : product);
        const file = join(root, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `package ${lane} ${path}`);
        if (signed) writeFileSync(`${file}.sig`, signature);
      }
      await stageDesktopReleaseLeg({
        root, lane, sourceSha, runId, attempt, expectedVersion: version, product,
        output: join(input, `desktop-release-${lane}-${runId}-${attempt}`),
      });
    }
  }
  const assemble = (overrides = {}) => assembleDesktopRelease({
    root, input, output, sourceSha, runId, attempt, repository,
    channel: "latest", version, tag: `desktop-latest-v${version}`,
    now: new Date("2026-09-27T12:00:00.000Z"), ...overrides,
  });
  return { root, input, output, stage, assemble };
}

test("collects independent signed legs into one complete Latest manifest", async () => {
  const data = fixture();
  try {
    await data.stage();
    const result = await data.assemble();
    assert.equal(result.release.assets.length, 23);
    assert.equal(Object.keys(result.latest.platforms).length, 15);
    assert.equal(result.latest.platforms["windows-x86_64"].signature, signature);
    assert.equal(result.latest.pub_date, "2026-09-27T12:00:00.000Z");
    assert.equal(validateDesktopRelease({ ...result, tag: `desktop-latest-v${version}`, repository }).version, version);
    assert.equal(readFileSync(join(data.output, "assets/latest.json"), "utf8").includes("desktop-latest-v1.2.3"), true);
    verifyUploadedAssets(result.release, structuredClone(result.release));
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("rehearsal assembles the same matrix without a published tag", async () => {
  const data = fixture();
  try {
    await data.stage();
    const result = await data.assemble({ channel: "stable", version: "", tag: "" });
    assert.equal(result.release.tagName, `desktop-v${version}`);
    assert.equal(result.release.isPrerelease, false);
    assert.equal(result.latest.notes, "Signed JSTorrent Preview desktop release rehearsal.");
    assert.equal(validateDesktopRelease({ ...result, tag: `desktop-v${version}`, repository }).version, version);
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("rejects stale, incomplete, duplicated, and altered release legs", async () => {
  for (const mutation of [
    (data) => writeFileSync(join(data.input, `desktop-release-linux-x86_64-${runId}-${attempt}`, `JSTorrent Preview_${version}_amd64.AppImage`), "altered"),
    (data) => rmSync(join(data.input, `desktop-release-linux-x86_64-${runId}-${attempt}`), { recursive: true }),
    (data) => {
      const old = join(data.input, `desktop-release-linux-x86_64-${runId}-${attempt}`);
      const duplicate = join(data.input, `desktop-release-windows-x86_64-${runId}-${attempt}`);
      rmSync(duplicate, { recursive: true });
      cpSync(old, duplicate, { recursive: true });
    },
    (data) => {
      const file = join(data.input, `desktop-release-windows-x86_64-${runId}-${attempt}`, "meta.json");
      const meta = JSON.parse(readFileSync(file, "utf8"));
      meta.sourceSha = "b".repeat(40);
      writeFileSync(file, JSON.stringify(meta));
    },
  ]) {
    const data = fixture();
    try {
      await data.stage();
      mutation(data);
      await assert.rejects(data.assemble(), /release leg|release lane|expected exactly/);
    } finally {
      rmSync(data.root, { recursive: true, force: true });
    }
  }
});

test("rejects mismatched GitHub release assets before publication", async () => {
  const data = fixture();
  try {
    await data.stage();
    const { release } = await data.assemble();
    const remote = structuredClone(release);
    remote.assets[0].digest = `sha256:${"f".repeat(64)}`;
    assert.throws(() => verifyUploadedAssets(release, remote), /differs from assembled bytes/);
    remote.assets = remote.assets.slice(1);
    assert.throws(() => verifyUploadedAssets(release, remote), /asset count mismatch/);
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("refuses a leg with an absent updater signature or wrong version", async () => {
  const data = fixture();
  try {
    mkdirSync(join(data.root, "target/release/bundle/nsis"), { recursive: true });
    writeFileSync(join(data.root, `target/release/bundle/nsis/JSTorrent Preview_${version}_x64-setup.exe`), "installer");
    await assert.rejects(
      stageDesktopReleaseLeg({
        root: data.root, lane: "windows-x86_64", sourceSha, runId, attempt,
        expectedVersion: "1.2.4", output: join(data.input, "wrong-version"),
      }),
      /package version .* does not match/,
    );
    await assert.rejects(
      stageDesktopReleaseLeg({
        root: data.root, lane: "windows-x86_64", sourceSha, runId, attempt,
        expectedVersion: version, output: join(data.input, "missing-signature"),
      }),
      /missing release file/,
    );
  } finally {
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("JSTorrent candidates use exact product receipts and cannot publish", async () => {
  const data=fixture("JSTorrent");
  try {
    await data.stage();
    const options={root:data.root,input:data.input,output:data.output,sourceSha,runId,attempt,repository,channel:"stable",version,product:"JSTorrent"};
    const result=await assembleDesktopRelease(options);
    validateDesktopRelease({...result,tag:result.release.tagName,repository});
    assert(Object.values(result.latest.platforms).every(p=>p.url.includes("/JSTorrent")));
    assert(Object.values(result.latest.platforms).every(p=>!p.url.includes("RSTorrent")));
    await assert.rejects(assembleDesktopRelease({...options,tag:`desktop-v${version}`,output:join(data.root,"forbidden")}),/publication is not enabled/u);
    const directory=join(data.input,`desktop-release-${RELEASE_LANES[0]}-${runId}-${attempt}`);
    const meta=JSON.parse(readFileSync(join(directory,"meta.json"),"utf8"));
    meta.product="RSTorrent";writeFileSync(join(directory,"meta.json"),JSON.stringify(meta));
    await assert.rejects(assembleDesktopRelease({...options,output:join(data.root,"mixed")}),/mixed release products/u);
  } finally {rmSync(data.root,{recursive:true,force:true});}
});

test("production assembly offers both AppImages without DEB/RPM assets or selectors", async () => {
  const data = fixture("JSTorrent");
  try {
    await data.stage();
    const options = { root:data.root, input:data.input, output:data.output, sourceSha, runId, attempt, repository,
      channel:"stable", version, product:"JSTorrent", tag:`desktop-v${version}`, productionPublication:true };
    const result = await assembleDesktopRelease(options);
    validateDesktopRelease({ ...result, tag:result.release.tagName, repository });
    assert.equal(result.release.assets.length, 15);
    assert.equal(result.release.assets.filter(asset => asset.name.endsWith(".sig")).length, 6);
    assert.equal(Object.keys(result.latest.platforms).length, 11);
    assert.equal(result.release.assets.some(asset => /\.(?:deb|rpm)(?:\.sig)?$/.test(asset.name)), false);
    assert.equal(Object.keys(result.latest.platforms).some(key => /-(?:deb|rpm)$/.test(key)), false);
    for (const arch of ["aarch64", "x86_64"]) {
      assert(result.latest.platforms[`linux-${arch}-appimage`]);
    }
    const excluded = structuredClone(result);
    excluded.release.assets.push({name:`JSTorrent_${version}_amd64.deb`, digest:`sha256:${"f".repeat(64)}`});
    assert.throws(() => validateDesktopRelease({...excluded, tag:result.release.tagName, repository}), /excludes DEB\/RPM/);
    const staleAlias = structuredClone(result);
    staleAlias.latest.platforms["linux-x86_64-deb"] = staleAlias.latest.platforms["linux-x86_64"];
    assert.throws(() => validateDesktopRelease({...staleAlias, tag:result.release.tagName, repository}), /exactly the 11/);
    assert.equal(result.release.isPrerelease, false);
    assert(Object.values(result.latest.platforms).every(platform => platform.url.includes(`/desktop-v${version}/JSTorrent`)));
    for (const overrides of [{ channel:"latest" }, { product:"RSTorrent" }, { tag:"" },
      { tag:`desktop-v9.9.9` }, { productionPublication:"true" }]) {
      await assert.rejects(assembleDesktopRelease({ ...options, ...overrides, output:join(data.root,"refused-"+Math.random()) }));
    }
  } finally { rmSync(data.root, { recursive:true, force:true }); }
});

test("final production private draft requires every core byte and exact checksum asset", async () => {
  const data = fixture("JSTorrent");
  try {
    await data.stage();
    const result = await data.assemble({ channel:"stable", product:"JSTorrent", tag:`desktop-v${version}`, productionPublication:true });
    const checksumPath = join(data.root,"SHA256SUMS");
    writeFileSync(checksumPath,"actual bounded checksum fixture\n");
    const checksumBytes = readFileSync(checksumPath);
    const remote = structuredClone(result.release);
    remote.assets.push({ name:"SHA256SUMS", size:checksumBytes.length,
      digest:`sha256:${createHash("sha256").update(checksumBytes).digest("hex")}` });
    await verifyProductionFinalDraft({ local:result.release, remote, checksumPath });
    for (const mutate of [
      value => value.assets.splice(value.assets.findIndex(asset => asset.name.endsWith(".sig")),1),
      value => value.assets.pop(),
      value => value.assets.push({ name:"unexpected",size:1,digest:"sha256:"+"f".repeat(64) }),
      value => value.assets.at(-1).digest="sha256:"+"f".repeat(64),
      value => value.assets[0].size+=1,
      value => value.isDraft=false,
      value => value.isPrerelease=true,
    ]) {
      const wrong = structuredClone(remote);mutate(wrong);
      await assert.rejects(verifyProductionFinalDraft({ local:result.release, remote:wrong, checksumPath }));
    }
    const preview = structuredClone(result.release);preview.assets[0].name="JSTorrent Preview_wrong.dmg";
    await assert.rejects(verifyProductionFinalDraft({ local:preview,remote,checksumPath }),/15 JSTorrent core/u);
  } finally { rmSync(data.root, { recursive:true, force:true }); }
});


test("source-bearing promotion binds an exact versioned archive and checksum inventory", async () => {
  const data = fixture("JSTorrent");
  try {
    await data.stage();
    const { release } = await data.assemble({ channel:"stable", product:"JSTorrent", tag:`desktop-v${version}`, productionPublication:true });
    const sourcePath = join(data.root, `JSTorrent_${version}_AppImage-sources-final.tar.gz`);
    writeFileSync(sourcePath,"independent reviewed source fixture");
    const sourceBytes = readFileSync(sourcePath);
    const source = { name: `JSTorrent_${version}_AppImage-sources-final.tar.gz`, size: sourceBytes.length,
      digest: `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}` };
    const checksumPath = join(data.root,"SHA256SUMS");
    const inventory = [...release.assets, source].filter(asset => !asset.name.endsWith(".sig"))
      .map(asset => `${asset.digest.slice(7)}  ${asset.name}`).sort().join("\n")+"\n";
    writeFileSync(checksumPath,inventory);
    const checksum = { name:"SHA256SUMS",size:Buffer.byteLength(inventory),
      digest:`sha256:${createHash("sha256").update(inventory).digest("hex")}` };
    const remote = { ...structuredClone(release), assets:[...release.assets,source,checksum] };
    await verifyProductionFinalDraft({ local:release,remote,checksumPath,sourcePath });
    for (const mutate of [
      value => value.assets.splice(value.assets.findIndex(asset => asset.name === source.name),1),
      value => value.assets.push(source),
      value => value.assets.find(asset => asset.name === source.name).digest="sha256:"+"f".repeat(64),
      value => value.assets.find(asset => asset.name === source.name).size+=1,
    ]) {
      const wrong = structuredClone(remote);mutate(wrong);
      await assert.rejects(verifyProductionFinalDraft({ local:release,remote:wrong,checksumPath,sourcePath }));
    }
    await assert.rejects(verifyProductionFinalDraft({ local:release,remote,checksumPath }),/asset count/u);
    const wrongName = join(data.root,"JSTorrent_0.0.1_AppImage-sources-final.tar.gz");
    writeFileSync(wrongName,sourceBytes);
    await assert.rejects(verifyProductionFinalDraft({ local:release,remote,checksumPath,sourcePath:wrongName }),/version\/name/u);
    writeFileSync(checksumPath, inventory.split("\n").filter(line => !line.includes(source.name)).join("\n"));
    await assert.rejects(verifyProductionFinalDraft({ local:release,remote,checksumPath,sourcePath }),/checksum inventory/u);
    writeFileSync(checksumPath,inventory);writeFileSync(sourcePath,Buffer.concat([sourceBytes,Buffer.from("altered")]));
    await assert.rejects(verifyProductionFinalDraft({ local:release,remote,checksumPath,sourcePath }),/checksum inventory/u);
  } finally { rmSync(data.root,{recursive:true,force:true}); }
});

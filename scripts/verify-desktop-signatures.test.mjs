import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifySignature, signatureKeyId, signatureInventory } from "./verify-desktop-signatures.mjs";

test("production signature inventory follows AppImage-only scope without shrinking preview", t => {
  const work = mkdtempSync(path.join(tmpdir(), "desktop-signature-inventory-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const production = [
    "JSTorrent_aarch64.app.tar.gz.sig", "JSTorrent_x64.app.tar.gz.sig",
    "JSTorrent_0.3.0_amd64.AppImage.sig", "JSTorrent_0.3.0_aarch64.AppImage.sig",
    "JSTorrent_0.3.0_x64-setup.exe.sig", "JSTorrent_0.3.0_x64_en-US.msi.sig",
  ];
  const populate = names => {
    for (const name of signatureInventoryFiles) rmSync(path.join(work, name));
    signatureInventoryFiles = names;
    for (const name of names) writeFileSync(path.join(work, name), "inventory fixture only");
  };
  let signatureInventoryFiles = [];
  populate(production);
  assert.deepEqual(signatureInventory(work, "JSTorrent"), [...production].sort());
  populate(production.slice(1));
  assert.throws(() => signatureInventory(work, "JSTorrent"), /expected all 6/u);
  populate([...production, "JSTorrent_0.3.0_amd64.deb.sig"]);
  assert.throws(() => signatureInventory(work, "JSTorrent"), /expected all 6/u);
  populate(["JSTorrent_0.3.0_amd64.deb.sig", ...production.slice(1)]);
  assert.throws(() => signatureInventory(work, "JSTorrent"), /excludes DEB\/RPM/u);
  populate(["JSTorrent Preview_aarch64.app.tar.gz.sig", ...production.slice(1)]);
  assert.throws(() => signatureInventory(work, "JSTorrent"), /wrong signing product/u);
  const preview = production.map(name => name.replace("JSTorrent", "JSTorrent Preview"));
  populate(preview);
  assert.throws(() => signatureInventory(work, "RSTorrent"), /expected all 10/u);
  populate([...preview, "JSTorrent Preview_0.3.0_amd64.deb.sig", "JSTorrent Preview_0.3.0_arm64.deb.sig",
    "JSTorrent Preview-0.3.0-1.x86_64.rpm.sig", "JSTorrent Preview-0.3.0-1.aarch64.rpm.sig"]);
  assert.equal(signatureInventory(work, "RSTorrent").length, 10);
  assert.throws(() => signatureInventory(work, "unknown"), /unknown signing product/u);
});

test("actual minisign signatures reject wrong roots and altered payloads", t => {
  const work=mkdtempSync(path.join(tmpdir(), "desktop-minisign-fixture-"));
  t.after(()=>rmSync(work,{recursive:true,force:true}));
  for(const key of ["first","second"]) execFileSync("minisign", ["-G","-W","-p",path.join(work,key+".pub"),"-s",path.join(work,key+".key")],{stdio:"pipe"});
  const file=path.join(work,"payload"); writeFileSync(file,"controlled updater bytes");
  execFileSync("minisign", ["-S","-s",path.join(work,"first.key"),"-m",file],{stdio:"pipe"});
  const sig=readFileSync(file+".minisig").toString("base64");
  const first=readFileSync(path.join(work,"first.pub")).toString("base64");
  const second=readFileSync(path.join(work,"second.pub")).toString("base64");
  assert.match(signatureKeyId(sig),/^[A-F0-9]{16}$/u);
  assert.doesNotThrow(()=>verifySignature(file,sig,first));
  assert.throws(()=>verifySignature(file,sig,second));
  writeFileSync(file,"tampered updater bytes");
  assert.throws(()=>verifySignature(file,sig,first));
});

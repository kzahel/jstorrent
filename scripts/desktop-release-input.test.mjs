import assert from "node:assert/strict";
import test from "node:test";

import { resolveDesktopReleaseInput } from "./desktop-release-input.mjs";

test("a scheduled reusable call resolves the exact verified Latest identity", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(resolveDesktopReleaseInput({
    event: "schedule", ref: "refs/heads/main", sha: "b".repeat(40),
    sourceSha: sha, version: "0.2.101", tag: "desktop-latest-v0.2.101",
  }), {
    sourceSha: sha, version: "0.2.101", tag: "desktop-latest-v0.2.101", channel: "latest", publish: true,
  });
});

test("stable tag pushes build production candidates without publishing", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(resolveDesktopReleaseInput({ event: "push", ref: "refs/tags/desktop-v0.1.4", sha }), {
    sourceSha: sha, version: "0.1.4", tag: "", channel: "stable", publish: false, production: true,
  });
  assert.equal(resolveDesktopReleaseInput({ event: "workflow_dispatch", ref: "refs/heads/main", sha }).publish, false);
  assert.throws(() => resolveDesktopReleaseInput({ event: "push", ref: "refs/tags/desktop-vbad", sha }), /Invalid Stable/);
  assert.throws(() => resolveDesktopReleaseInput({ event: "schedule", ref: "refs/heads/main", sha, sourceSha: sha, version: "0.2.101", tag: "desktop-v0.2.101" }), /matching Latest tag/);
});

test("only an explicit manual stable tag dispatch selects production publication", () => {
  const sha = "a".repeat(40);
  const input = { event: "workflow_dispatch", ref: "refs/tags/desktop-v0.3.0", sha, productionPublication: true };
  assert.deepEqual(resolveDesktopReleaseInput(input), {
    sourceSha: sha, version: "0.3.0", tag: "desktop-v0.3.0", channel: "stable",
    publish: true, production: true, productionPublication: true,
  });
  for (const overrides of [
    { event: "push" }, { event: "schedule" }, { productionCandidate: true },
    { ref: "refs/heads/main" }, { ref: "refs/tags/desktop-latest-v0.3.0" },
    { ref: "refs/tags/desktop-v0.3.0-extra" }, { sha: "invalid" },
    { sourceSha: sha }, { version: "0.3.0" }, { tag: "desktop-v0.3.0" },
  ]) assert.throws(() => resolveDesktopReleaseInput({ ...input, ...overrides }), /explicit manual Stable tag dispatch/u);
});

test("production candidates cannot publish or reuse nightly/tag inputs", () => {
  const input = {event: "workflow_dispatch", ref: "refs/heads/main", sha: "a".repeat(40), productionCandidate: true};
  assert.equal(resolveDesktopReleaseInput(input).publish, false);
  assert.equal(resolveDesktopReleaseInput(input).production, true);
  for (const overrides of [{event:"push"}, {ref:"refs/tags/desktop-v0.3.0"}, {tag:"desktop-v0.3.0"}, {sourceSha:"b".repeat(40)}]) {
    assert.throws(() => resolveDesktopReleaseInput({...input, ...overrides}), /manual branch build/u);
  }
});

test("JSTorrent Latest explicitly selects production signing and never a Stable tag", () => {
  const input={event:"workflow_call",ref:"refs/heads/main",sha:"b".repeat(40),sourceSha:"a".repeat(40),version:"0.3.2",tag:"desktop-latest-v0.3.2",productionLatest:true};
  const result=resolveDesktopReleaseInput(input);
  assert.equal(result.production,true);assert.equal(result.productionPublication,true);assert.equal(result.channel,"latest");
  for(const overrides of [{tag:"desktop-v0.3.2"},{productionCandidate:true},{productionPublication:true},{sourceSha:""}])
    assert.throws(()=>resolveDesktopReleaseInput({...input,...overrides}),/Production Latest/);
});

test('private cohort version/schema overrides cannot enter publication',()=>{
 const base={event:'workflow_dispatch',ref:'refs/heads/main',sha:'a'.repeat(40),productionCandidate:true,candidateVersion:'0.3.60001',qualificationSchemaBump:true};
 const result=resolveDesktopReleaseInput(base);
 assert.equal(result.version,'0.3.60001');assert.equal(result.publish,false);assert.equal(result.qualificationSchemaBump,true);
 for(const change of [{productionCandidate:false},{productionPublication:true},{productionLatest:true},{candidateVersion:'0.3.2'},{candidateVersion:''}])assert.throws(()=>resolveDesktopReleaseInput({...base,...change}));
});

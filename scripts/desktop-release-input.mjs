import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveDesktopReleaseInput({ event, ref, sha, sourceSha, version, tag, productionCandidate = false, productionPublication = false, productionLatest = false, candidateVersion = "", qualificationSchemaBump = false }) {
  if ((candidateVersion || qualificationSchemaBump) && !productionCandidate) {
    throw new Error("Private qualification inputs require a nonpublishing candidate");
  }
  if (candidateVersion && (!/^0\.3\.60[0-9]{3}$/.test(candidateVersion))) {
    throw new Error("Private qualification requires a reserved 0.3.60000–60999 version");
  }
  if (qualificationSchemaBump && !candidateVersion) throw new Error("Schema qualification needs a private version");
  if (productionLatest) {
    if (!/^[0-9a-f]{40}$/.test(sourceSha ?? "") || !/^\d+\.\d+\.\d+$/.test(version ?? "") || tag !== `desktop-latest-v${version}` || productionCandidate || productionPublication) {
      throw new Error("Production Latest requires exact source, version and Latest tag");
    }
    return { sourceSha, version, tag, channel: "latest", publish: true, production: true, productionPublication: true };
  }
  if (productionPublication) {
    if (productionCandidate || event !== "workflow_dispatch" || sourceSha || version || tag ||
        !/^refs\/tags\/desktop-v\d+\.\d+\.\d+$/.test(ref ?? "") || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
      throw new Error("Production publication requires an explicit manual Stable tag dispatch without candidate or override inputs");
    }
    const stableTag = ref.slice("refs/tags/".length);
    return { sourceSha: sha, version: stableTag.slice("desktop-v".length), tag: stableTag,
      channel: "stable", publish: true, production: true, productionPublication: true };
  }
  if (productionCandidate) {
    if (event !== "workflow_dispatch" || sourceSha || version || tag || !ref?.startsWith("refs/heads/")) {
      throw new Error("Production candidates require a manual branch build without publication inputs");
    }
    return { sourceSha: sha, version: candidateVersion, tag: "", channel: "stable", publish: false, production: true, ...(qualificationSchemaBump ? {qualificationSchemaBump:true} : {}) };
  }
  if (sourceSha || version || tag) {
    if (!/^[0-9a-f]{40}$/.test(sourceSha ?? "") || !/^\d+\.\d+\.\d+$/.test(version ?? "") || tag !== `desktop-latest-v${version}`) {
      throw new Error("Nightly release requires exact source SHA, numeric version, and matching Latest tag");
    }
    return { sourceSha, version, tag, channel: "latest", publish: true };
  }
  if (event === "push" && /^refs\/tags\/desktop-v\d+\.\d+\.\d+$/.test(ref)) {
    const stableTag = ref.slice("refs/tags/".length);
    return { sourceSha: sha, version: stableTag.slice("desktop-v".length), tag: "", channel: "stable", publish: false, production: true };
  }
  if (event === "push" && ref?.startsWith("refs/tags/desktop-v")) {
    throw new Error("Invalid Stable desktop release tag");
  }
  return { sourceSha: sha, version: "", tag: "", channel: "stable", publish: false };
}

let isMain = false;
try { isMain = realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch {}
if (isMain) {
  try {
    const result = resolveDesktopReleaseInput({
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
      sourceSha: process.env.INPUT_SOURCE_SHA,
      version: process.env.INPUT_RELEASE_VERSION,
      tag: process.env.INPUT_RELEASE_TAG,
      productionCandidate: process.env.INPUT_PRODUCTION_CANDIDATE === "true",
      productionPublication: process.env.INPUT_PRODUCTION_PUBLICATION === "true",
      productionLatest: process.env.INPUT_PRODUCTION_LATEST === "true",
      candidateVersion: process.env.INPUT_CANDIDATE_VERSION || "",
      qualificationSchemaBump: process.env.INPUT_QUALIFICATION_SCHEMA_BUMP === "true",
    });
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(""));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

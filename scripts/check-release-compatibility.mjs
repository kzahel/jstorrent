import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const policyPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../clients/web/src/api/release-compatibility.json",
);

/**
 * Whether a host release may ship. Each reviewed exposure is something a
 * host built from main sends that some released clients reject: a `field`
 * breaks only strict clients (extension 1.1.4 and older), so it blocks only
 * while they are supported; a `value` (enum value or variant) breaks every
 * released client, so it blocks until clients tolerate it, unless a host
 * sends it only after a request no supported released client can make
 * (`requestedBy`, checked by contract-compatibility.test.ts). The maintainer may record an accepted
 * break for one release, or exact reviewed fields on desktop Latest only.
 * See docs/topics/mixed-version-compatibility.md.
 */
export function checkReleaseCompatibility(policy, { surface, release }) {
  const strict = policy.strictClients;
  if (!strict.controlledSurfaces.includes(surface)) {
    return { ok: true, message: `${release}: no released extension controls ${surface}` };
  }
  const latest = policy.acceptedLatestDesktopFields;
  const acceptedLatest = surface === "desktop" && /^desktop-latest-v\d+\.\d+\.\d+$/.test(release) &&
    typeof latest?.reason === "string" && latest.reason.trim() !== "" &&
    latest.minimumExtension === strict.tolerantSince?.extension &&
    typeof latest.minimumExtension === "string" && Array.isArray(latest.fields);
  const blocking = Object.entries(policy.reviewedClientExposure ?? {})
    .filter(([, exposure]) =>
      exposure.kind === "value" ? exposure.requestedBy === undefined : strict.supported,
    )
    .filter(([path, exposure]) => !(acceptedLatest && exposure.kind === "field" && latest.fields.includes(path)))
    .map(([path, exposure]) => `${path} (${exposure.kind})`);
  if (blocking.length === 0) {
    if (acceptedLatest && strict.supported) return { ok: true,
      message: `${release}: Latest-only field break accepted; requires extension ${latest.minimumExtension} or newer: ${latest.reason}` };
    return { ok: true, message: `${release}: sends nothing a supported released client rejects` };
  }
  const accepted = policy.acceptedBreaks?.[release];
  if (typeof accepted === "string" && accepted.trim() !== "") {
    return { ok: true, message: `${release}: client break accepted: ${accepted}` };
  }
  return {
    ok: false,
    message:
      `${release} would send ${blocking.length} addition(s) that supported released clients ` +
      `reject: ${blocking.join(", ")}. A field blocks while ${strict.description} are supported ` +
      "(set strictClients.supported to false once a tolerant extension has replaced them); a " +
      "value blocks until clients tolerate it. Or record the accepted break under " +
      `acceptedBreaks["${release}"] in clients/web/src/api/release-compatibility.json. ` +
      "See docs/topics/mixed-version-compatibility.md.",
  };
}

function main(argv) {
  const options = Object.fromEntries(
    argv.flatMap((value, index) =>
      value.startsWith("--") ? [[value.slice(2), argv[index + 1]]] : [],
    ),
  );
  const { surface, release } = options;
  if (!surface || !release) {
    throw new Error("usage: check-release-compatibility.mjs --surface <surface> --release <tag> [--enforce true|false]");
  }
  const result = checkReleaseCompatibility(
    JSON.parse(readFileSync(options.policy ?? policyPath, "utf8")),
    { surface, release },
  );
  if (result.ok) {
    console.log(result.message);
  } else if (options.enforce === "true") {
    console.log(`::error::${result.message}`);
    process.exitCode = 1;
  } else {
    console.log(`::warning::${result.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

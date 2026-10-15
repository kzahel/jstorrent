import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const policyPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../clients/web/src/api/release-compatibility.json",
);

/**
 * Whether a host release may ship. While released strict clients (extension
 * 1.1.4 and older) are supported, a host release that sends anything they
 * reject breaks them, unless the maintainer recorded that break for this
 * release. See docs/topics/mixed-version-compatibility.md.
 */
export function checkReleaseCompatibility(policy, { surface, release }) {
  const strict = policy.strictClients;
  const exposures = Object.keys(policy.reviewedStrictClientExposure ?? {});
  if (!strict.supported || !strict.controlledSurfaces.includes(surface)) {
    return { ok: true, message: `${release}: no supported strict client controls ${surface}` };
  }
  if (exposures.length === 0) {
    return { ok: true, message: `${release}: sends nothing released strict clients reject` };
  }
  const accepted = policy.acceptedBreaks?.[release];
  if (typeof accepted === "string" && accepted.trim() !== "") {
    return { ok: true, message: `${release}: strict-client break accepted: ${accepted}` };
  }
  return {
    ok: false,
    message:
      `${release} would send ${exposures.length} addition(s) that ${strict.description} ` +
      `reject: ${exposures.join(", ")}. Wait until a tolerant extension has replaced them and set ` +
      `strictClients.supported to false, or record the accepted break under ` +
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
    JSON.parse(readFileSync(policyPath, "utf8")),
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

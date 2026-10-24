// Prints the extension version the Chrome Web Store currently serves to
// browsers, from Chrome's public update endpoint. Needs no credentials.
//
//   node scripts/extension-store-version.mjs [--id <extension id>] [--expect <version>]
//
// --expect exits 1 unless that version is live. The authenticated check
// (pending review, submitted versions) is `gh workflow run
// extension-release.yml --ref main -f mode=check`.
import { fileURLToPath } from "node:url";

/** The production JSTorrent extension (clients/extension/manifest.jstorrent.json). */
export const PRODUCTION_EXTENSION_ID = "dbokmlpefliilbjldladbimlcfgbolhk";

export function updateCheckUrl(id) {
  if (!/^[a-p]{32}$/.test(id)) throw new Error(`not an extension ID: ${id}`);
  const query = new URLSearchParams({
    response: "updatecheck",
    acceptformat: "crx3",
    prodversion: "200.0",
    x: `id=${id}&uc`,
  });
  return `https://clients2.google.com/service/update2/crx?${query}`;
}

/** The served version in an update response, or null when none is served. */
export function servedVersion(xml, id) {
  const app = new RegExp(`<app appid="${id}"[^>]*>([\\s\\S]*?)</app>`).exec(xml);
  if (app === null) return null;
  const update = /<updatecheck\b[^>]*\bstatus="ok"[^>]*>/.exec(app[1]);
  return update === null ? null : (/\bversion="([^"]+)"/.exec(update[0])?.[1] ?? null);
}

async function main(argv) {
  const options = Object.fromEntries(
    argv.flatMap((value, index) => (value.startsWith("--") ? [[value.slice(2), argv[index + 1]]] : [])),
  );
  const id = options.id ?? PRODUCTION_EXTENSION_ID;
  const response = await fetch(updateCheckUrl(id));
  if (!response.ok) throw new Error(`update check failed: HTTP ${response.status}`);
  const version = servedVersion(await response.text(), id);
  if (version === null) {
    console.log(`${id}: no version served`);
    process.exitCode = 1;
    return;
  }
  console.log(`${id}: ${version}`);
  if (options.expect !== undefined && options.expect !== version) {
    console.log(`expected ${options.expect}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

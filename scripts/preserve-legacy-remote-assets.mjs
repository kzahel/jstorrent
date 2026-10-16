// Frozen, verified first-party build outputs for pre-cutover open tabs.
// No controller HTML or executable build runs in the marketing deployment.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function validateLegacyManifest(manifest) {
  const base = new URL(manifest.base_url);
  if (manifest.schema_version !== 1 || base.protocol !== "https:" || base.username || base.password ||
      base.search || base.hash || !base.pathname.endsWith("/remote/") ||
      !/^[0-9a-f]{40}$/.test(manifest.build_id) || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.retire_not_before) ||
      !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 256) {
    throw new Error("Invalid legacy asset manifest");
  }
  const paths = new Set();
  let bytes = 0;
  for (const file of manifest.files) {
    if (!/^assets\/[A-Za-z0-9_-]+[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(file.path) ||
        paths.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid legacy asset record");
    paths.add(file.path);
    bytes += file.bytes;
  }
  if (bytes > 32 * 1024 * 1024) throw new Error("Legacy asset budget exceeded");
}

export async function preserveLegacyAssets(manifest, target, fetchAsset = fetch) {
  validateLegacyManifest(manifest);
  // Four workers bound both request count and buffered bytes.
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < manifest.files.length) {
      const file = manifest.files[next++];
      const response = await fetchAsset(new URL(file.path, manifest.base_url), {
        redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || !response.body) throw new Error(`Legacy asset unavailable: ${file.path}`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > file.bytes) throw new Error(`Legacy asset exceeds manifest: ${file.path}`);
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (bytes !== file.bytes || createHash("sha256").update(body).digest("hex") !== file.sha256) {
        throw new Error(`Legacy asset digest mismatch: ${file.path}`);
      }
      const destination = join(target, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, body);
    }
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile(join(root, "compat/legacy-remote-assets.json"), "utf8"));
  await preserveLegacyAssets(manifest, resolve(process.argv[2] ?? join(root, "website/dist/remote")));
  console.log(`Preserved ${manifest.files.length} legacy assets from ${manifest.build_id}; retirement requires review after ${manifest.retire_not_before}.`);
}

import { readdir, readFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const remoteRoot = resolve(scriptDirectory, "../dist/remote");
const sourceHtml = join(remoteRoot, "remote.html");
const targetHtml = join(remoteRoot, "index.html");

const html = await readFile(sourceHtml, "utf8");
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
if (
  references.length === 0 ||
  references.some((reference) => !reference.startsWith("/assets/"))
) {
  throw new Error("remote HTML must reference only /assets/ build output");
}
await rejectServiceWorkers(remoteRoot);
await rename(sourceHtml, targetHtml);

async function rejectServiceWorkers(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rejectServiceWorkers(path);
      continue;
    }
    if (/^(?:sw|service-worker)(?:[.-]|$)/i.test(entry.name)) {
      throw new Error(`remote build contains a service worker: ${path}`);
    }
    if (entry.name.endsWith(".js")) {
      const source = await readFile(path, "utf8");
      if (/navigator\s*\.\s*serviceWorker/.test(source)) {
        throw new Error(`remote build registers a service worker: ${path}`);
      }
    }
  }
}

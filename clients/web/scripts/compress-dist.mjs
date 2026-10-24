// Tactical 356: brotli and gzip copies beside each compressible file of the
// hosted web build, served by the gateway's precompressed static fallback.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const distributionRoot = resolve(scriptDirectory, "../dist");
const COMPRESSIBLE = new Set([".js", ".css", ".html", ".json", ".svg", ".txt"]);
// Below this a compressed copy saves less than its extra request cost.
const MINIMUM_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gzipBytes = promisify(gzip);

async function compressibleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return compressibleFiles(path);
      return COMPRESSIBLE.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return nested.flat();
}

async function compressFile(path) {
  const source = await readFile(path);
  if (source.byteLength < MINIMUM_BYTES) return null;
  const [br, gz] = await Promise.all([
    brotli(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
      },
    }),
    gzipBytes(source, { level: constants.Z_BEST_COMPRESSION }),
  ]);
  const written = { source: source.byteLength, br: null, gz: null };
  if (br.byteLength < source.byteLength) {
    await writeFile(`${path}.br`, br);
    written.br = br.byteLength;
  }
  if (gz.byteLength < source.byteLength) {
    await writeFile(`${path}.gz`, gz);
    written.gz = gz.byteLength;
  }
  return written;
}

const files = await compressibleFiles(distributionRoot);
const results = (await Promise.all(files.map(compressFile))).filter(
  (result) => result !== null,
);
const total = (key) =>
  results.reduce((sum, result) => sum + (result[key] ?? result.source), 0);
const kilobytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
console.log(
  `Precompressed ${results.length} files: ${kilobytes(total("source"))} -> ` +
    `${kilobytes(total("br"))} brotli, ${kilobytes(total("gz"))} gzip.`,
);

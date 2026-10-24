// Exercise the root-hosted artifact using Playwright's separate Chromium.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "clients/web/dist/remote");
const require = createRequire(resolve(root, "clients/web/package.json"));
const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://local").pathname;
    const file = resolve(dist, '.' + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(dist + sep) || !(await stat(file)).isFile()) throw Error("missing");
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status(), 200);
  await page.getByLabel("Route username").waitFor();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Root controller artifact loads React, Wasm and the sign-in form without script errors.");
} finally { await browser?.close(); await new Promise(done => server.close(done)); }

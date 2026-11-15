// Source-level recovery regression. Crypto and the relay boundary are fixtures;
// the gate, IndexedDB, remote transport, view client/controller and UI are real.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "clients/web");
const require = createRequire(join(web, "package.json"));
const { chromium } = require("playwright");
const { createServer } = await import(require.resolve("vite"));
const cache = await mkdtemp(join(tmpdir(), "jstorrent-remote-recovery-"));
const entryId = join(web, "__remote_recovery.tsx");
const entry = `
import { createRoot } from "react-dom/client";
import { RemoteAccessGate } from "/src/remote/RemoteAccessGate";
import { startRemoteInspection } from "/src/inspection/bootstrap";
import { initializeLocalization, LocalizationProvider } from "/src/localization/runtime";
import { IndexedDbRemoteClientStore, createPrivateBrowserCredential } from "/src/remote-client-store";
import { authorization, wasm } from "/src/test-support/remote-connection";
import { ScriptedRemoteHost } from "/src/test-support/scripted-remote-host";
await initializeLocalization();
window.recoveryHost = new ScriptedRemoteHost();
const NativeWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
  return String(url).startsWith("wss://relay.invalid/")
    ? window.recoveryHost.connect(String(url)) : new NativeWebSocket(url, protocols);
};
window.recoveryStore = new IndexedDbRemoteClientStore();
const credential = await createPrivateBrowserCredential("Recovery fixture");
await window.recoveryStore.saveAuthorization(authorization(), credential.key);
localStorage.setItem("rstorrent.remote.last-username.v1", "alice");
window.recoveryDocument = crypto.randomUUID();
const root = createRoot(document.getElementById("app"));
root.render(<LocalizationProvider><RemoteAccessGate relayUrl="wss://relay.invalid/client"
  clientBuild="recovery-fixture" crypto={wasm} store={window.recoveryStore}
  onConnected={(client, remote) => startRemoteInspection(client, root, remote, "recovery-fixture")}
/></LocalizationProvider>);
`;

let server;
let browser;
try {
  server = await createServer({
    root: web,
    configFile: false,
    cacheDir: cache,
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-intl",
        "react-aria-components",
        "zustand",
        "zustand/vanilla",
      ],
    },
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: "owned-remote-recovery-fixture",
        resolveId(id) {
          if (id === "/__remote_recovery.tsx") return entryId;
        },
        load(id) {
          if (id === entryId) return entry;
        },
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== "/") return next();
            response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
            response.end(
              '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__remote_recovery.tsx"></script></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  for (const width of [1365, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let navigations = 0;
      page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
      });
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page
        .locator('[data-connection="connected"]')
        .waitFor({ timeout: 20_000 })
        .catch(async (cause) => {
          throw new Error(
            `Remote fixture failed: ${JSON.stringify(errors)}; ${(await page.locator("body").innerText()).slice(0, 2000)}`,
            { cause },
          );
        });
      const documentId = await page.evaluate(() => window.recoveryDocument);
      const field = page.getByRole("textbox", { name: "Magnet link or torrent URL" });
      await field.fill("magnet:?xt=urn:btih:retained-draft");

      await page.evaluate(() => {
        window.recoveryHost.mode = "offline";
        window.recoveryHost.sockets.at(-1).close(1006, "phone network lost");
      });
      await page.locator('[data-connection-overlay="reconnecting"]').waitFor();
      await page.evaluate(() => {
        window.recoveryHost.mode = "online";
        window.dispatchEvent(new Event("online"));
      });
      await page.locator('[data-connection="connected"]').waitFor();
      assert.equal(await field.inputValue(), "magnet:?xt=urn:btih:retained-draft");

      // Freeze/resume the actual renderer, then leave the old socket silent.
      const cdp = await context.newCDPSession(page);
      const previousSockets = await page.evaluate(() => window.recoveryHost.sockets.length);
      await page.evaluate(() => {
        window.recoveryHost.inspectReplies = false;
      });
      await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
      await new Promise((done) => setTimeout(done, 1_050));
      await cdp.send("Page.setWebLifecycleState", { state: "active" });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction(
        (count) => window.recoveryHost.sockets.length > count,
        previousSockets,
      );
      await page.locator('[data-connection="connected"]').waitFor();
      assert.equal(await field.inputValue(), "magnet:?xt=urn:btih:retained-draft");
      assert.equal(await page.evaluate(() => window.recoveryDocument), documentId);
      assert.equal(navigations, 1, "recovery navigated the document");
      assert.equal(
        await page.evaluate(
          async () => !!(await window.recoveryStore.load("alice"))?.authorization,
        ),
        true,
      );

      await page.evaluate(() => {
        window.recoveryHost.mode = "changed";
        window.recoveryHost.sockets.at(-1).close(1006, "changed host");
      });
      await page.locator('[data-connection="stopped"]').waitFor();
      assert.equal(navigations, 1);
      assert.deepEqual(errors, []);
      console.log(
        `Remote recovery ${width}px: network outage, frozen silent socket, retained form/document/authorization, and changed-host stop passed.`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(cache, { recursive: true, force: true });
}

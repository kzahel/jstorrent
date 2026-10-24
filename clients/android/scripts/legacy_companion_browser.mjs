// Owned Playwright Chromium only. The proxy preserves shipping ARC URLs/Host;
// ADB forwards terminate inside the runner's owned emulator.
import http from "node:http";
import net from "node:net";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { chromium } from "../../web/node_modules/playwright-core/index.mjs";

const [profile, oldExtension, newExtension, oldPort, newPort, ioPort, streamingPort, evidenceDir] = process.argv.slice(2);
const allowed = new Map([[7800, Number(oldPort)], [3030, Number(newPort)], [7801, Number(ioPort)], [7802, Number(streamingPort)]]);
const requests = [];
const rejected = [];
const sockets = new Set();
function destination(raw) {
  const url = new URL(raw);
  if (url.hostname !== "100.115.92.2" || !allowed.has(Number(url.port))) {
    rejected.push({ host: url.hostname, port: url.port, path: url.pathname });
    if (rejected.length > 32) rejected.shift();
    throw new Error("outside owned ARC route");
  }
  return { port: allowed.get(Number(url.port)), path: url.pathname + url.search };
}
const proxy = http.createServer((req, res) => {
  try {
    const target = destination(req.url);
    requests.push(new URL(req.url).pathname); if (requests.length > 32) requests.shift();
    const upstream = http.request({ host: "127.0.0.1", ...target, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  } catch { res.writeHead(502); res.end(); }
});
proxy.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
proxy.on("connect", (req, socket, head) => {
  try {
    const target = destination(`http://${req.url}/`);
    const remote = net.connect(target.port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      socket.pipe(remote); remote.pipe(socket);
    });
    sockets.add(remote); remote.on("close", () => sockets.delete(remote));
    remote.on("error", () => socket.destroy()); socket.on("error", () => remote.destroy());
    socket.on("close", () => remote.destroy());
  } catch { socket.destroy(); }
});
proxy.on("upgrade", (req, socket, head) => {
  try {
    requests.push("websocket " + new URL(req.url).pathname); if (requests.length > 32) requests.shift();
    const target = destination(req.url);
    const remote = net.connect(target.port, "127.0.0.1", () => {
      remote.write(`${req.method} ${target.path} HTTP/1.1\r\n` + Object.entries(req.headers).map(([key, value]) => `${key}: ${value}\r\n`).join("") + "\r\n");
      if (head.length) remote.write(head);
      socket.pipe(remote); remote.pipe(socket);
    });
    sockets.add(remote); remote.on("close", () => sockets.delete(remote));
    remote.on("error", () => socket.destroy()); socket.on("error", () => remote.destroy());
    socket.on("close", () => remote.destroy());
  } catch { socket.destroy(); }
});
await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ["--headless=new", "--user-agent=Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", `--disable-extensions-except=${oldExtension},${newExtension}`, `--load-extension=${oldExtension},${newExtension}`],
  proxy: { server: `http://127.0.0.1:${proxy.address().port}` },
  userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});
const newId = "gcgoepclopkgijmclmlheafaglmbjlcc";
let oldPage, newPage;
async function capture(page, label) {
  if (!evidenceDir || evidenceDir === "-") return;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const layouts = [];
  for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 850 });
    if (label === "new-extension-new-android") {
      await page.waitForFunction(() => {
        const app = document.querySelector("#app [data-sidebar-open]");
        const main = app?.querySelector("main");
        const drawer = main?.parentElement.querySelector("nav");
        if (!app || !main || !drawer) return false;
        const bounds = main.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth + 1 &&
          (innerWidth > 760 || (app.dataset.sidebarOpen === "false" && drawer.getBoundingClientRect().right <= 1));
      }, undefined, { timeout: 10000 });
      layouts.push(await page.evaluate(() => {
        const app = document.querySelector("#app [data-sidebar-open]");
        const main = app.querySelector("main").getBoundingClientRect();
        const drawer = app.querySelector("main").parentElement.querySelector("nav").getBoundingClientRect();
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          main: {left: main.left, right: main.right}, drawer: {left: drawer.left, right: drawer.right},
          sidebarOpen: app.dataset.sidebarOpen };
      }));
    }
    await page.screenshot({ path: path.join(evidenceDir, `${label}-${width}.png`), fullPage: true, animations: "disabled" });
    if (label === "new-extension-new-android" && width === 390) {
      const toggle = page.getByRole("button", { name: /^Toggle .* filters$/ });
      await toggle.click();
      await page.waitForFunction(() => {
        const app = document.querySelector("#app [data-sidebar-open]");
        const drawer = app?.querySelector("main").parentElement.querySelector("nav").getBoundingClientRect();
        return app?.dataset.sidebarOpen === "true" && drawer.left >= 0 && drawer.right <= innerWidth;
      });
      await page.screenshot({ path: path.join(evidenceDir, `${label}-filters-${width}.png`), fullPage: true, animations: "disabled" });
      await toggle.click();
      await page.waitForFunction(() => document.querySelector("#app [data-sidebar-open]")?.dataset.sidebarOpen === "false");
    }
  }
  await writeFile(path.join(evidenceDir, `${label}-ui.txt`), await page.locator("body").innerText());
  if (layouts.length) await writeFile(path.join(evidenceDir, `${label}-layout.json`), JSON.stringify(layouts, null, 2) + "\n");
}
async function command(request) {
  switch (request.op) {
    case "open-old": {
      if (browser.serviceWorkers().length < 2) await browser.waitForEvent("serviceworker", { timeout: 15000 });
      const oldWorker = browser.serviceWorkers().find(worker => !worker.url().includes(newId));
      if (!oldWorker) throw new Error("legacy worker unavailable");
      const id = new URL(oldWorker.url()).hostname;
      const setup = await browser.newPage();
      await setup.goto(`chrome-extension://${id}/src/ui/share.html`);
      await setup.evaluate(async () => {
        await chrome.storage.local.set({ "android:daemonPort": 7800 });
      });
      await setup.close();
      oldPage = await browser.newPage();
      await oldPage.goto(`chrome-extension://${id}/src/ui/app.html`);
      return { opened: true };
    }
    case "old-ready":
      await oldPage.waitForFunction(() => window.engineManager?.engine && window.engineManager?.daemonConnection, undefined, { timeout: 45000 });
      await capture(oldPage, "old-extension-old-android");
      return oldPage.evaluate(() => {
        const manager = window.engineManager;
        manager.configHub.set("dhtEnabled", false);
        manager.configHub.set("pexEnabled", false);
        manager.configHub.set("upnpEnabled", false);
        manager.configHub.set("encryptionPolicy", "disabled");
        return { roots: manager.engine.storageRootManager.getRoots().map(root => ({ key: root.key, label: root.label })) };
      });
    case "diagnose": return { routes: requests, ui: await oldPage.locator("body").innerText() };
    case "add":
      return oldPage.evaluate(async ({ torrent, folder, pause }) => {
        const engine = window.engineManager.engine;
        const root = engine.storageRootManager.getRoots().find(root => root.label === folder);
        if (!root) throw new Error("missing source root " + folder);
        engine.storageRootManager.setDefaultRoot(root.key);
        const result = await engine.addTorrent(new Uint8Array(torrent), { storageKey: root.key });
        if (!result.torrent) throw new Error("ordinary torrent intake failed");
        if (pause) {
          const deadline = Date.now() + 90000;
          while (!result.torrent.isComplete) {
            if (Date.now() > deadline) throw new Error("old download did not complete");
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          result.torrent.userStop();
        }
        await engine.sessionPersistence.saveTorrentList();
        await engine.sessionPersistence.saveTorrentState(result.torrent);
        return { name: result.torrent.name, root: result.torrent.storageRoot?.key };
      }, request);
    case "save":
      return oldPage.evaluate(async () => {
        const engine = window.engineManager.engine;
        await engine.sessionPersistence.saveTorrentList();
        for (const torrent of engine.torrents) await engine.sessionPersistence.saveTorrentState(torrent);
        const local = await chrome.storage.local.get(null);
        if (local["session:torrents"] !== undefined) throw new Error("browser fallback wrote the source library");
        return { torrents: engine.torrents.map(torrent => ({ name: torrent.name, userState: torrent.userState, downloaded: torrent.totalDownloaded })), browser_local_session_absent: true };
      });
    case "mismatch":
      newPage = await browser.newPage();
      await newPage.goto(`chrome-extension://${newId}/companion/companion.html`);
      await newPage.getByText(/Update the JSTorrent Android app in Google Play/).waitFor({ timeout: 20000 });
      if (!(await newPage.getByRole("link", { name: "Open JSTorrent in Google Play" }).isVisible())) throw new Error("missing update action");
      await capture(newPage, "new-extension-old-android");
      await newPage.close(); newPage = undefined;
      return { new_extension_old_android: "update_required" };
    case "old-retired":
      await oldPage.waitForFunction(() => !window.engineManager?.daemonConnection, { timeout: 20000 });
      await capture(oldPage, "old-extension-new-android");
      return { old_extension_new_android: "disconnected" };
    case "open-new":
      newPage = await browser.newPage();
      await newPage.goto(`chrome-extension://${newId}/companion/companion.html`);
      return { opened: true };
    case "new-ready":
      await newPage.locator("#companion-identity").waitFor({ state: "visible", timeout: 45000 });
      for (const name of ["writer-0.bin", "writer-1.bin"]) await newPage.getByText(name, { exact: true }).first().waitFor({ timeout: 30000 });
      await capture(newPage, "new-extension-new-android");
      return { identity: await newPage.locator("#companion-identity").innerText(), migrated_library: "passed" };
    case "pause-new":
      await newPage.getByRole("row", { name: /writer-1.bin/ }).click();
      await newPage.getByRole("button", { name: "Pause", exact: true }).click();
      return { ordinary_pause_command: "sent" };
    case "close": return { closed: true };
    default: throw new Error("unknown browser phase");
  }
}
try {
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    try { process.stdout.write(JSON.stringify({ ok: true, result: await command(request) }) + "\n"); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: String(error), routes: requests, rejected, trackers: oldPage ? await oldPage.evaluate(() => window.engineManager?.engine?.torrents.map(torrent => ({ name: torrent.name, userState: torrent.userState, trackers: torrent.getTrackerStats(), tick: torrent.getTickStats() }))).catch(() => []) : [], ui: (newPage ?? oldPage) ? (await (newPage ?? oldPage).locator("body").innerText().catch(() => "")).slice(0, 4096) : "" }) + "\n"); }
    if (request.op === "close") break;
  }
} finally {
  await browser.close(); for (const socket of sockets) socket.destroy();
  await new Promise(resolve => proxy.close(resolve));
}

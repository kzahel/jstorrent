#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { createRequire } from "node:module";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const webRoot = join(repositoryRoot, "clients/web");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const targetDebug = join(repositoryRoot, "target/debug");
const sourceHeadless = join(targetDebug, `rstorrent-headless${executableSuffix}`);
const sourceGateway = join(targetDebug, `rstorrent-gateway${executableSuffix}`);
const relayExecutable = join(
  targetDebug,
  `rstorrent-remote-relay${executableSuffix}`,
);
const username = "local-owner";
const passphrase = `local-${randomBytes(24).toString("base64url")}`;
const temporaryParent = process.platform === "darwin" ? "/tmp" : tmpdir();
const temporaryRoot = await realpath(
  await mkdtemp(join(temporaryParent, "rstorrent-remote-product-")),
);
const relayRoot = join(temporaryRoot, "relay-state");
const browserRoot = join(temporaryRoot, "browser-private");
const sharedBrowserRoot = join(temporaryRoot, "browser-shared");
const certificatePem = join(temporaryRoot, "tls/certificate.pem");
const privateKeyPem = join(temporaryRoot, "tls/private-key.pem");
const certificateDer = join(temporaryRoot, "tls/certificate.der");
const privateKeyDer = join(temporaryRoot, "tls/private-key.der");
const profileRoot = join(temporaryRoot, "headless-profile");
const payloadRoot = join(temporaryRoot, "payload");
const configPath = join(temporaryRoot, "configuration/headless.toml");
const passphrasePath = join(temporaryRoot, "secrets/remote-passphrase");

let clientServer;
let relayProcess;
let headlessProcess;
let privateContext;
let sharedContext;

async function main() {
try {
  if (process.platform === "win32") {
    throw new Error("the local product runner requires the Unix headless admin socket");
  }
  const relayPort = await availablePort();
  const clientPort = await availablePort();
  const headlessPort = await availablePort();
  const relayUrl = `wss://127.0.0.1:${relayPort}/client`;
  const clientOrigin = `https://127.0.0.1:${clientPort}`;
  const buildId = `tactical-196-${gitRevision()}`;

  buildArtifacts(relayUrl, buildId);
  await createLocalCertificate();
  const installed = await createInstalledHeadlessLayout();
  let headlessCommand = installed.headless;
  await createHeadlessConfiguration(headlessPort, relayPort);
  const directFixture = prepareDirectFixture();

  clientServer = await serveRemoteClient(clientPort, relayUrl);
  relayProcess = await startRelay(relayPort, clientOrigin);
  await waitForRelayHttps(relayPort, relayProcess);
  headlessProcess = startManaged(headlessCommand, ["--config", configPath]);
  await waitForPath(join(profileRoot, "remote-admin-v1.sock"), headlessProcess);
  remoteCommand(headlessCommand, [
    "enable",
    username,
    "--passphrase-file",
    passphrasePath,
  ]);

  const browserErrors = [];
  privateContext = await launchPersistentBrowser(browserRoot, {
    width: 1365,
    height: 900,
  });
  await privateContext.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  const privatePage = await privateContext.newPage();
  privatePage.on("pageerror", (error) => browserErrors.push(String(error)));
  const response = await privatePage.goto(`${clientOrigin}/remote/`);
  assertClientHeaders(response?.headers() ?? {}, relayUrl);
  await assertImmutableAssets(privateContext, clientOrigin);
  await signIn(privatePage, true, "Owner laptop");
  await expectProduct(privatePage);
  const directSave = await saveDirectFixture(privatePage, directFixture);
  const firstAudit = remoteStatus(headlessCommand);
  assertDirectFileTerminal(firstAudit, directFixture);
  const originalClient = onlyCurrentClient(firstAudit);
  await expectRemoteAudit(privatePage, "Owner laptop");

  await privatePage.reload();
  await expectProduct(privatePage);
  await assertNoPasswordPrompt(privatePage);

  await privateContext.close();
  privateContext = undefined;
  privateContext = await launchPersistentBrowser(browserRoot, {
    width: 390,
    height: 844,
  });
  let restartedPage = await privateContext.newPage();
  restartedPage.on("pageerror", (error) => browserErrors.push(String(error)));
  await restartedPage.goto(`${clientOrigin}/remote/`);
  await expectProduct(restartedPage);
  await assertNoPasswordPrompt(restartedPage);
  await privateContext.close();
  privateContext = undefined;

  sharedContext = await launchPersistentBrowser(sharedBrowserRoot, {
    width: 390,
    height: 844,
  });
  let sharedPage = await sharedContext.newPage();
  sharedPage.on("pageerror", (error) => browserErrors.push(String(error)));
  await sharedPage.goto(`${clientOrigin}/remote/`);
  await signIn(sharedPage, false);
  await expectProduct(sharedPage);
  await sharedContext.close();
  sharedContext = undefined;
  sharedContext = await launchPersistentBrowser(sharedBrowserRoot, {
    width: 390,
    height: 844,
  });
  sharedPage = await sharedContext.newPage();
  await sharedPage.goto(`${clientOrigin}/remote/`);
  await expectPasswordPrompt(sharedPage);
  const afterShared = remoteStatus(headlessCommand);
  if (currentClients(afterShared).length !== 1) {
    throw new Error("shared browser created a durable authorization");
  }
  await sharedContext.close();
  sharedContext = undefined;

  privateContext = await launchPersistentBrowser(browserRoot, {
    width: 390,
    height: 844,
  });
  restartedPage = await privateContext.newPage();
  restartedPage.on("pageerror", (error) => browserErrors.push(String(error)));
  await restartedPage.goto(`${clientOrigin}/remote/`);
  await expectProduct(restartedPage);
  await assertNoPasswordPrompt(restartedPage);

  const automaticReload = restartedPage.waitForEvent("domcontentloaded", {
    timeout: 20_000,
  });
  await stopChild(relayProcess.child);
  relayProcess = undefined;
  relayProcess = await startRelay(relayPort, clientOrigin);
  await automaticReload;
  await expectProduct(restartedPage);
  await assertNoPasswordPrompt(restartedPage);

  const rollbackReload = restartedPage.waitForEvent("domcontentloaded", {
    timeout: 20_000,
  });
  await stopChild(headlessProcess.child);
  await rm(installed.current);
  await symlink(installed.rollbackTarget, installed.current);
  headlessCommand = installed.rollbackHeadless;
  headlessProcess = startManaged(headlessCommand, ["--config", configPath]);
  await waitForPath(join(profileRoot, "remote-admin-v1.sock"), headlessProcess);
  await rollbackReload;
  await expectProduct(restartedPage);
  await assertNoPasswordPrompt(restartedPage);

  remoteCommand(headlessCommand, ["revoke", originalClient.client_id]);
  await restartedPage.reload();
  await expectPasswordPrompt(restartedPage);
  await expectText(restartedPage, "authorization is no longer valid");
  const revokedAudit = remoteStatus(headlessCommand);
  if (currentClients(revokedAudit).length !== 0) {
    throw new Error("revoked browser remained authorized");
  }
  if (!revokedAudit.authority.tombstones.some(
    (entry) => entry.client_id === originalClient.client_id,
  )) {
    throw new Error("revocation did not retain its audit tombstone");
  }

  remoteCommand(headlessCommand, ["disable"]);
  remoteCommand(headlessCommand, [
    "recover",
    username,
    "--passphrase-file",
    passphrasePath,
  ]);
  await delay(500);
  await signIn(restartedPage, true, "Changed host attempt");
  await expectText(restartedPage, "different authenticated host identity");
  if (await restartedPage.getByRole("button", { name: "Clear old host trust" }).count() !== 1) {
    throw new Error("changed host did not require an explicit trust reset");
  }

  const resourcesBeforeFlood = processResources(
    relayProcess.child.pid,
    headlessProcess.child.pid,
  );
  const floodAttempts = 256;
  await floodInvalidRelayCircuits(restartedPage, relayUrl, floodAttempts);
  await delay(250);
  if (relayProcess.child.exitCode !== null || headlessProcess.child.exitCode !== null) {
    throw new Error("connection churn terminated a product owner");
  }
  const resourcesAfterFlood = processResources(
    relayProcess.child.pid,
    headlessProcess.child.pid,
  );

  const registrations = await restartedPage.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).length,
  );
  if (registrations !== 0) throw new Error("remote client installed a service worker");
  if (browserErrors.length !== 0) {
    throw new Error(`browser page errors: ${browserErrors.join("; ")}`);
  }

  const finalAudit = remoteStatus(headlessCommand);
  process.stdout.write(`${JSON.stringify({
    environment: {
      browser: privateContext.browser()?.version() ?? "unknown",
      headless: true,
      platform: `${platform()} ${release()} ${arch()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCpuCount: cpus().length,
      systemMemoryBytes: totalmem(),
    },
    artifacts: {
      buildId,
      remoteBundleBytes: await directoryBytes(join(webRoot, "dist")),
      clientOrigin,
      relayOrigin: `wss://127.0.0.1:${relayPort}`,
    },
    evidence: {
      privatePasswordLogin: true,
      reloadResume: true,
      browserRestartResume: true,
      phoneViewportResume: true,
      sharedBrowserDidNotPersist: true,
      relayRestartResume: true,
      packageRollbackResume: true,
      completeRemoteAuditRendered: true,
      directCompletedFileSave: directSave,
      exactRevocationRejectedResume: true,
      revocationTombstoneRetained: true,
      changedHostBlocked: true,
      invalidCircuitFloodAttempts: floodAttempts,
      resourcesBeforeFlood,
      resourcesAfterFlood,
      serviceWorkers: registrations,
      currentOwnerEvents: finalAudit.authority.events.length,
      retainedPayloadsAtRelay: 0,
    },
  }, null, 2)}\n`);
} finally {
  if (sharedContext !== undefined) await sharedContext.close().catch(() => {});
  if (privateContext !== undefined) await privateContext.close().catch(() => {});
  if (headlessProcess !== undefined) await stopChild(headlessProcess.child).catch(() => {});
  if (relayProcess !== undefined) await stopChild(relayProcess.child).catch(() => {});
  if (clientServer !== undefined) await closeServer(clientServer).catch(() => {});
  await rm(temporaryRoot, { recursive: true, force: true });
}
}

function prepareDirectFixture() {
  const result = run("cargo", [
    "run", "--quiet",
    "-p", "rstorrent-direct-file",
    "--features", "experiment",
    "--bin", "rstorrent-direct-file-experiment",
    "--",
    "--fixture-mib", "1",
    "--prepare-profile", profileRoot,
    "--payload-root", payloadRoot,
    "--profile-id", "default",
  ]).stdout.trim();
  const prefix = "RSTORRENT_DIRECT_FILE_PROFILE_READY ";
  const line = result.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) throw new Error("direct fixture preparation emitted no result");
  return JSON.parse(line.slice(prefix.length));
}

function buildArtifacts(relayUrl, buildId) {
  run("cargo", [
    "build",
    "-p", "rstorrent-remote-relay",
    "-p", "rstorrent-headless",
    "-p", "rstorrent-gateway",
  ]);
  run("npm", ["run", "build:remote", "--prefix", "clients/web"], {
    VITE_RSTORRENT_REMOTE_RELAY_URL: relayUrl,
    VITE_RSTORRENT_REMOTE_BUILD_ID: buildId,
  });
}

async function createLocalCertificate() {
  await mkdir(dirname(certificatePem), { recursive: true, mode: 0o700 });
  run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-addext", "extendedKeyUsage=serverAuth",
    "-addext", "keyUsage=digitalSignature,keyEncipherment",
    "-addext", "basicConstraints=critical,CA:FALSE",
    "-keyout", privateKeyPem,
    "-out", certificatePem,
  ]);
  run("openssl", [
    "x509", "-in", certificatePem, "-outform", "DER", "-out", certificateDer,
  ]);
  run("openssl", [
    "pkcs8", "-topk8", "-inform", "PEM", "-outform", "DER", "-nocrypt",
    "-in", privateKeyPem, "-out", privateKeyDer,
  ]);
  await chmod(privateKeyPem, 0o600);
  await chmod(privateKeyDer, 0o600);
  await chmod(certificatePem, 0o644);
  await chmod(certificateDer, 0o644);
}

async function createInstalledHeadlessLayout() {
  const versionOutput = run(sourceHeadless, ["--version"]).stdout.trim();
  const match = /^rstorrent-headless ([0-9A-Za-z.-]+)$/.exec(versionOutput);
  if (match === null) throw new Error("could not read the headless build version");
  const version = match[1];
  const versionParts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (versionParts === null || Number(versionParts[3]) === 0) {
    throw new Error("local rollback evidence requires a positive patch version");
  }
  const rollbackVersion = `${versionParts[1]}.${versionParts[2]}.${Number(versionParts[3]) - 1}`;
  const applicationRoot = join(temporaryRoot, "headless-application");
  const releaseRoot = join(applicationRoot, "versions", version);
  const binRoot = join(releaseRoot, "bin");
  const web = join(releaseRoot, "web");
  await mkdir(binRoot, { recursive: true, mode: 0o700 });
  await mkdir(web, { recursive: true, mode: 0o700 });
  const headless = join(binRoot, "rstorrent-headless");
  await copyFile(sourceHeadless, headless);
  await copyFile(sourceGateway, join(binRoot, "rstorrent-gateway"));
  await chmod(headless, 0o700);
  await chmod(join(binRoot, "rstorrent-gateway"), 0o700);
  await writeProtected(join(releaseRoot, "VERSION"), version, 0o600);
  await writeProtected(
    join(releaseRoot, "PACKAGE_ID"),
    "com.jstorrent.rstorrent.headless",
    0o600,
  );
  await writeProtected(join(web, "index.html"), "<!doctype html><title>local</title>", 0o600);
  const rollbackRoot = join(applicationRoot, "versions", rollbackVersion);
  const rollbackBin = join(rollbackRoot, "bin");
  const rollbackWeb = join(rollbackRoot, "web");
  await mkdir(rollbackBin, { recursive: true, mode: 0o700 });
  await mkdir(rollbackWeb, { recursive: true, mode: 0o700 });
  const rollbackHeadless = join(rollbackBin, "rstorrent-headless");
  await copyFile(sourceHeadless, rollbackHeadless);
  await copyFile(sourceGateway, join(rollbackBin, "rstorrent-gateway"));
  await chmod(rollbackHeadless, 0o700);
  await chmod(join(rollbackBin, "rstorrent-gateway"), 0o700);
  await writeProtected(join(rollbackRoot, "VERSION"), rollbackVersion, 0o600);
  await writeProtected(
    join(rollbackRoot, "PACKAGE_ID"),
    "com.jstorrent.rstorrent.headless",
    0o600,
  );
  await writeProtected(
    join(rollbackWeb, "index.html"),
    "<!doctype html><title>local rollback</title>",
    0o600,
  );
  const current = join(applicationRoot, "current");
  await symlink(join("versions", version), current);
  return {
    current,
    headless,
    rollbackHeadless,
    rollbackTarget: join("versions", rollbackVersion),
    version,
  };
}

async function createHeadlessConfiguration(headlessPort, relayPort) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await mkdir(dirname(passphrasePath), { recursive: true, mode: 0o700 });
  await mkdir(payloadRoot, { recursive: true, mode: 0o700 });
  await writeProtected(passphrasePath, passphrase, 0o600);
  const configuration = `version = 3
profile_root = ${tomlString(profileRoot)}
listen = "127.0.0.1:${headlessPort}"
public_origin = "http://127.0.0.1:${headlessPort}"

[[storage_roots]]
id = "downloads"
label = "Downloads"
path = ${tomlString(payloadRoot)}

[authentication]
mode = "local-browser"

[remote_validation]
relay_base = "https://127.0.0.1:${relayPort}/"
certificate_file = ${tomlString(certificateDer)}
`;
  await writeProtected(configPath, configuration, 0o600);
}

async function startRelay(port, clientOrigin) {
  const process = new LineProcess(relayExecutable, [
    "--root", relayRoot,
    "--listen", `127.0.0.1:${port}`,
    "--client-origin", clientOrigin,
    "--certificate-der", certificateDer,
    "--private-key-der", privateKeyDer,
  ]);
  const line = await process.start();
  const ready = JSON.parse(line);
  if (ready.event !== "ready" || ready.address !== `127.0.0.1:${port}`) {
    throw new Error("relay emitted an invalid readiness record");
  }
  return process;
}

async function waitForRelayHttps(port, relay) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (relay.child.exitCode !== null) {
      throw new Error(`relay exited before TLS readiness: ${relay.stderr}`);
    }
    const result = spawnSync("curl", [
      "--silent",
      "--show-error",
      "--cacert", certificatePem,
      "--connect-timeout", "1",
      "--max-time", "2",
      "--output", "/dev/null",
      "--write-out", "%{http_code}",
      `https://127.0.0.1:${port}/not-found`,
    ], { cwd: repositoryRoot, encoding: "utf8" });
    if (result.status === 0 && result.stdout === "404") return;
    await delay(25);
  }
  throw new Error(`relay TLS listener did not become ready: ${relay.stderr}`);
}

async function serveRemoteClient(port, relayUrl) {
  const dist = join(webRoot, "dist");
  const key = await readFile(privateKeyPem);
  const cert = await readFile(certificatePem);
  const relayOrigin = new URL(relayUrl).origin;
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${relayOrigin}`,
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "worker-src 'none'",
  ].join("; ");
  const server = createHttpsServer({ key, cert }, async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "https://local").pathname);
      const requested = pathname === "/" || pathname === "/remote/"
        ? "/remote/index.html"
        : pathname;
      const candidate = resolve(dist, `.${normalize(requested)}`);
      const pathRelative = relative(dist, candidate);
      if (pathRelative.startsWith(`..${sep}`) || pathRelative === "..") {
        response.writeHead(404).end();
        return;
      }
      const metadata = await stat(candidate);
      if (!metadata.isFile()) throw new Error("not a file");
      response.setHeader("Content-Security-Policy", csp);
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Type", contentType(candidate));
      response.setHeader(
        "Cache-Control",
        requested.startsWith("/remote/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
      response.writeHead(200).end(await readFile(candidate));
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" }).end();
    }
  });
  await listen(server, port);
  return server;
}

async function launchPersistentBrowser(profile, viewport) {
  const requireFromWeb = createRequire(join(webRoot, "package.json"));
  const { chromium } = requireFromWeb("playwright");
  const options = {
    headless: true,
    ignoreHTTPSErrors: true,
    viewport,
    colorScheme: "dark",
    reducedMotion: "reduce",
  };
  return chromium.launchPersistentContext(profile, options);
}

async function signIn(page, privateBrowser, label = "") {
  await expectPasswordPrompt(page);
  await page.getByLabel("Route username").fill(username);
  await page.locator('input[type="password"]').fill(passphrase);
  if (!privateBrowser) {
    await page.getByText("Shared", { exact: true }).click();
  } else if (label !== "") {
    await page.getByLabel("Browser name shown to the operator").fill(label);
  }
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectProduct(page) {
  try {
    await page.getByRole("button", { name: "Settings" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
  } catch {
    throw new Error(`remote product did not open: ${await page.locator("body").innerText()}`);
  }
}

async function expectPasswordPrompt(page) {
  try {
    await page.locator('input[type="password"]').waitFor({
      state: "visible",
      timeout: 20_000,
    });
  } catch {
    throw new Error(`password prompt did not appear: ${await page.locator("body").innerText()}`);
  }
}

async function assertNoPasswordPrompt(page) {
  if (await page.locator('input[type="password"]').isVisible()) {
    throw new Error("automatic resume fell back to the password form");
  }
}

async function expectRemoteAudit(page, label) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Remote access" }).click();
  await expectText(page, "Authorized browsers");
  await expectText(page, label);
  await expectText(page, "This browser");
  await expectText(page, "Current security ledger");
  await expectText(page, "direct file completed");
  if (await page.getByText("Change password", { exact: true }).count() !== 0) {
    throw new Error("remote audit exposed the local password-change operation");
  }
  await page.getByRole("button", { name: "Close settings" }).click();
}

async function saveDirectFixture(page, prepared) {
  const fixture = prepared.fixture;
  await page.getByRole("button", { name: "Torrents", exact: true }).click();
  const torrentGrid = page.getByRole("grid", { name: "Torrents", exact: true });
  await torrentGrid.getByText(fixture.file_name, { exact: true }).click();
  await page.getByRole("tab", { name: "Files" }).click();
  const fileGrid = page.getByRole("grid", { name: "Torrent files" });
  await fileGrid.getByText(fixture.file_name, { exact: true }).click();
  await page.getByRole("button", { name: "More file actions" }).click();
  const action = page.getByRole("menuitem", { name: "Save file…" });
  await action.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    (element) => element.getAttribute("aria-disabled") !== "true",
    await action.elementHandle(),
    { timeout: 20_000 },
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await action.click();
  const download = await downloadPromise.catch(async (error) => {
    throw new Error(
      `direct save produced no browser download: ${error}; UI=${await page.locator("body").innerText()}`,
    );
  });
  const failure = await download.failure();
  if (failure !== null) throw new Error(`direct fallback save failed: ${failure}`);
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("direct fallback save exposed no bytes");
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  const sha256 = digest.digest("hex");
  if (download.suggestedFilename() !== fixture.file_name) {
    throw new Error("direct save changed the fixture file name");
  }
  if (bytes !== fixture.length || sha256 !== fixture.sha256) {
    throw new Error("direct save bytes differed from the verified fixture");
  }
  await expectText(page, "Remote file saved.");
  return { bytes, sha256, sink: "bounded_blob_fallback" };
}

function assertDirectFileTerminal(status, prepared) {
  const direct = status.direct_file;
  if (
    direct?.state !== "idle" ||
    direct.active_circuit_id !== null ||
    direct.active_tasks !== 0 ||
    direct.open_sockets !== 0 ||
    direct.active_requests !== 0 ||
    direct.queued_bytes !== 0
  ) {
    throw new Error(`direct transfer retained resources: ${JSON.stringify(direct)}`);
  }
  const completed = status.authority.events.find(
    (event) => event.kind === "direct_file_completed" &&
      event.direct_file?.torrent_id === prepared.torrent_id,
  );
  if (
    completed === undefined ||
    completed.direct_file.file_index !== 0 ||
    completed.direct_file.byte_count !== prepared.fixture.length
  ) {
    throw new Error("direct transfer audit omitted the completed fixture");
  }
}

function remoteStatus(headless) {
  return JSON.parse(remoteCommand(headless, ["status"]).stdout);
}

function remoteCommand(headless, arguments_) {
  return run(headless, ["remote", "--config", configPath, ...arguments_]);
}

function currentClients(status) {
  return status.authority?.clients ?? [];
}

function onlyCurrentClient(status) {
  const clients = currentClients(status);
  if (clients.length !== 1) throw new Error(`expected one authorization, found ${clients.length}`);
  return clients[0];
}

function assertClientHeaders(headers, relayUrl) {
  const csp = headers["content-security-policy"] ?? "";
  const relayOrigin = new URL(relayUrl).origin;
  for (const required of [
    "default-src 'self'",
    `connect-src 'self' ${relayOrigin}`,
    "script-src 'self' 'wasm-unsafe-eval'",
    "object-src 'none'",
    "worker-src 'none'",
  ]) {
    if (!csp.includes(required)) throw new Error(`remote client CSP omitted ${required}`);
  }
  if (headers["cache-control"] !== "no-store") {
    throw new Error("remote HTML is not served no-store");
  }
}

async function assertImmutableAssets(context, clientOrigin) {
  const html = await readFile(join(webRoot, "dist/remote/index.html"), "utf8");
  const asset = html.match(/(?:src|href)="(\/remote\/assets\/[^"]+)"/)?.[1];
  if (asset === undefined) throw new Error("remote HTML references no hashed asset");
  const response = await context.request.get(`${clientOrigin}${asset}`);
  if (!response.ok()) throw new Error("remote hashed asset was unavailable");
  if (response.headers()["cache-control"] !== "public, max-age=31536000, immutable") {
    throw new Error("remote hashed asset is not served immutable");
  }
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
}

async function floodInvalidRelayCircuits(page, relayUrl, attempts) {
  await page.evaluate(
    async ({ attempts, relayUrl }) => {
      const connect = () => new Promise((resolveAttempt) => {
        const socket = new WebSocket(relayUrl);
        const timer = window.setTimeout(() => {
          socket.close();
          resolveAttempt(undefined);
        }, 2_000);
        const complete = () => {
          window.clearTimeout(timer);
          resolveAttempt(undefined);
        };
        socket.binaryType = "arraybuffer";
        socket.onopen = () => socket.send(Uint8Array.of(0xff));
        socket.onerror = complete;
        socket.onclose = complete;
      });
      for (let offset = 0; offset < attempts; offset += 32) {
        await Promise.all(
          Array.from({ length: Math.min(32, attempts - offset) }, connect),
        );
      }
    },
    { attempts, relayUrl },
  );
}

function processResources(relayPid, headlessPid) {
  return {
    relay: processResource(relayPid),
    headless: processResource(headlessPid),
  };
}

function processResource(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw new Error("invalid process ID");
  const output = run("ps", ["-o", "rss=,%cpu=", "-p", String(pid)]).stdout.trim();
  const match = /^(\d+)\s+([0-9.]+)$/.exec(output);
  if (match === null) throw new Error(`invalid process resource sample: ${output}`);
  return {
    residentBytes: Number(match[1]) * 1024,
    cpuPercentSample: Number(match[2]),
  };
}

function startManaged(command, arguments_) {
  const child = spawn(command, arguments_, {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const process = { child, stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { process.stdout = bounded(process.stdout + chunk); });
  return process;
}

class LineProcess {
  constructor(command, arguments_) {
    this.command = command;
    this.arguments = arguments_;
    this.lines = [];
    this.waiters = [];
    this.stderr = "";
  }

  async start() {
    this.child = spawn(this.command, this.arguments, {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr = bounded(this.stderr + chunk); });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter === undefined) this.lines.push(line);
      else waiter.resolve(line);
    });
    this.child.once("error", (error) => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    });
    return Promise.race([
      this.nextLine(),
      delay(10_000).then(() => { throw new Error(`relay readiness timed out: ${this.stderr}`); }),
    ]);
  }

  nextLine() {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolveLine, rejectLine) => {
      this.waiters.push({ resolve: resolveLine, reject: rejectLine });
    });
  }
}

function run(command, arguments_, environment = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} failed with status ${result.status}; host=${headlessProcess?.stderr ?? ""}`);
  }
  return result;
}

function gitRevision() {
  return run("git", ["rev-parse", "--short=12", "HEAD"]).stdout.trim();
}

async function writeProtected(path, contents, mode) {
  await writeFile(path, contents, { encoding: "utf8", mode });
  await chmod(path, mode);
}

function tomlString(value) {
  return JSON.stringify(value);
}

async function availablePort() {
  const server = createTcpServer();
  await listen(server, 0);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no TCP port");
  await closeServer(server);
  return address.port;
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
  });
}

async function waitForPath(path, managed) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (managed.child.exitCode !== null) {
      throw new Error(`headless host exited early: ${managed.stderr}`);
    }
    try {
      const metadata = await lstat(path);
      if (metadata.isSocket()) return;
    } catch {
      // The headless owner has not bound its administration socket yet.
    }
    await delay(25);
  }
  throw new Error(`headless administration socket timed out: ${managed.stderr}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(child, 5_000);
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
  }
}

function waitForExit(child, timeoutMillis) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, rejectTimeout) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      rejectTimeout(new Error("child exit timed out"));
    }, timeoutMillis);
    const onExit = (code) => {
      clearTimeout(timer);
      resolveExit(code);
    };
    child.once("exit", onExit);
  });
}

function contentType(path) {
  return new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".wasm", "application/wasm"],
  ]).get(extname(path)) ?? "application/octet-stream";
}

async function directoryBytes(root) {
  const entries = await import("node:fs/promises").then(({ readdir }) =>
    readdir(root, { withFileTypes: true }),
  );
  let bytes = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return bytes;
}

function bounded(value) {
  return value.length <= 64 * 1024 ? value : value.slice(-64 * 1024);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

await main();

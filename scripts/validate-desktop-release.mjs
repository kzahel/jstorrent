#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPECTED_IDENTIFIER = "com.jstorrent.rstorrent";
const EXPECTED_ENDPOINT =
  "https://updates.graehlarts.com/rstorrent/tauri/{{target}}/{{arch}}/{{current_version}}";
const EXPECTED_PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc4OEE3ODUxMzEzNjcwOTYKUldTV2NEWXhVWGlLZUpKK0trSG5XZ09qQ1ZPVFo2ZGV0MC9Cc001UWlGSCtvaE1iNDY0RmNRZkwK";
const EXPECTED_TORRENT_FILE_CLASS = "com.jstorrent.rstorrent.torrent";

function fail(message) {
  throw new Error(message);
}

function cargoVersion(contents) {
  const packageSection = contents.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) fail("desktop Cargo.toml has no package version");
  return version;
}

export function validateDesktopReleaseConfiguration({
  packageJson,
  tauri,
  developmentTauri,
  packageTauri,
  releaseTauri,
  cargo,
  capability,
  desktopMain,
  desktopSource,
  desktopPower,
  nativeHostRegistration,
  prepareNativeHost,
  nsisHooks,
  linuxDesktop,
  tauriUpdater,
  product,
  changelog,
  tag,
}) {
  const versions = {
    web: packageJson.version,
    tauri: tauri.version,
    cargo: cargoVersion(cargo),
  };
  if (new Set(Object.values(versions)).size !== 1) {
    fail(`desktop version drift: ${JSON.stringify(versions)}`);
  }
  if (!/^default-run\s*=\s*"jstorrent-client"$/m.test(cargo) ||
      !/\[\[bin\]\]\s*name\s*=\s*"jstorrent-client"\s*path\s*=\s*"src\/main\.rs"/u.test(cargo)) {
    fail("desktop output must be jstorrent-client without changing the Rust package");
  }
  for (const config of [tauri, developmentTauri, packageTauri, releaseTauri]) {
    if (config.mainBinaryName !== undefined) {
      fail("desktop overlays must not override the branded Cargo executable");
    }
  }
  const version = tauri.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`desktop version is not stable semver: ${version}`);
  }
  if (tag !== undefined && tag !== `desktop-v${version}` && tag !== `desktop-latest-v${version}`) {
    fail(`desktop tag ${tag} does not match version ${version}`);
  }
  if (!changelog.includes(`## [${version}]`)) {
    fail(`CHANGELOG.md has no ${version} entry`);
  }
  if (tauri.productName !== "JSTorrent Preview") {
    fail(`unexpected desktop product name: ${tauri.productName}`);
  }
  if (tauri.identifier !== EXPECTED_IDENTIFIER) {
    fail(`unexpected desktop identifier: ${tauri.identifier}`);
  }
  if (developmentTauri.identifier !== EXPECTED_IDENTIFIER) {
    fail(`development identifier drift: ${developmentTauri.identifier}`);
  }
  if (tauri.bundle?.createUpdaterArtifacts !== false) {
    fail("base config must leave updater artifacts disabled until release CI");
  }
  const expectedExternalBinary = ["binaries/rstorrent-native-host"];
  const expectedResources = { "binaries/notices/": "notices/" };
  if (tauri.bundle?.resources !== undefined) {
    fail("base package must not add unreviewed resources");
  }
  for (const overlay of [packageTauri, releaseTauri]) {
    if (overlay.bundle?.useLocalToolsDir !== true ||
        overlay.build?.beforeBundleCommand !== "node ../../scripts/prepare-appimage-notices.mjs") {
      fail("package overlays must preserve the project-local native notice hook");
    }
    if (JSON.stringify(overlay.bundle?.resources) !== JSON.stringify(expectedResources)) {
      fail("package resources must contain only the reviewed dependency notices");
    }
  }
  const expectedBeforeBuild =
    "node ../../scripts/prepare-native-host.mjs --release && npm --prefix ../web run build && node ../../scripts/prepare-release-notices.mjs";
  if (
    JSON.stringify(packageTauri.bundle?.externalBin) !==
      JSON.stringify(expectedExternalBinary) ||
    packageTauri.build?.beforeBuildCommand !== expectedBeforeBuild ||
    packageTauri.bundle?.createUpdaterArtifacts !== undefined
  ) {
    fail("unsigned package overlay must prepare and embed only the native host sidecar");
  }
  if (
    JSON.stringify(releaseTauri.bundle?.externalBin) !==
      JSON.stringify(expectedExternalBinary) ||
    releaseTauri.build?.beforeBuildCommand !== expectedBeforeBuild ||
    releaseTauri.bundle?.createUpdaterArtifacts !== true
  ) {
    fail("release package overlay must prepare the native host and updater artifacts");
  }
  if (tauri.bundle?.windows?.nsis?.installMode !== "currentUser") {
    fail("Windows NSIS must use currentUser installation");
  }
  if (tauri.bundle?.windows?.nsis?.installerHooks !== "./nsis/hooks.nsh") {
    fail("Windows NSIS must use the reviewed association installer hook");
  }
  for (const packageType of ["deb", "rpm"]) {
    if (
      tauri.bundle?.linux?.[packageType]?.desktopTemplate !==
      "./linux/rstorrent.desktop"
    ) {
      fail(`Linux ${packageType} must use the reviewed activation desktop template`);
    }
  }
  if (
    !linuxDesktop.includes("Exec={{exec}} %U") ||
    !linuxDesktop.includes("MimeType={{mime_type}};") ||
    !linuxDesktop.includes("Terminal=false")
  ) {
    fail("Linux desktop handler must forward URLs/files and remain a GUI application");
  }
  const expectedFileAssociations = [
    {
      ext: ["torrent"],
      name: EXPECTED_TORRENT_FILE_CLASS,
      mimeType: "application/x-bittorrent",
      exportedType: {
        identifier: EXPECTED_TORRENT_FILE_CLASS,
        conformsTo: ["public.data"],
      },
      description: "BitTorrent metainfo file",
    },
  ];
  if (
    JSON.stringify(tauri.bundle?.fileAssociations) !==
    JSON.stringify(expectedFileAssociations)
  ) {
    fail(`unexpected desktop torrent file association: ${JSON.stringify(tauri.bundle?.fileAssociations)}`);
  }
  const schemes = tauri.plugins?.["deep-link"]?.desktop?.schemes;
  if (JSON.stringify(schemes) !== JSON.stringify(["magnet"])) {
    fail(`unexpected desktop deep-link schemes: ${JSON.stringify(schemes)}`);
  }
  const quotedTorrentCommand =
    '$\\"$INSTDIR\\${MAINBINARYNAME}.exe$\\" $\\"%1$\\"';
  if (
    !nsisHooks.includes(
      `Software\\Classes\\${EXPECTED_TORRENT_FILE_CLASS}\\shell\\open\\command`,
    ) ||
    !nsisHooks.includes(quotedTorrentCommand)
  ) {
    fail("Windows torrent file command must quote the executable and input path");
  }
  const endpoints = tauri.plugins?.updater?.endpoints;
  if (
    !Array.isArray(endpoints) ||
    endpoints.length !== 1 ||
    endpoints[0] !== EXPECTED_ENDPOINT
  ) {
    fail(`unexpected updater endpoint: ${JSON.stringify(endpoints)}`);
  }
  if (tauri.plugins?.updater?.pubkey !== EXPECTED_PUBLIC_KEY) {
    fail("unexpected RSTorrent updater public key");
  }
  const decodedPublicKey = Buffer.from(EXPECTED_PUBLIC_KEY, "base64").toString("utf8");
  if (
    !decodedPublicKey.startsWith("untrusted comment: minisign public key") ||
    !decodedPublicKey.includes("\nRW")
  ) {
    fail("RSTorrent updater public key is malformed");
  }
  const entries = capability.permissions ?? [];
  const permissions = new Set(entries.map(permission =>
    typeof permission === "string" ? permission : permission?.identifier));
  if (!permissions.has("updater:default")) {
    fail("missing desktop permission updater:default");
  }
  if (permissions.has("process:default")) {
    fail("raw process restart permission must stay disabled");
  }
  if ([...permissions].some((permission) => typeof permission === "string" && permission.startsWith("notification:"))) {
    fail("webview notification permissions must stay disabled");
  }
  const approvedUrls = [
    "https://github.com/kzahel/jstorrent/issues",
    "https://github.com/kzahel/jstorrent/issues/new",
    "https://github.com/kzahel/jstorrent/blob/main/docs/user-support.md",
    "https://github.com/kzahel/jstorrent/releases/latest",
    "https://github.com/kzahel/jstorrent/releases/tag/*",
  ];
  const scoped = entries.filter(permission => typeof permission !== "string");
  if (scoped.length !== 1 || scoped[0]?.identifier !== "opener:allow-open-url" ||
      Object.keys(scoped[0]).sort().join() !== "allow,identifier" ||
      !Array.isArray(scoped[0].allow) || scoped[0].allow.length !== approvedUrls.length ||
      scoped[0].allow.some((entry, index) => Object.keys(entry ?? {}).join() !== "url" ||
        entry.url !== approvedUrls[index]) ||
      [...permissions].some(permission => typeof permission === "string" &&
        permission.startsWith("opener:") && permission !== "opener:allow-open-url")) {
    fail("desktop external links must retain the exact scoped opener permission");
  }
  if (!cargo.includes("tauri-plugin-updater =")) {
    fail("missing Rust dependency tauri-plugin-updater");
  }
  if (!cargo.includes('tauri-plugin-deep-link = "=2.4.9"')) {
    fail("missing pinned Rust dependency tauri-plugin-deep-link 2.4.9");
  }
  if (!cargo.includes('tauri-plugin-notification = "=2.3.3"')) {
    fail("notification dependency must stay pinned to 2.3.3");
  }
  if (!cargo.includes('notify-rust = "=4.18.0"')) {
    fail("Linux notification dependency must stay pinned to 4.18.0");
  }
  if (!cargo.includes('keepawake = "=0.6.1"')) {
    fail("macOS and Windows keepawake dependency must stay pinned to 0.6.1");
  }
  if (!cargo.includes('zbus = "=5.19.0"')) {
    fail("Linux portal dependency must stay pinned to 5.19.0");
  }
  if (!cargo.includes('rstorrent-native-host = { path = "../../../crates/rstorrent-native-host" }')) {
    fail("desktop must depend on the bounded native bootstrap contract");
  }
  if (!cargo.includes('winreg = "=0.55.0"')) {
    fail("Windows native host registration dependency must stay pinned to 0.55.0");
  }
  if (
    !cargo.includes(
      'tauri-plugin-single-instance = { version = "=2.4.3", features = ["deep-link"] }',
    )
  ) {
    fail("single-instance dependency must use its compatible deep-link integration");
  }
  if (packageJson.dependencies?.["@tauri-apps/plugin-updater"] === undefined) {
    fail("missing web dependency for tauri-plugin-updater");
  }
  if (packageJson.dependencies?.["@tauri-apps/plugin-notification"] !== undefined) {
    fail("webview notification package must stay absent");
  }
  if (
    cargo.includes("tauri-plugin-process =") ||
    packageJson.dependencies?.["@tauri-apps/plugin-process"] !== undefined
  ) {
    fail("updater restart must not bypass joined native shutdown");
  }
  if (
    !desktopSource.includes("async fn application_restart(") ||
    !desktopSource.includes("application_restart,") ||
    !desktopSource.includes("app.request_restart();")
  ) {
    fail("desktop joined restart command is missing");
  }
  if (!tauriUpdater.includes('relaunch: () => invoke("application_restart")')) {
    fail("web updater does not use joined native restart");
  }
  if (
    !desktopMain.includes(
      '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]',
    )
  ) {
    fail("release desktop binary must use the Windows GUI subsystem");
  }
  const singleInstancePlugin = desktopSource.indexOf(
    ".plugin(single_instance_plugin())",
  );
  const deepLinkPlugin = desktopSource.indexOf(
    ".plugin(tauri_plugin_deep_link::init())",
  );
  if (
    !desktopSource.includes(".plugin(tauri_plugin_notification::init())") ||
    !desktopSource.includes("fn desktop_notification_settings(") ||
    !desktopSource.includes("fn desktop_set_notification_settings(") ||
    !desktopSource.includes("async fn run_notification_owner(") ||
    !desktopSource.includes("notify_rust::Notification::new()") ||
    !desktopSource.includes("MAX_ACTIVE_NOTIFICATION_ACTIVATIONS")
  ) {
    fail("Rust-owned desktop notification integration is incomplete");
  }
  if (
    !desktopSource.includes("fn desktop_power_settings(") ||
    !desktopSource.includes("fn desktop_set_power_settings(") ||
    !desktopSource.includes("async fn run_power_owner(") ||
    !desktopSource.includes("DesktopPowerWorker::spawn()") ||
    !desktopPower.includes("TorrentOperationalState::Starting") ||
    !desktopPower.includes("TorrentOperationalState::Downloading") ||
    !desktopPower.includes("TorrentOperationalState::Checking") ||
    !desktopPower.includes("keepawake::Builder::default()") ||
    !desktopPower.includes('const SUSPEND: u32 = 4;') ||
    !desktopPower.includes('.call("Inhibit", &(') ||
    !desktopPower.includes('.call::<_, _, ()>("Close", &())')
  ) {
    fail("Rust-owned desktop automatic-sleep inhibition is incomplete");
  }
  if (
    !desktopSource.includes("mod native_host_registration;") ||
    !desktopSource.includes("repair_native_host_registration(") ||
    !desktopSource.includes(
      "let appimage = app.env().appimage.map(PathBuf::from);",
    ) ||
    !desktopSource.includes("appimage.as_deref()") ||
    !nativeHostRegistration.includes('const PRODUCTION_EXTENSION_ORIGIN: &str =') ||
    !nativeHostRegistration.includes("dbokmlpefliilbjldladbimlcfgbolhk") ||
    !nativeHostRegistration.includes('const BETA_EXTENSION_ORIGIN: &str =') ||
    !nativeHostRegistration.includes("gcgoepclopkgijmclmlheafaglmbjlcc") ||
    !nativeHostRegistration.includes('const HOST_DIRECTORY: &str = "native-host";') ||
    !nativeHostRegistration.includes("register_windows_manifest(&stable_manifest)") ||
    !prepareNativeHost.includes('"build", "-p", "rstorrent-native-host"') ||
    !prepareNativeHost.includes("RSTORRENT_NATIVE_HOST_TARGET")
  ) {
    fail("desktop native host registration and target-triple packaging are incomplete");
  }
  for (const exactUninstallEntry of [
    "Software\\Google\\Chrome\\NativeMessagingHosts\\com.jstorrent.rstorrent.native",
    "Software\\Chromium\\NativeMessagingHosts\\com.jstorrent.rstorrent.native",
    "$APPDATA\\com.jstorrent.rstorrent\\native-host",
  ]) {
    if (!nsisHooks.includes(exactUninstallEntry)) {
      fail(`Windows native host cleanup is missing ${exactUninstallEntry}`);
    }
  }
  if (
    singleInstancePlugin < 0 ||
    deepLinkPlugin < 0 ||
    singleInstancePlugin > deepLinkPlugin
  ) {
    fail("single-instance must be registered before the deep-link plugin");
  }
  for (const requiredSource of [
    ".deep_link().get_current()",
    ".deep_link().on_open_url(",
    ".deep_link()\n                    .register_all()",
    "RunEvent::Opened { urls }",
    'url.scheme().eq_ignore_ascii_case("magnet")',
    "handle_external_activation_values(handle, urls.iter().map(url::Url::as_str));",
  ]) {
    if (!desktopSource.includes(requiredSource)) {
      fail(`desktop external activation integration is missing ${requiredSource}`);
    }
  }

  const expectedProduct = {
    id: "rstorrent",
    displayName: "JSTorrent Preview",
    hostnames: ["updates.graehlarts.com"],
    pathPrefix: "/rstorrent",
    githubRepo: "kzahel/jstorrent",
    tagPrefix: "desktop-v",
    tauriUpdates: true,
    channels: {
      stable: {
        displayName: "Stable",
        tagPrefix: "desktop-v",
        releaseKind: "release",
        requiredAsset: "RSTorrent_x64.app.tar.gz",
      },
      latest: {
        displayName: "Latest",
        tagPrefix: "desktop-latest-v",
        releaseKind: "prerelease",
        requiredAsset: "RSTorrent_x64.app.tar.gz",
      },
    },
  };
  if (JSON.stringify(product) !== JSON.stringify(expectedProduct)) {
    fail(`unexpected updater product config: ${JSON.stringify(product)}`);
  }
  return { version, endpoint: EXPECTED_ENDPOINT };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function validateDesktopReleaseRepository(root, tag) {
  return validateDesktopReleaseConfiguration({
    packageJson: readJson(path.join(root, "clients", "web", "package.json")),
    tauri: readJson(
      path.join(root, "clients", "desktop", "src-tauri", "tauri.conf.json"),
    ),
    developmentTauri: readJson(
      path.join(root, "clients", "desktop", "src-tauri", "tauri.dev.conf.json"),
    ),
    packageTauri: readJson(
      path.join(root, "clients", "desktop", "src-tauri", "tauri.package.conf.json"),
    ),
    releaseTauri: readJson(
      path.join(root, "clients", "desktop", "src-tauri", "tauri.release.conf.json"),
    ),
    cargo: fs.readFileSync(
      path.join(root, "clients", "desktop", "src-tauri", "Cargo.toml"),
      "utf8",
    ),
    capability: readJson(
      path.join(
        root,
        "clients",
        "desktop",
        "src-tauri",
        "capabilities",
        "default.json",
      ),
    ),
    desktopMain: fs.readFileSync(
      path.join(root, "clients", "desktop", "src-tauri", "src", "main.rs"),
      "utf8",
    ),
    desktopSource: fs.readFileSync(
      path.join(root, "clients", "desktop", "src-tauri", "src", "lib.rs"),
      "utf8",
    ),
    desktopPower: fs.readFileSync(
      path.join(root, "clients", "desktop", "src-tauri", "src", "desktop_power.rs"),
      "utf8",
    ),
    nativeHostRegistration: fs.readFileSync(
      path.join(
        root,
        "clients",
        "desktop",
        "src-tauri",
        "src",
        "native_host_registration.rs",
      ),
      "utf8",
    ),
    prepareNativeHost: fs.readFileSync(
      path.join(root, "scripts", "prepare-native-host.mjs"),
      "utf8",
    ),
    nsisHooks: fs.readFileSync(
      path.join(root, "clients", "desktop", "src-tauri", "nsis", "hooks.nsh"),
      "utf8",
    ),
    linuxDesktop: fs.readFileSync(
      path.join(
        root,
        "clients",
        "desktop",
        "src-tauri",
        "linux",
        "rstorrent.desktop",
      ),
      "utf8",
    ),
    tauriUpdater: fs.readFileSync(
      path.join(root, "clients", "web", "src", "tauri-updater.ts"),
      "utf8",
    ),
    product: readJson(path.join(root, "update-server", "rstorrent.json")),
    changelog: fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
    tag,
  });
}

function parseTag(argv) {
  if (argv.length === 0) return undefined;
  if (argv.length === 2 && argv[0] === "--tag") return argv[1];
  fail("usage: validate-desktop-release.mjs [--tag desktop-vX.Y.Z]");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const result = validateDesktopReleaseRepository(root, parseTag(process.argv.slice(2)));
    console.log(`Validated RSTorrent desktop release configuration ${result.version}`);
  } catch (error) {
    console.error(`Desktop release configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

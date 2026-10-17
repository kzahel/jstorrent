import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  validateDesktopReleaseConfiguration,
  validateDesktopReleaseRepository,
} from "./validate-desktop-release.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("accepts the checked-in desktop release configuration", () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, "clients/desktop/src-tauri/tauri.conf.json"), "utf8")).version;
  assert.equal(validateDesktopReleaseRepository(root).version, version);
  assert.equal(
    validateDesktopReleaseRepository(root, `desktop-v${version}`).version,
    version,
  );
  assert.equal(validateDesktopReleaseRepository(root, `desktop-latest-v${version}`).version, version);
});

test("rejects identifier and version drift", () => {
  const fixture = repositoryFixture();
  fixture.tauri.identifier = "org.example.wrong";
  assert.throws(
    () => validateDesktopReleaseConfiguration(fixture),
    /unexpected desktop identifier/,
  );

  const versionFixture = repositoryFixture();
  versionFixture.packageJson.version = "9.9.9";
  assert.throws(
    () => validateDesktopReleaseConfiguration(versionFixture),
    /desktop version drift/,
  );
});

test("rejects updater route and public-key drift", () => {
  const endpointFixture = repositoryFixture();
  endpointFixture.tauri.plugins.updater.endpoints[0] = "https://example.test";
  assert.throws(
    () => validateDesktopReleaseConfiguration(endpointFixture),
    /unexpected updater endpoint/,
  );

  const keyFixture = repositoryFixture();
  keyFixture.tauri.plugins.updater.pubkey = "wrong";
  assert.throws(
    () => validateDesktopReleaseConfiguration(keyFixture),
    /unexpected RSTorrent updater public key/,
  );
});

test("rejects updater installation that bypasses native shutdown", () => {
  const permissionFixture = repositoryFixture();
  permissionFixture.capability.permissions.push("process:default");
  assert.throws(
    () => validateDesktopReleaseConfiguration(permissionFixture),
    /raw process restart permission must stay disabled/,
  );

  const webFixture = repositoryFixture();
  webFixture.tauriUpdater = webFixture.tauriUpdater.replace(
    'invoke("desktop_install_update"',
    'invoke("raw_install_update"',
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(webFixture),
    /web updater does not use native update installation/,
  );
});

test("rejects a release desktop binary with a Windows console", () => {
  const fixture = repositoryFixture();
  fixture.desktopMain = "fn main() {}";
  assert.throws(
    () => validateDesktopReleaseConfiguration(fixture),
    /release desktop binary must use the Windows GUI subsystem/,
  );
});

test("rejects native host package or registration drift", () => {
  const packageFixture = repositoryFixture();
  packageFixture.packageTauri.bundle.externalBin = ["binaries/wrong-host"];
  assert.throws(
    () => validateDesktopReleaseConfiguration(packageFixture),
    /unsigned package overlay must prepare and embed only the native host sidecar/,
  );

  const registrationFixture = repositoryFixture();
  registrationFixture.nativeHostRegistration =
    registrationFixture.nativeHostRegistration.replace(
      "dbokmlpefliilbjldladbimlcfgbolhk",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  assert.throws(
    () => validateDesktopReleaseConfiguration(registrationFixture),
    /desktop native host registration and target-triple packaging are incomplete/,
  );

  const betaRegistrationFixture = repositoryFixture();
  betaRegistrationFixture.nativeHostRegistration =
    betaRegistrationFixture.nativeHostRegistration.replace(
      "gcgoepclopkgijmclmlheafaglmbjlcc",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  assert.throws(
    () => validateDesktopReleaseConfiguration(betaRegistrationFixture),
    /desktop native host registration and target-triple packaging are incomplete/,
  );

  const cleanupFixture = repositoryFixture();
  cleanupFixture.nsisHooks = cleanupFixture.nsisHooks.replace(
    "Software\\Google\\Chrome\\NativeMessagingHosts\\com.jstorrent.rstorrent.native",
    "Software\\Google\\Chrome\\NativeMessagingHosts\\com.example.wrong",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(cleanupFixture),
    /Windows native host cleanup is missing/,
  );
});

test("rejects desktop association and command-quoting drift", () => {
  const associationFixture = repositoryFixture();
  associationFixture.tauri.bundle.fileAssociations[0].name = "torrent";
  assert.throws(
    () => validateDesktopReleaseConfiguration(associationFixture),
    /unexpected desktop torrent file association/,
  );

  const schemeFixture = repositoryFixture();
  schemeFixture.tauri.plugins["deep-link"].desktop.schemes.push("jstorrent");
  assert.throws(
    () => validateDesktopReleaseConfiguration(schemeFixture),
    /unexpected desktop deep-link schemes/,
  );

  const quotingFixture = repositoryFixture();
  quotingFixture.nsisHooks = quotingFixture.nsisHooks.replace(
    '$\\"$INSTDIR\\${MAINBINARYNAME}.exe$\\"',
    "$INSTDIR\\${MAINBINARYNAME}.exe",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(quotingFixture),
    /must quote the executable and input path/,
  );

  const openedFixture = repositoryFixture();
  openedFixture.desktopSource = openedFixture.desktopSource.replace(
    "handle_external_activation_values(handle, urls.iter().map(url::Url::as_str));",
    "// dropped OS inputs",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(openedFixture),
    /desktop external activation integration is missing/,
  );

  const linuxFixture = repositoryFixture();
  linuxFixture.linuxDesktop = linuxFixture.linuxDesktop.replace(" %U", "");
  assert.throws(
    () => validateDesktopReleaseConfiguration(linuxFixture),
    /Linux desktop handler must forward URLs\/files/,
  );
});

test("rejects incompatible plugin registration", () => {
  const cargoFixture = repositoryFixture();
  cargoFixture.cargo = cargoFixture.cargo.replace(', features = ["deep-link"]', "");
  assert.throws(
    () => validateDesktopReleaseConfiguration(cargoFixture),
    /single-instance dependency must use its compatible deep-link integration/,
  );

  const missingFixture = repositoryFixture();
  missingFixture.desktopSource = missingFixture.desktopSource.replace(
    ".plugin(single_instance_plugin())", "",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(missingFixture),
    /single-instance must be registered before the deep-link plugin/,
  );

  const orderFixture = repositoryFixture();
  orderFixture.desktopSource = orderFixture.desktopSource.replace(
    ".plugin(single_instance_plugin())",
    ".plugin(tauri_plugin_deep_link::init())\n        .plugin(single_instance_plugin())",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(orderFixture),
    /single-instance must be registered before the deep-link plugin/,
  );
});

test("rejects notification authority or dependency drift", () => {
  const dependencyFixture = repositoryFixture();
  dependencyFixture.cargo = dependencyFixture.cargo.replace(
    'tauri-plugin-notification = "=2.3.3"',
    'tauri-plugin-notification = "2"',
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(dependencyFixture),
    /notification dependency must stay pinned/,
  );

  const linuxDependencyFixture = repositoryFixture();
  linuxDependencyFixture.cargo = linuxDependencyFixture.cargo.replace(
    'notify-rust = "=4.18.0"',
    'notify-rust = "4"',
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(linuxDependencyFixture),
    /Linux notification dependency must stay pinned/,
  );

  const permissionFixture = repositoryFixture();
  permissionFixture.capability.permissions.push("notification:default");
  assert.throws(
    () => validateDesktopReleaseConfiguration(permissionFixture),
    /webview notification permissions must stay disabled/,
  );

  const ownerFixture = repositoryFixture();
  ownerFixture.desktopSource = ownerFixture.desktopSource.replace(
    "async fn run_notification_owner(",
    "async fn missing_notification_owner(",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(ownerFixture),
    /Rust-owned desktop notification integration is incomplete/,
  );
});

test("rejects automatic-sleep inhibition dependency or authority drift", () => {
  const keepawakeFixture = repositoryFixture();
  keepawakeFixture.cargo = keepawakeFixture.cargo.replace(
    'keepawake = "=0.6.1"',
    'keepawake = "0.6"',
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(keepawakeFixture),
    /keepawake dependency must stay pinned/,
  );

  const portalFixture = repositoryFixture();
  portalFixture.cargo = portalFixture.cargo.replace(
    'zbus = "=5.19.0"',
    'zbus = "5"',
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(portalFixture),
    /Linux portal dependency must stay pinned/,
  );

  const ownerFixture = repositoryFixture();
  ownerFixture.desktopSource = ownerFixture.desktopSource.replace(
    "async fn run_power_owner(",
    "async fn missing_power_owner(",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(ownerFixture),
    /Rust-owned desktop automatic-sleep inhibition is incomplete/,
  );

  const policyFixture = repositoryFixture();
  policyFixture.desktopPower = policyFixture.desktopPower.replaceAll(
    "TorrentOperationalState::Checking",
    "TorrentOperationalState::Seeding",
  );
  assert.throws(
    () => validateDesktopReleaseConfiguration(policyFixture),
    /Rust-owned desktop automatic-sleep inhibition is incomplete/,
  );
});

function repositoryFixture() {
  return {
    packageJson: readJson("clients/web/package.json"),
    tauri: readJson("clients/desktop/src-tauri/tauri.conf.json"),
    developmentTauri: readJson("clients/desktop/src-tauri/tauri.dev.conf.json"),
    packageTauri: readJson("clients/desktop/src-tauri/tauri.package.conf.json"),
    releaseTauri: readJson("clients/desktop/src-tauri/tauri.release.conf.json"),
    cargo: fs.readFileSync(path.join(root, "clients/desktop/src-tauri/Cargo.toml"), "utf8"),
    capability: readJson("clients/desktop/src-tauri/capabilities/default.json"),
    desktopMain: fs.readFileSync(
      path.join(root, "clients/desktop/src-tauri/src/main.rs"),
      "utf8",
    ),
    desktopSource: fs.readFileSync(
      path.join(root, "clients/desktop/src-tauri/src/lib.rs"),
      "utf8",
    ),
    desktopPower: fs.readFileSync(
      path.join(root, "clients/desktop/src-tauri/src/desktop_power.rs"),
      "utf8",
    ),
    nativeHostRegistration: fs.readFileSync(
      path.join(root, "clients/desktop/src-tauri/src/native_host_registration.rs"),
      "utf8",
    ),
    prepareNativeHost: fs.readFileSync(
      path.join(root, "scripts/prepare-native-host.mjs"),
      "utf8",
    ),
    nsisHooks: fs.readFileSync(
      path.join(root, "clients/desktop/src-tauri/nsis/hooks.nsh"),
      "utf8",
    ),
    linuxDesktop: fs.readFileSync(
      path.join(root, "clients/desktop/src-tauri/linux/rstorrent.desktop"),
      "utf8",
    ),
    tauriUpdater: fs.readFileSync(
      path.join(root, "clients/web/src/tauri-updater.ts"),
      "utf8",
    ),
    product: readJson("update-server/rstorrent.json"),
    changelog: fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
    tag: undefined,
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}


test("rejects unreviewed package resources", () => {
  const fixture = repositoryFixture();
  fixture.tauri.bundle.resources = ["private.env"];
  assert.throws(() => validateDesktopReleaseConfiguration(fixture), /unreviewed resources/);
});


test("rejects a disabled native notice hook or shared tool cache", () => {
  const fixture = repositoryFixture();
  fixture.packageTauri.bundle.useLocalToolsDir = false;
  assert.throws(() => validateDesktopReleaseConfiguration(fixture), /native notice hook/);
  const release = repositoryFixture();
  release.releaseTauri.build.beforeBundleCommand = "true";
  assert.throws(() => validateDesktopReleaseConfiguration(release), /native notice hook/);
});

test("rejects old output target and bundle-only executable overrides", () => {
  const target = repositoryFixture();
  target.cargo = target.cargo.replace('default-run = "jstorrent-client"',
    'default-run = "rstorrent-desktop"');
  assert.throws(() => validateDesktopReleaseConfiguration(target), /desktop output must be/u);
  const overlay = repositoryFixture();
  overlay.releaseTauri.mainBinaryName = "rstorrent-desktop";
  assert.throws(() => validateDesktopReleaseConfiguration(overlay), /must not override/u);
});


test("rejects preview feed selection without its own package marker", () => {
  const fixture = repositoryFixture();
  delete fixture.product.channels.stable.requiredAsset;
  assert.throws(() => validateDesktopReleaseConfiguration(fixture), /unexpected updater product config/);
  const mixed = repositoryFixture();
  mixed.product.channels.latest.requiredAsset = "JSTorrent_x64.app.tar.gz";
  assert.throws(() => validateDesktopReleaseConfiguration(mixed), /unexpected updater product config/);
});

// Scoped opener permissions are objects, not string permission identifiers.
test("rejects broadened, duplicated and foreign desktop external-link scopes", () => {
  for (const mutate of [
    permission => permission.allow[0].url = "https://github.com/*",
    permission => permission.allow[0].url = "https://github.com/kzahel/jstorrent-typescript/issues",
    permission => permission.allow.push(permission.allow[0]),
    permission => permission.deny = [],
  ]) {
    const fixture = repositoryFixture();
    mutate(fixture.capability.permissions.find(permission => typeof permission === "object"));
    assert.throws(() => validateDesktopReleaseConfiguration(fixture), /exact scoped opener/);
  }
  const fixture = repositoryFixture();
  fixture.capability.permissions.push("opener:default");
  assert.throws(() => validateDesktopReleaseConfiguration(fixture), /exact scoped opener/);
});

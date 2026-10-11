import assert from "node:assert/strict";
import test from "node:test";

import { validateDesktopRelease } from "./validate-desktop-release.mjs";

const tag = "desktop-v1.2.3";
const repository = "kzahel/jstorrent";
const version = "1.2.3";
const digest = `sha256:${"a".repeat(64)}`;

test("accepts a complete five-target draft", () => {
  assert.equal(validateDesktopRelease({ ...fixture(), tag, repository }).version, version);
});

test("accepts the same complete draft matrix for Latest", () => {
  const latestTag = `desktop-latest-v${version}`;
  const data = fixture();
  data.release.tagName = latestTag;
  data.release.isPrerelease = true;
  for (const metadata of Object.values(data.latest.platforms)) {
    metadata.url = metadata.url.replace(`/download/${tag}/`, `/download/${latestTag}/`);
  }
  assert.equal(validateDesktopRelease({ ...data, tag: latestTag, repository }).version, version);
});

test("rejects missing platform coverage and external updater URLs", () => {
  const missing = fixture();
  delete missing.latest.platforms["linux-aarch64"];
  assert.throws(
    () => validateDesktopRelease({ ...missing, tag, repository }),
    /exactly the 15 desktop updater keys/,
  );

  const external = fixture();
  external.latest.platforms["windows-x86_64"].url = "https://example.test/update.exe";
  assert.throws(
    () => validateDesktopRelease({ ...external, tag, repository }),
    /unexpected URL/,
  );
});

test("rejects package-specific updater drift", () => {
  const wrongPackage = fixture();
  wrongPackage.latest.platforms["linux-aarch64-deb"].url =
    wrongPackage.latest.platforms["linux-aarch64"].url;
  assert.throws(
    () => validateDesktopRelease({ ...wrongPackage, tag, repository }),
    /must use .deb/,
  );

  const wrongDefault = fixture();
  wrongDefault.latest.platforms["windows-x86_64-nsis"].signature =
    "different-package-signature-that-is-long-enough";
  assert.throws(
    () => validateDesktopRelease({ ...wrongDefault, tag, repository }),
    /default and package-specific updater entries disagree/,
  );
});

test("rejects public or unsigned release input", () => {
  const published = fixture();
  published.release.isDraft = false;
  assert.throws(
    () => validateDesktopRelease({ ...published, tag, repository }),
    /remain a draft/,
  );

  const unsigned = fixture();
  unsigned.release.assets[0].digest = null;
  assert.throws(
    () => validateDesktopRelease({ ...unsigned, tag, repository }),
    /missing a GitHub SHA-256 digest/,
  );
});

test("rejects release kind drift across channels", () => {
  const data = fixture();
  data.release.isPrerelease = true;
  assert.throws(() => validateDesktopRelease({ ...data, tag, repository }), /prerelease kind/);
});

function fixture() {
  const updaterAssets = {
    "darwin-aarch64": "RSTorrent_aarch64.app.tar.gz",
    "darwin-aarch64-app": "RSTorrent_aarch64.app.tar.gz",
    "darwin-x86_64": "RSTorrent_x64.app.tar.gz",
    "darwin-x86_64-app": "RSTorrent_x64.app.tar.gz",
    "linux-aarch64": `rstorrent-desktop_${version}_aarch64.AppImage`,
    "linux-aarch64-appimage": `rstorrent-desktop_${version}_aarch64.AppImage`,
    "linux-aarch64-deb": `rstorrent-desktop_${version}_arm64.deb`,
    "linux-aarch64-rpm": `rstorrent-desktop-${version}-1.aarch64.rpm`,
    "linux-x86_64": `rstorrent-desktop_${version}_amd64.AppImage`,
    "linux-x86_64-appimage": `rstorrent-desktop_${version}_amd64.AppImage`,
    "linux-x86_64-deb": `rstorrent-desktop_${version}_amd64.deb`,
    "linux-x86_64-rpm": `rstorrent-desktop-${version}-1.x86_64.rpm`,
    "windows-x86_64": `RSTorrent_${version}_x64-setup.exe`,
    "windows-x86_64-nsis": `RSTorrent_${version}_x64-setup.exe`,
    "windows-x86_64-msi": `RSTorrent_${version}_x64_en-US.msi`,
  };
  const names = new Set([
    `RSTorrent_${version}_aarch64.dmg`,
    `RSTorrent_${version}_x64.dmg`,
    `RSTorrent_${version}_x64-setup.exe`,
    `RSTorrent_${version}_x64_en-US.msi`,
    `rstorrent-desktop_${version}_amd64.AppImage`,
    `rstorrent-desktop_${version}_amd64.deb`,
    `rstorrent-desktop-${version}-1.x86_64.rpm`,
    `rstorrent-desktop_${version}_aarch64.AppImage`,
    `rstorrent-desktop_${version}_arm64.deb`,
    `rstorrent-desktop-${version}-1.aarch64.rpm`,
    "latest.json",
  ]);
  for (const name of Object.values(updaterAssets)) {
    names.add(name);
    names.add(`${name}.sig`);
  }
  return {
    release: {
      tagName: tag,
      isDraft: true,
      isPrerelease: false,
      assets: [...names].map((name) => ({ name, digest })),
    },
    latest: {
      version,
      platforms: Object.fromEntries(
        Object.entries(updaterAssets).map(([platform, name]) => [
          platform,
          {
            signature: "signed-updater-metadata-that-is-long-enough",
            url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
          },
        ]),
      ),
    },
  };
}

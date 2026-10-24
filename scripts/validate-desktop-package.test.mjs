import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateLinuxDesktop,
  validateMacInfo,
  validateMacNativeHost,
  validateWindowsAssociations,
} from "./validate-desktop-package.mjs";

const identifier = "com.jstorrent.rstorrent";
const fileClass = `${identifier}.torrent`;

test("accepts complete macOS activation metadata", () => {
  validateMacInfo({
    CFBundleIdentifier: identifier,
    CFBundleExecutable: "jstorrent-client",
    CFBundleURLTypes: [
      {
        CFBundleURLName: `${identifier} magnet`,
        CFBundleURLSchemes: ["magnet"],
      },
    ],
    CFBundleDocumentTypes: [
      {
        CFBundleTypeName: fileClass,
        CFBundleTypeExtensions: ["torrent"],
        CFBundleTypeRole: "Editor",
        LSItemContentTypes: [fileClass],
      },
    ],
    UTExportedTypeDeclarations: [
      {
        UTTypeIdentifier: fileClass,
        UTTypeConformsTo: ["public.data"],
        UTTypeTagSpecification: {
          "public.mime-type": "application/x-bittorrent",
          "public.filename-extension": ["torrent"],
        },
      },
    ],
  });
});

test("rejects incomplete macOS activation metadata", () => {
  assert.throws(
    () => validateMacInfo({ CFBundleIdentifier: identifier, CFBundleExecutable: "jstorrent-client" }),
    /does not register magnet/,
  );
});

test("requires an executable native host in the macOS application", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rstorrent-mac-package-"));
  try {
    const executableDirectory = path.join(directory, "Contents", "MacOS");
    fs.mkdirSync(executableDirectory, { recursive: true });
    const nativeHost = path.join(executableDirectory, "rstorrent-native-host");
    fs.writeFileSync(nativeHost, "native host");
    assert.throws(() => validateMacNativeHost(directory), /must be executable/);
    fs.chmodSync(nativeHost, 0o755);
    assert.equal(validateMacNativeHost(directory), nativeHost);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts a Linux handler that forwards one URL list", () => {
  validateLinuxDesktop(`[Desktop Entry]
Name=JSTorrent Preview
Exec=jstorrent-client %U
Terminal=false
Type=Application
MimeType=application/x-bittorrent;x-scheme-handler/magnet;
`);
});

test("rejects a Linux handler that advertises but drops activations", () => {
  assert.throws(
    () =>
      validateLinuxDesktop(`[Desktop Entry]
Name=JSTorrent Preview
Exec=jstorrent-client
Terminal=false
Type=Application
MimeType=application/x-bittorrent;x-scheme-handler/magnet;
`),
    /must forward one URL\/file list with %U/,
  );
});

test("accepts exact quoted Windows association commands", () => {
  validateWindowsAssociations({
    executable: "C:\\Users\\Test User\\AppData\\Local\\RSTorrent\\jstorrent-client.exe",
    torrentProgId: fileClass,
    torrentCommand:
      '"C:\\Users\\Test User\\AppData\\Local\\RSTorrent\\jstorrent-client.exe" "%1"',
    magnetUrlProtocol: "",
    magnetCommand:
      '"C:\\Users\\Test User\\AppData\\Local\\RSTorrent\\jstorrent-client.exe" "%1"',
  });
});

test("rejects an unquoted Windows executable", () => {
  assert.throws(
    () =>
      validateWindowsAssociations({
        executable: "C:\\Users\\Test User\\jstorrent-client.exe",
        torrentProgId: fileClass,
        torrentCommand: 'C:\\Users\\Test User\\jstorrent-client.exe "%1"',
        magnetUrlProtocol: "",
        magnetCommand: '"C:\\Users\\Test User\\jstorrent-client.exe" "%1"',
      }),
    /unexpected Windows torrent command/,
  );
});

test("production Windows and Linux metadata reject an incubation selector", () => {
  const executable = 'C:\\Users\\Test User\\AppData\\Local\\JSTorrent\\jstorrent-client.exe';
  const registry = {executable, torrentProgId:'com.jstorrent.desktop.torrent',
    torrentCommand:`"${executable}" "%1"`,magnetCommand:`"${executable}" "%1"`,magnetUrlProtocol:''};
  assert.doesNotThrow(()=>validateWindowsAssociations(registry,'JSTorrent'));
  assert.throws(()=>validateWindowsAssociations(registry,'RSTorrent'),/torrent file class/u);
  const entry='[Desktop Entry]\nName=JSTorrent\nExec=jstorrent-client %U\nTerminal=false\nType=Application\nMimeType=application/x-bittorrent;x-scheme-handler/magnet;\n';
  assert.doesNotThrow(()=>validateLinuxDesktop(entry,'JSTorrent'));
  assert.throws(()=>validateLinuxDesktop(entry,'RSTorrent'),/handler name/u);
  assert.throws(()=>validateLinuxDesktop(entry,'OtherApp'),/unknown package product/u);
  assert.throws(()=>validateMacInfo({CFBundleIdentifier:'com.jstorrent.rstorrent'},'JSTorrent'),/bundle identifier/u);
});

test("rejects obsolete desktop executable labels in installed packages", () => {
  assert.throws(() => validateMacInfo({
    CFBundleIdentifier: identifier, CFBundleExecutable: "rstorrent-desktop",
  }), /unexpected macOS executable/u);
  const executable = "C:\\Program Files\\JSTorrent\\rstorrent-desktop.exe";
  assert.throws(() => validateWindowsAssociations({executable}, "JSTorrent"),
    /unexpected Windows installed executable/u);
  assert.throws(() => validateLinuxDesktop(`[Desktop Entry]
Name=JSTorrent
Exec=rstorrent-desktop %U
Type=Application
Terminal=false
MimeType=application/x-bittorrent;x-scheme-handler/magnet;
`, "JSTorrent"), /unexpected Linux installed executable/u);
});

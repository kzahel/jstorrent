#!/usr/bin/env python3
"""Check paused/running intent through real SAF repair in an owned API 35 AVD.

Run with the interop uv environment after sourcing the Android SDK profile.
The APK is installed only in a freshly created disposable emulator. Reports
retain screenshots and hashes; the emulator, source and temporary AVD are reaped.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import platform
import shlex
import struct
import subprocess
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

import libtorrent as lt

import android_reactive_surface as ui
from first_verified_piece import ScenarioFailure, add_seed, create_session, wait_for_listener
from headless_avd import OwnedHeadlessAvd, android_sdk_root
from magnet_metadata import magnet_uri


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--package", choices=("org.rstorrent.bootstrap", "com.jstorrent.app"),
                        default="org.rstorrent.bootstrap",
                        help="Installed identity in the fresh owned emulator; never an existing device")
    args = parser.parse_args()
    ui.PACKAGE = args.package
    ui.ACTIVITY = ("com.jstorrent.app/com.jstorrent.app.MainActivity"
                   if args.package == "com.jstorrent.app" else f"{args.package}/.MainActivity")
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"result": "fail", "stages": [], "api": 35,
              "package": args.package,
              "scope": "Fresh owned emulator installation; normal intake and SAF picker repair, not store delivery"}
    sdk = android_sdk_root()
    abi = {"arm64": "arm64-v8a", "aarch64": "arm64-v8a", "x86_64": "x86_64"}[platform.machine()]
    apk = args.apk.resolve()
    report["apkSha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
    owned = None
    session = None
    seed = None
    adb = None
    port = None
    prior_avd_home = os.environ.get("ANDROID_AVD_HOME")
    try:
        with tempfile.TemporaryDirectory(prefix="jstorrent-repair-intent-") as temporary:
            work = Path(temporary)
            avds = work / "avds"
            avds.mkdir()
            os.environ["ANDROID_AVD_HOME"] = str(avds)
            name = "jstorrent-repair-" + uuid.uuid4().hex
            subprocess.run([str(sdk / "cmdline-tools/latest/bin/avdmanager"), "create", "avd",
                            "--name", name, "--package", f"system-images;android-35;google_apis;{abi}",
                            "--path", str(work / "image"), "--device", "pixel_2"],
                           input="no\n", text=True, capture_output=True, check=True, timeout=60)
            try:
                owned = OwnedHeadlessAvd.start(name, sdk / "platform-tools/adb", sdk / "emulator/emulator", work)
                adb = ui.Adb(owned.adb, owned.serial)

                def fresh_ui() -> ET.Element:
                    adb.shell("rm", "-f", "/sdcard/rstorrent-window.xml")
                    return ui.dump_ui(adb)

                def snapshot(label: str) -> ET.Element:
                    root = fresh_ui()
                    # Format reference: Android15 cmds/screencap/screencap.cpp,
                    # frameworks/base tag android-15.0.0_r1 (no source copied).
                    # It emits four uint32 values followed
                    # by tightly packed rows. Observe two nonblank stable frames
                    # before saving the unchanged PNG; accessibility can lead draw.
                    deadline = time.monotonic() + 15
                    previous = None
                    frames = 0
                    while time.monotonic() < deadline:
                        captured = subprocess.run([*adb.command, "exec-out", "screencap"],
                                                  capture_output=True, check=True, timeout=5).stdout
                        if len(captured) < 16:
                            raise ScenarioFailure("Truncated raw screenshot")
                        width, height, format_, _ = struct.unpack_from("<IIII", captured)
                        if (format_ != 1 or not 100 <= width <= 4096 or not 100 <= height <= 4096
                                or len(captured) != 16 + width * height * 4):
                            raise ScenarioFailure("Unexpected raw screenshot format")
                        start, end = height // 20, height * 19 // 20
                        pixels = captured[16 + start * width * 4:16 + end * width * 4]
                        colors = {pixels[index:index + 4]
                                  for row in range(0, end - start, 16)
                                  for column in range(0, width, 16)
                                  for index in [(row * width + column) * 4]}
                        digest = hashlib.sha256(pixels).hexdigest()
                        frames += 1
                        if len(colors) > 8 and previous == digest:
                            report.setdefault("renderedFrameChecks", []).append(
                                {"stage": label, "frames": frames, "sampledColors": len(colors),
                                 "centralPixelsSha256": digest})
                            break
                        previous = digest if len(colors) > 8 else None
                        time.sleep(.3)
                    else:
                        raise ScenarioFailure(f"No stable nonblank rendered frame at {label}")
                    root = fresh_ui()
                    (args.output / f"{label}.xml").write_text(ET.tostring(root, encoding="unicode"))
                    adb.capture_screenshot(args.output / f"{label}.png")
                    report["stages"].append(label)
                    leaks = [value for node in root.iter()
                             for key in ("text", "content-desc")
                             if "rstorrent" in (value := node.get(key, "")).casefold()]
                    report.setdefault("visibleBrandChecks", []).append({"stage": label, "leaks": leaks})
                    if leaks:
                        raise ScenarioFailure(f"Visible old branding at {label}: {leaks}")
                    print(label, flush=True)
                    return root

                def text_values(root):
                    return {n.get("text", "") for n in root.iter()}

                def tap(label: str, *, package: str | None = ui.PACKAGE) -> None:
                    adb.shell("rm", "-f", "/sdcard/rstorrent-window.xml")
                    control = ui.find_control(adb, label)
                    if ui.bounds_area(control.get("bounds", "")) <= 0:
                        raise ScenarioFailure(f"No usable fresh control: {label}")
                    if package is not None and control.get("package") != package:
                        raise ScenarioFailure(f"Wrong package for {label}: {control.attrib}")
                    ui.tap_bounds(adb, control.attrib["bounds"])

                def wait_text(label: str, seconds=30):
                    deadline = time.monotonic() + seconds
                    while time.monotonic() < deadline:
                        root = fresh_ui()
                        if label in text_values(root):
                            return root
                        time.sleep(.25)
                    raise ScenarioFailure(f"Timed out waiting for {label}")

                def launch():
                    adb.shell("am", "start", "-W", "-n", ui.ACTIVITY, timeout=30)

                def shutdown(label):
                    tap("Back")
                    tap("More options")
                    tap("Shutdown")
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        state = adb.shell("dumpsys", "activity", "services", ui.PACKAGE).stdout
                        if "ServiceRecord{" not in state:
                            report.setdefault("joinedShutdowns", []).append(label)
                            return
                        time.sleep(.25)
                    raise ScenarioFailure("Normal Shutdown left the service running")

                def picker(folder):
                    deadline = time.monotonic() + 45
                    entered = False
                    accepted = False
                    while time.monotonic() < deadline:
                        root = fresh_ui()
                        nodes = list(root.iter())
                        documents = any("documentsui" in n.get("package", "") for n in nodes)
                        if accepted and not documents:
                            return
                        if accepted:
                            allow = ui.click_labeled(nodes, {"Allow"})
                            if allow is not None:
                                ui.tap_bounds(adb, allow.attrib["bounds"])
                        else:
                            entered = any(n.get("text") == folder and n.get("resource-id", "").endswith(":id/breadcrumb_text") for n in nodes)
                            if entered:
                                use = ui.click_labeled([n for n in nodes if n.get("enabled") != "false"], {"Use this folder"})
                                if use is not None and ui.bounds_area(use.attrib["bounds"]) > 0:
                                    ui.tap_bounds(adb, use.attrib["bounds"])
                                    accepted = True
                            else:
                                entry = next((n for n in nodes if n.get("resource-id") == "android:id/title" and n.get("text") == folder), None)
                                if entry is not None:
                                    ui.tap_bounds(adb, entry.attrib["bounds"])
                                else:
                                    navigation = ui.click_labeled(nodes, {"Show roots"})
                                    downloads = ui.click_labeled(nodes, {"Downloads"})
                                    if downloads is not None:
                                        ui.tap_bounds(adb, downloads.attrib["bounds"])
                                    elif navigation is not None:
                                        ui.tap_bounds(adb, navigation.attrib["bounds"])
                        time.sleep(.3)
                    snapshot("failed-picker")
                    raise ScenarioFailure(f"Picker did not grant {folder}")

                ui.install_and_start(adb, apk)
                folder = "JSTorrentRepairIntent"
                grant_path = "/sdcard/Download/" + folder
                adb.shell("mv", ui.GRANT_PATH, grant_path)
                snapshot("initial")
                wait_text("Save and continue")
                tap("Include usage statistics")
                snapshot("usage-statistics-off")
                tap("Save and continue")
                wait_text("Choose a download folder")
                root = fresh_ui()
                selection = ui.click_labeled(list(root.iter()), ui.STORAGE_SELECTION_LABELS)
                if selection is None:
                    raise ScenarioFailure("No initial download folder control")
                ui.tap_bounds(adb, selection.attrib["bounds"])
                picker(folder)
                snapshot("initial-folder-selected")
                filename = "JSTorrentRepairIntent.bin"
                payload = bytes((i * 17 + 31) % 256 for i in range(1024 * 1024))
                expected = hashlib.sha256(payload).hexdigest()
                info = {b"name": filename.encode(), b"length": len(payload), b"piece length": 16384,
                        b"pieces": b"".join(hashlib.sha1(payload[i:i+16384]).digest() for i in range(0, len(payload), 16384))}
                ti = lt.torrent_info(lt.bencode({b"info": info}))
                infohash = hashlib.sha1(lt.bencode(info)).hexdigest()
                (work / filename).write_bytes(payload)
                session = create_session()
                port = wait_for_listener(session, [])
                seed = add_seed(session, ti, work, [])
                adb.run("reverse", f"tcp:{port}", f"tcp:{port}")
                uri = magnet_uri(infohash, f"127.0.0.1:{port}")
                adb.shell("am", "start", "-W", "-n", ui.ACTIVITY, "-a", "android.intent.action.VIEW", "-d", shlex.quote(uri))
                wait_text("Magnet link from another app")
                tap("Add")
                wait_text("Download", 90)
                snapshot("files-before-confirm")
                tap("Download")
                payload_path = grant_path + "/" + filename

                def whole_hash(path):
                    value = adb.shell("sha256sum", path).stdout.split()[0]
                    if value != expected:
                        raise ScenarioFailure(f"Whole hash differs: {value}")
                    return value

                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    result = adb.shell("sha256sum", payload_path, check=False)
                    if result.returncode == 0 and result.stdout.startswith(expected + " "):
                        break
                    time.sleep(.5)
                else:
                    raise ScenarioFailure("Controlled download did not complete")
                report.update(infoHash=infohash, wholeSha256=whole_hash(payload_path))
                session.remove_torrent(seed)
                seed = None
                session = None
                gc.collect()
                adb.run("reverse", "--remove", f"tcp:{port}")
                port = None
                report["sourceClosedBeforeRepair"] = True
                tap(filename)
                wait_text("Seeding")
                tap("Pause")
                wait_text("Paused")
                snapshot("before-paused")
                shutdown("before-outage")
                relocated = grant_path + "-relocated"
                adb.shell("mv", grant_path, relocated)
                launch()
                snapshot("missing-library")
                tap("More options")
                tap("Settings")
                tap("Storage")
                snapshot("missing-storage")
                tap("Repair")
                picker(folder + "-relocated")
                wait_text("Available")
                snapshot("repaired-storage")
                tap("Back")
                tap("Back")
                tap(filename)
                root = snapshot("after-paused-repair")
                whole_hash(relocated + "/" + filename)
                if "Paused" not in text_values(root):
                    raise ScenarioFailure("Repair changed paused intent: " + ", ".join(sorted(text_values(root))))
                shutdown("after-paused-repair")
                launch()
                tap(filename)
                wait_text("Paused")
                snapshot("paused-cold-reopen")
                tap("Resume")
                wait_text("Seeding")
                snapshot("before-running")
                shutdown("before-running-outage")
                adb.shell("mv", relocated, grant_path)
                launch()
                tap("More options")
                tap("Settings")
                tap("Storage")
                tap("Repair")
                picker(folder)
                wait_text("Available")
                tap("Back")
                tap("Back")
                tap(filename)
                wait_text("Seeding")
                snapshot("after-running-repair")
                whole_hash(payload_path)
                shutdown("after-running-repair")
                launch()
                tap(filename)
                wait_text("Seeding")
                snapshot("running-cold-reopen")
                report.update(result="pass", pausedRepair="paused", runningRepair="seeding", coldReopen="both_preserved")
            finally:
                if adb is not None:
                    try:
                        snapshot("terminal")
                        (args.output / "logcat.txt").write_text(adb.run("logcat", "-d", timeout=30).stdout)
                    except Exception as capture_error:
                        report["terminalCaptureError"] = str(capture_error)
                if session is not None:
                    if seed is not None:
                        session.remove_torrent(seed)
                    seed = None
                    session = None
                    gc.collect()
                if owned is not None:
                    report["emulatorExitBeforeCleanup"] = owned.process.poll()
                    if owned.log_path.exists():
                        data = owned.log_path.read_bytes()
                        report["emulatorLogTruncated"] = len(data) > 2 * 1024**2
                        (args.output / "headless-avd.log").write_bytes(data[-2 * 1024**2:])
                    owned.close()
                    owned = None
                    report["ownedEmulatorReaped"] = True
        report["temporaryAvdRemoved"] = not Path(temporary).exists()
    except Exception as error:
        report["error"] = str(error)
        if "temporary" in locals():
            report["temporaryAvdRemoved"] = not Path(temporary).exists()
    finally:
        if prior_avd_home is None:
            os.environ.pop("ANDROID_AVD_HOME", None)
        else:
            os.environ["ANDROID_AVD_HOME"] = prior_avd_home
        (args.output / "review.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report), flush=True)
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

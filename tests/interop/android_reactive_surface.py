#!/usr/bin/env python3
"""Exercise the Android foreground client against a controlled libtorrent seed."""

from __future__ import annotations

import argparse
import gc
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import libtorrent as lt

from first_verified_piece import (
    ScenarioFailure,
    add_seed,
    create_session,
    wait_for_listener,
)
from headless_avd import OwnedHeadlessAvd, default_adb, default_emulator
from magnet_metadata import create_fixture, magnet_uri


PACKAGE = "org.rstorrent.bootstrap"
ACTIVITY = f"{PACKAGE}/.MainActivity"
TRACE_TAG = "RSTorrentProduct"
DOWNLOAD_TIMEOUT_SECONDS = 45
UPLOAD_RATE_LIMIT = 8 * 1024
ANDROID_PAYLOAD_SIZE = 128 * 1024
BOUNDS_PATTERN = re.compile(r"\[(\d+),(\d+)]\[(\d+),(\d+)]")
GRANT_FOLDER = "RSTorrentReactiveGrant"
GRANT_PATH = f"/sdcard/Download/{GRANT_FOLDER}"
STORAGE_SELECTION_LABELS = {
    "Choose a download folder",
    "Select download folder",
    "Select folder",
    "Repair",
}


class Adb:
    def __init__(self, executable: Path, serial: str) -> None:
        self.command = [str(executable), "-s", serial]

    def run(
        self,
        *arguments: str,
        timeout: float = 15,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(
            [*self.command, *arguments],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if check and completed.returncode != 0:
            raise ScenarioFailure(
                f"adb {' '.join(arguments)} failed\n"
                f"stdout:\n{completed.stdout}\n"
                f"stderr:\n{completed.stderr}"
            )
        return completed

    def shell(
        self,
        *arguments: str,
        timeout: float = 15,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return self.run("shell", *arguments, timeout=timeout, check=check)

    def capture_screenshot(self, path: Path) -> None:
        completed = subprocess.run(
            [*self.command, "exec-out", "screencap", "-p"],
            capture_output=True,
            timeout=20,
            check=False,
        )
        if completed.returncode != 0:
            raise ScenarioFailure(
                "Android screenshot capture failed\n"
                + completed.stderr.decode("utf-8", errors="replace")
            )
        if not completed.stdout.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ScenarioFailure("Android screenshot did not contain PNG data")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(completed.stdout)


def parse_arguments() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--serial",
        help="explicitly authorized existing ADB serial",
    )
    target.add_argument("--avd", help="AVD name for a harness-owned emulator")
    parser.add_argument(
        "--headless",
        action="store_true",
        help="required with --avd; launch with no host window",
    )
    parser.add_argument(
        "--adb",
        type=Path,
        default=default_adb(),
    )
    parser.add_argument(
        "--emulator",
        type=Path,
        default=default_emulator(),
    )
    parser.add_argument(
        "--apk",
        type=Path,
        default=(
            repository
            / "clients/android/app/build/outputs/apk/debug/app-debug.apk"
        ),
    )
    parser.add_argument(
        "--screenshot",
        type=Path,
        help="write a PNG of the live Compose transfer surface",
    )
    return parser.parse_args()


def require_unlocked(adb: Adb) -> None:
    policy = adb.shell("dumpsys", "window", "policy").stdout
    locked_markers = (
        "isStatusBarKeyguard=true",
        "mDreamingLockscreen=true",
        "mKeyguardShowing=true",
        "mShowingLockscreen=true",
    )
    if any(marker in policy for marker in locked_markers):
        raise ScenarioFailure(
            "device is locked; unlock it manually before running this test"
        )


def install_and_start(
    adb: Adb,
    apk: Path,
) -> None:
    if not apk.is_file():
        raise ScenarioFailure(f"Android APK does not exist: {apk}")
    adb.run("install", "-r", str(apk), timeout=60)
    adb.shell("pm", "clear", PACKAGE)
    api = int(adb.shell("getprop", "ro.build.version.sdk").stdout.strip())
    if api >= 33:
        adb.shell(
            "pm",
            "grant",
            PACKAGE,
            "android.permission.POST_NOTIFICATIONS",
        )
    adb.shell("rm", "-rf", GRANT_PATH)
    adb.shell("mkdir", "-p", GRANT_PATH)
    adb.shell("cmd", "statusbar", "collapse", check=False)
    adb.run("logcat", "-c")
    started = adb.shell(
        "am",
        "start",
        "-W",
        "--activity-clear-task",
        "-n",
        ACTIVITY,
        timeout=30,
    )
    if "Status: ok" not in started.stdout:
        raise ScenarioFailure(f"product Activity did not start:\n{started.stdout}")


def click_labeled(
    nodes: list[ET.Element],
    labels: set[str],
) -> ET.Element | None:
    wanted = {label.casefold() for label in labels}
    candidates = []
    for node in nodes:
        if node.attrib.get("clickable") != "true":
            continue
        values = {
            descendant.attrib.get("text", "").strip().casefold()
            for descendant in node.iter()
        }
        values.add(node.attrib.get("content-desc", "").strip().casefold())
        if values & wanted:
            candidates.append(node)
    return min(
        candidates,
        key=lambda node: bounds_area(node.attrib["bounds"]),
        default=None,
    )


def select_controlled_tree(adb: Adb, *, recover_picker=None) -> None:
    deadline = time.monotonic() + 15
    control: ET.Element | None = None
    while time.monotonic() < deadline:
        control = click_labeled(list(dump_ui(adb).iter()), STORAGE_SELECTION_LABELS)
        if control is not None:
            break
        time.sleep(0.2)
    if control is None:
        raise ScenarioFailure("Android product UI did not expose SAF root selection")
    tap_bounds(adb, control.attrib["bounds"])

    deadline = time.monotonic() + 60
    entered = False
    accepted = False
    last_xml = ""
    while time.monotonic() < deadline:
        root = dump_ui(adb)
        nodes = list(root.iter())
        last_xml = ET.tostring(root, encoding="unicode")
        showing_documents = any(
            "documentsui" in node.attrib.get("package", "").casefold()
            for node in nodes
        )
        if not showing_documents and not accepted:
            retry = click_labeled(nodes, STORAGE_SELECTION_LABELS)
            if retry is not None:
                tap_bounds(adb, retry.attrib["bounds"])
                time.sleep(0.4)
                continue
        entered = any(
            node.attrib.get("text") == GRANT_FOLDER
            and node.attrib.get("resource-id", "").endswith(":id/breadcrumb_text")
            for node in nodes
        )
        if not entered:
            entries = [
                node
                for node in nodes
                if node.attrib.get("resource-id") == "android:id/title"
                and node.attrib.get("text") == GRANT_FOLDER
            ]
            if entries:
                tap_bounds(adb, entries[0].attrib["bounds"])
                time.sleep(0.4)
                continue
        if entered and not accepted:
            use = click_labeled(
                [node for node in nodes if node.attrib.get("enabled") != "false"],
                {"Use this folder", "Select"},
            )
            if use is not None:
                if bounds_area(use.attrib["bounds"]) == 0:
                    if recover_picker is None:
                        raise ScenarioFailure("SAF confirmation is clipped; no usable touch bounds")
                    recover_picker()
                    recover_picker = None
                    # Native window recovery invalidates Android geometry.
                    # Rediscover rather than tapping the previous snapshot.
                    continue
                tap_bounds(adb, use.attrib["bounds"])
                accepted = True
                time.sleep(0.4)
                continue
        if accepted:
            allow = click_labeled(nodes, {"Allow"})
            if allow is not None:
                tap_bounds(adb, allow.attrib["bounds"])
                time.sleep(0.4)
                continue
            if not showing_documents:
                break
        time.sleep(0.25)
    else:
        raise ScenarioFailure(f"could not grant controlled SAF tree:\n{last_xml}")

    preferences = adb.shell(
        "run-as",
        PACKAGE,
        "cat",
        "shared_prefs/product-saf.xml",
    ).stdout
    if GRANT_FOLDER not in preferences:
        raise ScenarioFailure("product did not persist the controlled SAF tree URI")


def add_magnet(adb: Adb, magnet: str) -> None:
    started = adb.shell(
        "am",
        "start",
        "-W",
        "--activity-single-top",
        "-n",
        ACTIVITY,
        "--es",
        "product_magnet",
        shlex.quote(magnet),
        timeout=30,
    )
    if "Status: ok" not in started.stdout:
        raise ScenarioFailure(f"product magnet Activity did not start:\n{started.stdout}")


def product_logs(adb: Adb) -> str:
    return adb.run(
        "logcat",
        "-d",
        "-v",
        "brief",
        f"{TRACE_TAG}:I",
        "AndroidRuntime:E",
        "*:S",
    ).stdout


def wait_for_download(
    adb: Adb,
    screenshot: Path | None,
) -> tuple[str, bool, bool]:
    deadline = time.monotonic() + DOWNLOAD_TIMEOUT_SECONDS
    trace = ""
    lifecycle_checked = False
    control_checked = False
    while time.monotonic() < deadline:
        trace = product_logs(adb)
        if "FATAL EXCEPTION" in trace or f"E/{TRACE_TAG}" in trace:
            raise ScenarioFailure(f"Android product client failed:\n{trace}")
        if not control_checked and "state=DOWNLOADING" in trace:
            verify_pause_resume(adb)
            control_checked = True
            if screenshot is not None:
                time.sleep(0.25)
                adb.capture_screenshot(screenshot)
            trace = product_logs(adb)
        if control_checked and not lifecycle_checked:
            verify_activity_independence(adb)
            lifecycle_checked = True
        if "state=COMPLETE" in trace:
            if not lifecycle_checked or not control_checked:
                raise ScenarioFailure(
                    "controlled download completed before control/lifecycle validation"
                )
            return trace, lifecycle_checked, control_checked
        time.sleep(0.1)
    raise ScenarioFailure(f"Android download did not complete:\n{trace}")


def positive_counter(trace: str, field: str) -> bool:
    return any(
        int(value) > 0
        for value in re.findall(rf"(?:^| ){re.escape(field)}=(\d+)", trace)
    )


def find_control(adb: Adb, label: str) -> ET.Element:
    root = dump_ui(adb)
    controls = [
        node
        for node in root.iter()
        if node.attrib.get("clickable") == "true"
        and any(
            descendant.attrib.get("text") == label
            or descendant.attrib.get("content-desc") == label
            for descendant in node.iter()
        )
    ]
    control = min(controls, key=lambda node: bounds_area(node.attrib["bounds"]), default=None)
    if control is None:
        raise ScenarioFailure(f"Android product UI has no clickable {label} control")
    return control


def bounds_area(bounds: str) -> int:
    match = BOUNDS_PATTERN.fullmatch(bounds)
    if match is None:
        raise ScenarioFailure(f"invalid UI bounds: {bounds}")
    left, top, right, bottom = (int(value) for value in match.groups())
    return (right - left) * (bottom - top)


def wait_for_new_state(adb: Adb, state: str, previous_count: int) -> str:
    deadline = time.monotonic() + 10
    trace = ""
    marker = f"state={state}"
    while time.monotonic() < deadline:
        trace = product_logs(adb)
        if trace.count(marker) > previous_count:
            return trace
        time.sleep(0.1)
    raise ScenarioFailure(f"Android UI did not reach {state}:\n{trace}")


def verify_pause_resume(adb: Adb) -> None:
    trace = product_logs(adb)
    paused_before = trace.count("state=PAUSED")
    tap_bounds(adb, find_control(adb, "Pause").attrib["bounds"])
    trace = wait_for_new_state(adb, "PAUSED", paused_before)
    downloading_before = trace.count("state=DOWNLOADING")
    tap_bounds(adb, find_control(adb, "Resume").attrib["bounds"])
    wait_for_new_state(adb, "DOWNLOADING", downloading_before)


def verify_activity_independence(adb: Adb) -> None:
    pid_before = adb.shell("pidof", PACKAGE).stdout.strip()
    if not pid_before:
        raise ScenarioFailure("Android product process disappeared")
    adb.shell("cmd", "window", "user-rotation", "lock", "1")
    time.sleep(0.5)
    adb.shell("cmd", "window", "user-rotation", "free")
    time.sleep(0.5)
    pid_after = adb.shell("pidof", PACKAGE).stdout.strip()
    if pid_after != pid_before:
        raise ScenarioFailure("Activity recreation replaced the engine process")

    adb.shell(
        "am",
        "start",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.HOME",
    )
    deadline = time.monotonic() + 3
    services = ""
    while time.monotonic() < deadline:
        services = adb.shell("dumpsys", "activity", "services", PACKAGE).stdout
        if "ConnectionRecord" not in services:
            break
        time.sleep(0.1)
    if ".ProductEngineService" not in services or "isForeground=true" not in services:
        raise ScenarioFailure("foreground service did not survive Activity collection")
    if "ConnectionRecord" in services:
        raise ScenarioFailure("Activity remained bound after it entered the background")


def verify_payload(
    adb: Adb,
    expected_hash: str,
) -> None:
    payload = f"{GRANT_PATH}/magnet-fixture/payload.bin"
    completed = adb.shell("sha1sum", payload)
    actual = completed.stdout.split(maxsplit=1)[0] if completed.stdout else ""
    if actual != expected_hash:
        raise ScenarioFailure(
            f"Android payload hash differs: expected {expected_hash}, got {actual}"
        )


def dump_ui(adb: Adb) -> ET.Element:
    adb.shell("uiautomator", "dump", "/sdcard/rstorrent-window.xml")
    xml = adb.shell("cat", "/sdcard/rstorrent-window.xml").stdout
    return ET.fromstring(xml)


def tap_bounds(adb: Adb, bounds: str) -> None:
    match = BOUNDS_PATTERN.fullmatch(bounds)
    if match is None:
        raise ScenarioFailure(f"invalid UI bounds: {bounds}")
    left, top, right, bottom = (int(value) for value in match.groups())
    adb.shell(
        "input",
        "tap",
        str((left + right) // 2),
        str((top + bottom) // 2),
    )


def stop_from_notification(adb: Adb) -> None:
    adb.shell("cmd", "statusbar", "expand-notifications")
    time.sleep(0.5)
    root = dump_ui(adb)
    product_row = next(
        (
            row
            for row in root.iter()
            if row.attrib.get("resource-id")
            == "com.android.systemui:id/expandableNotificationRow"
            and any(node.attrib.get("text") == "RSTorrent" for node in row.iter())
        ),
        None,
    )
    if product_row is None:
        raise ScenarioFailure("RSTorrent foreground notification is absent")
    expand = next(
        (
            node
            for node in product_row.iter()
            if node.attrib.get("content-desc") == "Expand"
        ),
        None,
    )
    if expand is not None:
        tap_bounds(adb, expand.attrib["bounds"])
        time.sleep(0.25)
        root = dump_ui(adb)
    stop = next(
        (
            node
            for node in root.iter()
            if node.attrib.get("text") == "Stop"
            and node.attrib.get("clickable") == "true"
        ),
        None,
    )
    if stop is None:
        raise ScenarioFailure("foreground notification has no Stop action")
    tap_bounds(adb, stop.attrib["bounds"])
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        services = adb.shell("dumpsys", "activity", "services", PACKAGE).stdout
        if ".ProductEngineService" not in services:
            adb.shell("cmd", "statusbar", "collapse")
            return
        time.sleep(0.1)
    raise ScenarioFailure("foreground service did not terminate after Stop")


def run(arguments: argparse.Namespace) -> None:
    if arguments.serial is None:
        raise ScenarioFailure("Android target serial was not resolved")
    adb = Adb(arguments.adb, arguments.serial)
    require_unlocked(adb)
    run_path = Path(tempfile.mkdtemp(prefix="rstorrent-android-reactive-"))
    session: lt.session | None = None
    handle: lt.torrent_handle | None = None
    port: int | None = None
    diagnostics: list[str] = []
    screenshot = (
        arguments.screenshot.resolve() if arguments.screenshot is not None else None
    )
    if screenshot is not None:
        screenshot.unlink(missing_ok=True)
    try:
        fixture = create_fixture(run_path, payload_size=ANDROID_PAYLOAD_SIZE)
        session = create_session()
        session.apply_settings({"upload_rate_limit": UPLOAD_RATE_LIMIT})
        port = wait_for_listener(session, diagnostics)
        handle = add_seed(
            session,
            fixture.torrent_info,
            fixture.seed_directory,
            diagnostics,
        )
        handle.set_upload_limit(UPLOAD_RATE_LIMIT)
        adb.run("reverse", f"tcp:{port}", f"tcp:{port}")
        install_and_start(adb, arguments.apk.resolve())
        select_controlled_tree(adb)
        add_magnet(adb, magnet_uri(fixture.info_hash, f"127.0.0.1:{port}"))
        trace, _, _ = wait_for_download(adb, screenshot)
        if not positive_counter(trace, "verified") or "diagnostic=piece_verified" not in trace:
            raise ScenarioFailure(
                f"Android trace never exposed verified-piece progress:\n{trace}"
            )
        verify_payload(adb, fixture.payload_hash)
        stop_from_notification(adb)
        shutdown_trace = product_logs(adb)
        if "FATAL EXCEPTION" in shutdown_trace:
            raise ScenarioFailure(
                f"Android runtime failed during joined shutdown:\n{shutdown_trace}"
            )
        if "product_shutdown_complete" not in shutdown_trace:
            raise ScenarioFailure(
                f"Android runtime did not report joined shutdown:\n{shutdown_trace}"
            )
        updates = trace.count("view_update")
        adb.shell("pm", "clear", PACKAGE)
        print(
            f"android_serial={arguments.serial} info_hash={fixture.info_hash} "
            f"metadata_size={len(fixture.info_bytes)} "
            f"pieces={fixture.torrent_info.num_pieces()} "
            f"view_updates={updates} activity_recreation=ok "
            f"activity_background=ok payload_sha1={fixture.payload_hash} "
            f"screenshot={screenshot or 'disabled'} "
            "pause_resume=ok foreground_stop=joined cleanup=ok"
        )
    except BaseException:
        if screenshot is not None and not screenshot.exists():
            try:
                adb.capture_screenshot(screenshot)
            except BaseException as screenshot_error:
                print(
                    "Android failure screenshot could not be captured: "
                    f"{screenshot_error}",
                    file=sys.stderr,
                )
        raise
    finally:
        if port is not None:
            adb.run("reverse", "--remove", f"tcp:{port}", check=False)
        adb.shell("am", "force-stop", PACKAGE, check=False)
        adb.shell("pm", "clear", PACKAGE, check=False)
        adb.shell("rm", "-rf", GRANT_PATH, check=False)
        adb.shell("rm", "-f", "/sdcard/rstorrent-window.xml", check=False)
        if session is not None:
            if handle is not None:
                try:
                    session.remove_torrent(handle)
                except RuntimeError:
                    pass
            session.pause()
            session.pop_alerts()
        handle = None
        session = None
        gc.collect()
        shutil.rmtree(run_path, ignore_errors=True)


def main() -> int:
    arguments = parse_arguments()
    print(f"libtorrent_binding_version={lt.__version__}")
    print(f"libtorrent_native_version={lt.version}")
    owned_avd: OwnedHeadlessAvd | None = None
    avd_work: Path | None = None
    try:
        if arguments.avd is not None:
            if not arguments.headless:
                raise ScenarioFailure("--avd requires --headless")
            avd_work = Path(tempfile.mkdtemp(prefix="rstorrent-headless-avd-"))
            owned_avd = OwnedHeadlessAvd.start(
                arguments.avd,
                arguments.adb.resolve(),
                arguments.emulator.resolve(),
                avd_work,
            )
            arguments.serial = owned_avd.serial
            print(
                f"android_target=headless-avd name={owned_avd.name} "
                f"serial={owned_avd.serial}"
            )
        elif arguments.headless:
            raise ScenarioFailure("--headless is only valid with --avd")
        run(arguments)
    except (ScenarioFailure, OSError, subprocess.SubprocessError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    finally:
        if owned_avd is not None:
            owned_avd.close()
        if avd_work is not None:
            shutil.rmtree(avd_work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

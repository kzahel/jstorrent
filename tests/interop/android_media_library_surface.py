#!/usr/bin/env python3
"""Browse a controlled libtorrent seed in the Android Library (Tactical 376)."""

from __future__ import annotations

import argparse
import gc
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import libtorrent as lt

from android_reactive_surface import (
    GRANT_PATH,
    PACKAGE,
    Adb,
    add_magnet,
    dump_ui,
    install_and_start,
    product_logs,
    require_unlocked,
    select_controlled_tree,
    tap_bounds,
)
from browser_media_library_surface import create_media_fixture
from first_verified_piece import (
    ScenarioFailure,
    add_seed,
    create_session,
    wait_for_listener,
)
from headless_avd import OwnedHeadlessAvd, default_adb, default_emulator
from magnet_metadata import magnet_uri

DOWNLOAD_TIMEOUT_SECONDS = 90
UI_TIMEOUT_SECONDS = 20
SHOW_TITLE = "North Shore Stories"
# Episodes of two seasons; the poster and NFO are not media.
EXPECTED_EPISODES = 5


def parse_arguments() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--serial", help="explicitly authorized existing ADB serial")
    target.add_argument("--avd", help="AVD name for a harness-owned emulator")
    parser.add_argument(
        "--headless",
        action="store_true",
        help="required with --avd; launch with no host window",
    )
    parser.add_argument("--adb", type=Path, default=default_adb())
    parser.add_argument("--emulator", type=Path, default=default_emulator())
    parser.add_argument(
        "--apk",
        type=Path,
        default=repository / "clients/android/app/build/outputs/apk/debug/app-debug.apk",
    )
    parser.add_argument(
        "--screenshots",
        type=Path,
        help="directory for PNGs of the Library, the show and the open show",
    )
    return parser.parse_args()


def texts(root: ET.Element) -> list[str]:
    return [
        value
        for node in root.iter()
        for value in (node.attrib.get("text", ""), node.attrib.get("content-desc", ""))
        if value
    ]


def wait_for_ui(adb: Adb, description: str, predicate) -> ET.Element:
    deadline = time.monotonic() + UI_TIMEOUT_SECONDS
    root = dump_ui(adb)
    while time.monotonic() < deadline:
        if predicate(root):
            return root
        time.sleep(0.3)
        root = dump_ui(adb)
    raise ScenarioFailure(
        f"Android Library did not show {description}:\n"
        + "\n".join(texts(root))
    )


def shows(root: ET.Element, fragment: str) -> bool:
    """Compose may merge a row's texts into one accessibility node."""
    return any(fragment in value for value in texts(root))


def clickable_with_text(
    root: ET.Element,
    label: str,
    *,
    exact: bool = True,
) -> ET.Element | None:
    """The smallest clickable node that contains this text."""

    def matches(value: str) -> bool:
        return value == label if exact else label in value

    candidates = [
        node
        for node in root.iter()
        if node.attrib.get("clickable") == "true"
        and any(
            matches(descendant.attrib.get("text", ""))
            or matches(descendant.attrib.get("content-desc", ""))
            for descendant in node.iter()
        )
    ]
    return min(candidates, key=lambda node: area(node.attrib["bounds"]), default=None)


def area(bounds: str) -> int:
    left, top, right, bottom = (
        int(value) for value in bounds.replace("][", ",").strip("[]").split(",")
    )
    return (right - left) * (bottom - top)


def tap_text(adb: Adb, label: str, *, exact: bool = True) -> None:
    root = wait_for_ui(
        adb,
        f"a {label!r} control",
        lambda root: clickable_with_text(root, label, exact=exact) is not None,
    )
    control = clickable_with_text(root, label, exact=exact)
    assert control is not None
    tap_bounds(adb, control.attrib["bounds"])


def decline_statistics(adb: Adb) -> None:
    """A fresh profile first asks about usage statistics; this run sends none."""
    root = wait_for_ui(
        adb,
        "the first-use statistics choice",
        lambda root: shows(root, "Save and continue"),
    )
    option = clickable_with_text(root, "Include usage statistics")
    if option is None:
        raise ScenarioFailure("the statistics choice has no checkbox")
    checked = any(node.attrib.get("checked") == "true" for node in option.iter())
    if checked:
        tap_bounds(adb, option.attrib["bounds"])
        root = wait_for_ui(
            adb,
            "statistics turned off",
            lambda root: not any(
                node.attrib.get("checked") == "true"
                for node in root.iter()
                if node.attrib.get("text") == "Include usage statistics"
                or node.attrib.get("checkable") == "true"
            ),
        )
    tap_text(adb, "Save and continue")
    wait_for_ui(adb, "the dismissed statistics choice", lambda root: not shows(root, "Save and continue"))


def grant_download_folder(adb: Adb) -> None:
    """The shared picker flow, then the product's own readiness as evidence.

    The registry is persisted asynchronously in an encoded form, so the shared
    helper's immediate preference read is not used as the readiness signal.
    """
    try:
        select_controlled_tree(adb)
    except ScenarioFailure as error:
        if "did not persist the controlled SAF tree URI" not in str(error):
            raise
    wait_for_ui(
        adb,
        "a usable download folder",
        lambda root: shows(root, "Add") and not shows(root, "Choose a download folder")
        and not shows(root, "Select folder"),
    )


def wait_for_completion(adb: Adb) -> str:
    deadline = time.monotonic() + DOWNLOAD_TIMEOUT_SECONDS
    trace = ""
    while time.monotonic() < deadline:
        trace = product_logs(adb)
        if "FATAL EXCEPTION" in trace or "E/RSTorrentProduct" in trace:
            raise ScenarioFailure(f"Android product client failed:\n{trace}")
        if "state=COMPLETE" in trace:
            return trace
        time.sleep(0.25)
    raise ScenarioFailure(f"Android download did not complete:\n{trace}")


def navigation_kind(root: ET.Element) -> str:
    """Rail or bar, from where the Library destination sits on the screen."""
    control = clickable_with_text(root, "Library")
    if control is None:
        raise ScenarioFailure("primary navigation has no Library destination")
    left, top, right, bottom = (
        int(value)
        for value in control.attrib["bounds"].replace("][", ",").strip("[]").split(",")
    )
    width, height = (
        int(value)
        for value in root.find(".//node").attrib["bounds"]
        .replace("][", ",").strip("[]").split(",")[2:]
    )
    if top > height * 0.75:
        return "bar"
    if right < width * 0.25:
        return "rail"
    raise ScenarioFailure(f"Library destination is neither a bar nor a rail: {control.attrib}")


def resumed_activity(adb: Adb) -> str:
    activities = adb.shell("dumpsys", "activity", "activities").stdout
    for line in activities.splitlines():
        if "mResumedActivity" in line or "topResumedActivity" in line:
            return line.strip()
    return ""


def capture(adb: Adb, directory: Path | None, name: str) -> None:
    if directory is not None:
        adb.capture_screenshot(directory / f"{name}.png")


def run(arguments: argparse.Namespace) -> None:
    if arguments.serial is None:
        raise ScenarioFailure("Android target serial was not resolved")
    adb = Adb(arguments.adb, arguments.serial)
    require_unlocked(adb)
    run_path = Path(tempfile.mkdtemp(prefix="rstorrent-android-media-library-"))
    session: lt.session | None = None
    handle: lt.torrent_handle | None = None
    port: int | None = None
    diagnostics: list[str] = []
    screenshots = arguments.screenshots.resolve() if arguments.screenshots else None
    try:
        fixture = create_media_fixture(run_path)
        session = create_session()
        port = wait_for_listener(session, diagnostics)
        handle = add_seed(session, fixture.torrent_info, fixture.seed_directory, diagnostics)
        adb.run("reverse", f"tcp:{port}", f"tcp:{port}")
        install_and_start(adb, arguments.apk.resolve())
        decline_statistics(adb)
        grant_download_folder(adb)
        add_magnet(adb, magnet_uri(fixture.info_hash, f"127.0.0.1:{port}"))
        wait_for_completion(adb)

        # A fresh profile opens on Torrents; the Library is one destination away.
        root = wait_for_ui(
            adb,
            "the primary navigation",
            lambda root: clickable_with_text(root, "Library") is not None,
        )
        navigation = navigation_kind(root)
        tap_text(adb, "Library")
        root = wait_for_ui(
            adb,
            "the completed episodes",
            lambda root: shows(root, f"{SHOW_TITLE} S01E01") and shows(root, "S01E01 · "),
        )
        capture(adb, screenshots, "library")
        if clickable_with_text(root, "Play") is None:
            raise ScenarioFailure("completed video rows offer no Play control")
        if "Episodes" in texts(root):
            raise ScenarioFailure("All media unexpectedly shows the Shows/Episodes toggle")

        tap_text(adb, "TV shows")
        root = wait_for_ui(
            adb,
            "one show with its episodes and seasons",
            lambda root: shows(root, f"{EXPECTED_EPISODES} episodes · 2 seasons"),
        )
        capture(adb, screenshots, "shows")
        tap_text(adb, f"{EXPECTED_EPISODES} episodes", exact=False)
        root = wait_for_ui(
            adb,
            "the open show",
            lambda root: shows(root, "S02E01 · ") and not shows(root, "TV shows"),
        )
        capture(adb, screenshots, "show")
        episodes = sum(
            1
            for code in ("S01E01", "S01E02", "S01E07", "S01E10", "S02E01")
            if shows(root, f"{SHOW_TITLE} {code}")
        )
        if episodes < 3:
            raise ScenarioFailure(f"the open show lists {episodes} episodes:\n{texts(root)}")

        # Back closes the show in place rather than leaving the Library.
        adb.shell("input", "keyevent", "KEYCODE_BACK")
        wait_for_ui(
            adb,
            "the show list after Back",
            lambda root: shows(root, "TV shows") and shows(root, "2 seasons"),
        )

        # Play opens the existing player for a completed video.
        tap_text(adb, "All media")
        root = wait_for_ui(
            adb,
            "a Play control",
            lambda root: clickable_with_text(root, "Play") is not None,
        )
        tap_bounds(adb, clickable_with_text(root, "Play").attrib["bounds"])
        deadline = time.monotonic() + UI_TIMEOUT_SECONDS
        while "PlayerActivity" not in resumed_activity(adb):
            if time.monotonic() > deadline:
                raise ScenarioFailure(
                    "Play did not open the player: " + resumed_activity(adb)
                    + "\n" + product_logs(adb)
                )
            time.sleep(0.3)
        trace = product_logs(adb)
        if "media_playback_capability" not in trace or "outcome=created" not in trace:
            raise ScenarioFailure(f"Library Play created no media capability:\n{trace}")
        adb.shell("input", "keyevent", "KEYCODE_BACK")
        wait_for_ui(
            adb,
            "the Library after the player",
            lambda root: shows(root, "All media"),
        )
        if "FATAL EXCEPTION" in product_logs(adb):
            raise ScenarioFailure("Android runtime failed during the Library flow")
        print(
            f"android_serial={arguments.serial} info_hash={fixture.info_hash} "
            f"navigation={navigation} "
            f"show={SHOW_TITLE!r} episodes={EXPECTED_EPISODES} seasons=2 "
            "open_show=ok back_in_place=ok play=PlayerActivity cleanup=ok"
        )
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
            print(f"android_target=headless-avd name={owned_avd.name} serial={owned_avd.serial}")
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

#!/usr/bin/env python3
"""Measure isolated physical Android cold startup through Machine Control.

Requires the inspected qualification APK. Owns only that package's profile,
the qualification SAF folder, controlled seeds and the qualification UI dump.
Never clears device logs or changes an inherited app. No public swarm.
Use Machine Control to maximize the qualification app before this UI run.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

import libtorrent as lt
import android_reactive_surface as product
import chromeos_android_qualification as qualification
from first_verified_piece import add_seed, create_session, wait_for_listener, write_deterministic_payload
from magnet_metadata import magnet_uri


def startup_measurement(log: str) -> dict | None:
    stages = {stage: int(elapsed) for stage, elapsed in re.findall(
        r"product_startup stage=([a-z_]+) elapsed_ms=(\d+)", log)}
    if "ready" not in stages:
        return None
    requests: dict[str, dict[str, int]] = {}
    for operation, elapsed in re.findall(
        r"saf_startup_request operation=([A-Z]+) elapsed_ms=(\d+)", log
    ):
        entry = requests.setdefault(operation, {"count": 0, "total_ms": 0, "max_ms": 0})
        entry["count"] += 1
        entry["total_ms"] += int(elapsed)
        entry["max_ms"] = max(entry["max_ms"], int(elapsed))
    return {"stages_ms": stages, "provider_requests": requests}


def cold_start(adb, deadline_seconds: int = 180, capture=None) -> dict:
    adb.shell("am", "force-stop", qualification.PACKAGE)
    launch = adb.shell("am", "start", "-W", "-n", qualification.ACTIVITY).stdout
    if "Status: ok" not in launch:
        raise RuntimeError("qualification launcher did not report a successful launch")
    if capture:
        capture()
    pid = adb.shell("pidof", qualification.PACKAGE).stdout.strip()
    if not re.fullmatch(r"\d+", pid):
        raise RuntimeError("qualification process identity is ambiguous")
    deadline = time.monotonic() + deadline_seconds
    while time.monotonic() < deadline:
        log = adb.run("logcat", "-d", "--pid", pid, "-s", "RSTorrentProduct:I").stdout
        measured = startup_measurement(log)
        if measured is not None:
            return measured
        time.sleep(1)
    raise RuntimeError("cold startup did not reach its ready checkpoint")


def fixture(directory: Path, name: str, empty_files: int):
    seed = directory / "seed"
    root = seed / name
    root.mkdir(parents=True)
    files = lt.file_storage()
    for index in range(empty_files):
        relative = f"metadata/{index:03}-{'a' * 176}.empty"
        path = root / relative
        path.parent.mkdir(exist_ok=True)
        path.touch()
        files.add_file(f"{name}/{relative}", 0)
    digest = write_deterministic_payload(root / "payload.bin", 256 * 1024)
    files.add_file(f"{name}/payload.bin", 256 * 1024)
    creator = lt.create_torrent(files, piece_size=16 * 1024, flags=lt.create_torrent.v1_only)
    lt.set_piece_hashes(creator, str(seed))
    info = lt.torrent_info(creator.generate())
    assert str(info.info_hashes().v1) == hashlib.sha1(bytes(info.info_section())).hexdigest()
    return info, seed, digest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--seed-address", required=True)
    parser.add_argument("--seed-port", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--repetitions", type=int, default=3, choices=range(1, 4))
    args = parser.parse_args()
    if not 1 <= args.seed_port <= 65535:
        parser.error("an explicit permitted seed port is required")
    command = [str(args.machine_control), "--target", args.target]
    adb = qualification.RemoteAdb(command)
    product.PACKAGE = qualification.PACKAGE
    product.ACTIVITY = qualification.ACTIVITY
    product.GRANT_FOLDER = qualification.FOLDER
    product.GRANT_PATH = qualification.ROOT
    product.require_unlocked(adb)
    if not adb.shell("pm", "path", qualification.PACKAGE).stdout.startswith("package:"):
        raise RuntimeError("install the inspected isolated qualification APK first")
    if adb.shell("test", "-e", qualification.ROOT, check=False).returncode == 0:
        raise RuntimeError("qualification payload folder already exists")
    report = {"schema": "chromeos-android-startup/v1", "result": "fail", "cases": [], "cleanup": "pending"}
    session = create_session()
    session.apply_settings({"listen_interfaces": f"{args.seed_address}:{args.seed_port}"})
    handles = []
    try:
        adb.shell("mkdir", "-p", qualification.ROOT)
        port = wait_for_listener(session, [])
        with tempfile.TemporaryDirectory(prefix="rstorrent-startup253-") as temporary:
            for case, empty_files in [("empty", None), ("single", 0), ("many", 120)]:
                adb.shell("am", "force-stop", qualification.PACKAGE)
                adb.shell("pm", "clear", qualification.PACKAGE)
                adb.shell("pm", "grant", qualification.PACKAGE, "android.permission.POST_NOTIFICATIONS")
                adb.shell("am", "start", "-W", "-n", qualification.ACTIVITY)
                qualification.finish_first_use(adb)
                qualification.select_owned_tree(adb)
                destination = expected = None
                if empty_files is not None:
                    name = f"startup253-{case}"
                    info, seed, expected = fixture(Path(temporary) / case, name, empty_files)
                    handle = add_seed(session, info, seed, [])
                    handles.append(handle)
                    adb.shell("am", "start", "-W", "-n", qualification.ACTIVITY,
                              "-a", "android.intent.action.VIEW", "-d",
                              magnet_uri(str(info.info_hashes().v1), f"{args.seed_address}:{port}"))
                    destination = f"{qualification.ROOT}/{name}/payload.bin"
                    deadline = time.monotonic() + 300
                    confirmed = False
                    while time.monotonic() < deadline:
                        if not confirmed:
                            confirmed = qualification.confirm_intake(adb)
                        if adb.shell("sha1sum", destination, check=False).stdout.split(" ", 1)[0] == expected:
                            # Let native completion/checkpoint publication settle.
                            time.sleep(3)
                            break
                        time.sleep(1)
                    else:
                        raise RuntimeError(f"{case} fixture did not verify")
                    handle.pause()
                record = {"case": case, "files": 0 if empty_files is None else empty_files + 1,
                          "sha1": expected, "cold_starts": []}
                report["cases"].append(record)
                for ordinal in range(args.repetitions):
                    capture = None
                    if args.screenshots and case == "many" and ordinal == 0:
                        args.screenshots.mkdir(parents=True, exist_ok=True)
                        def capture():
                            subprocess.run([*command, "testbed", "--", "screenshot",
                                            str((args.screenshots / "many-starting.png").resolve())],
                                           check=True, capture_output=True, timeout=45)
                    measured = cold_start(adb, capture=capture)
                    if destination:
                        actual = adb.shell("sha1sum", destination).stdout.split(" ", 1)[0]
                        if actual != expected:
                            raise RuntimeError("source-offline restart changed fixture bytes")
                    record["cold_starts"].append(measured)
                    print(json.dumps({"case": case, "ordinal": ordinal + 1, **measured}), flush=True)
                if args.screenshots:
                    args.screenshots.mkdir(parents=True, exist_ok=True)
                    subprocess.run([*command, "testbed", "--", "screenshot",
                                    str((args.screenshots / f"{case}-ready.png").resolve())],
                                   check=True, capture_output=True, timeout=45)
        report["result"] = "pass_measured_startup"
    finally:
        session.pause()
        for handle in handles:
            session.remove_torrent(handle)
        handles.clear()
        session = None
        gc.collect()
        clean = True
        for arguments in [("am", "force-stop", qualification.PACKAGE),
                          ("pm", "clear", qualification.PACKAGE),
                          ("rm", "-rf", qualification.ROOT),
                          ("rm", "-f", "/data/local/tmp/rstorrent253-ui.xml")]:
            try:
                clean = adb.shell(*arguments, check=False).returncode == 0 and clean
            except Exception:
                clean = False
        clean = (adb.shell("test", "-e", qualification.ROOT, check=False).returncode == 1
                 and clean)
        report["cleanup"] = "ok" if clean else "fail"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        if not clean:
            raise RuntimeError("qualification startup cleanup failed; inspect the report")


if __name__ == "__main__":
    main()

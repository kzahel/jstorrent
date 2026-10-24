#!/usr/bin/env python3
"""Run the existing product SAF cohort in a disposable, owned API 35 AVD."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import selectors
import subprocess
import sys
import tempfile
import time
import uuid

REPOSITORY = Path(__file__).resolve().parents[1]
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
TIMEOUT_SECONDS = 600


class SmokeFailure(RuntimeError):
    pass


def run_owned(command: list[str], environment: dict[str, str], root: Path,
              timeout: float = TIMEOUT_SECONDS) -> str:
    """Bound output and time, and terminate the whole owned group on every exit."""
    output = root / "runner.log"
    with output.open("wb") as sink, selectors.DefaultSelector() as selector:
        process = subprocess.Popen(command, cwd=REPOSITORY, env=environment,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout
        captured = bytearray()
        try:
            while selector.get_map() or process.poll() is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise SmokeFailure("runtime_timeout")
                for key, _ in selector.select(timeout=min(0.1, remaining)):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if len(captured) + len(chunk) > MAX_OUTPUT_BYTES:
                        raise SmokeFailure("output_limit")
                    captured.extend(chunk)
                    sink.write(chunk)
                    sink.flush()
            text = captured.decode(errors="replace")
            if process.returncode:
                print(text, file=sys.stderr)
                raise SmokeFailure("runtime_failed")
            return text
        finally:
            # Descendants can survive an exited parent. Always revoke the
            # exclusively owned process group, including on successful exit.
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    break
                if sig == signal.SIGTERM:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass
            process.wait(timeout=5)
            process.stdout.close()


def summarize(output: str) -> dict:
    records = []
    for line in output.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            records.append(record)
    summaries = [row for row in records if row.get("result") == "pass"
                 and row.get("cleanup") == "ok"]
    profiles = [row for row in records if row.get("profile") == "product-file-selection"]
    if len(summaries) != 1 or len(profiles) != 1 or summaries[0].get("results") != 1:
        raise SmokeFailure("missing_runtime_evidence")
    profile = profiles[0]
    if (profile.get("force_recheck") != "passed" or profile.get("removal") != "exact"
            or profile.get("preconfirm_content_upload") != 0
            or profile.get("local_torrent_cancel") != "joined_keep_payload"
            or profile.get("selection", {}).get("skipped_files_absent") is not True
            or profile.get("download_all_before_metadata") != "confirmed"
            or profile.get("download_all_source_selection") != "explicit_all_overrides_so"
            or profile.get("download_all_files") != "hash_verified"):
        raise SmokeFailure("invalid_runtime_evidence")
    metrics = profile.get("storage_metrics", {})
    numeric = {key: value for key, value in metrics.items()
               if key in {"limit", "owned_high_water", "owned", "cached", "pending"}
               and type(value) is int and value >= 0}
    if "limit" not in numeric or "owned_high_water" not in numeric:
        raise SmokeFailure("missing_resource_evidence")
    if numeric["owned_high_water"] > numeric["limit"]:
        raise SmokeFailure("resource_limit")
    all_metrics = profile.get("download_all_storage_metrics", {})
    all_numeric = {key: value for key, value in all_metrics.items()
                   if key in {"limit", "owned_high_water", "owned", "cached", "pending"}
                   and type(value) is int and value >= 0}
    if "limit" not in all_numeric or "owned_high_water" not in all_numeric:
        raise SmokeFailure("missing_resource_evidence")
    if all_numeric["owned_high_water"] > all_numeric["limit"]:
        raise SmokeFailure("resource_limit")
    return {"profile": "product-file-selection", "force_recheck": "passed",
            "removal": "exact", "skipped_files_absent": True,
            "preconfirm_content_upload": 0, "local_torrent_cancel": "joined_keep_payload",
            "storage_metrics": numeric, "cleanup": "ok",
            "download_all_before_metadata": "confirmed",
            "download_all_files": "hash_verified",
            "download_all_source_selection": "explicit_all_overrides_so",
            "download_all_storage_metrics": all_numeric}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = {"schema_version": 1, "result": "fail", "api": 35}
    try:
        sdk_setting = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if not sdk_setting:
            raise SmokeFailure("android_sdk_not_configured")
        sdk = Path(sdk_setting)
        abi = {"arm64": "arm64-v8a", "aarch64": "arm64-v8a", "x86_64": "x86_64"}.get(platform.machine())
        if abi is None or os.name != "posix":
            raise SmokeFailure("unsupported_host")
        package = f"system-images;android-35;google_apis;{abi}"
        properties = sdk / "system-images" / "android-35" / "google_apis" / abi / "source.properties"
        manager = sdk / "cmdline-tools" / "latest" / "bin" / "avdmanager"
        apk = REPOSITORY / "clients/android/app/build/outputs/apk/debug/app-debug.apk"
        for required in (manager, properties, sdk / "emulator/emulator", sdk / "platform-tools/adb", apk):
            if not required.is_file():
                raise SmokeFailure("missing_prerequisite")
        revision = next((line.split("=", 1)[1].strip() for line in properties.read_text().splitlines()
                         if line.startswith("Pkg.Revision=")), None)
        with apk.open("rb") as source:
            apk_sha256 = hashlib.file_digest(source, "sha256").hexdigest()
        report.update(abi=abi, system_image_revision=revision, apk_sha256=apk_sha256)
        with tempfile.TemporaryDirectory(prefix="rstorrent-android-ci-") as temporary:
            root = Path(temporary)
            avd_name = f"rstorrent-ci-{uuid.uuid4().hex}"
            environment = dict(os.environ, ANDROID_AVD_HOME=str(root / "avds"),
                               TMPDIR=str(root), TMP=str(root), TEMP=str(root))
            (root / "avds").mkdir()
            run_owned([str(manager), "create", "avd", "--name", avd_name,
                       "--package", package, "--path", str(root / "image"),
                       "--device", "pixel_2"], environment, root, timeout=60)
            output = run_owned([sys.executable, str(REPOSITORY / "clients/android/run_bootstrap.py"),
                                "--target", "avd", "--avd", avd_name, "--avd-api", "35",
                                "--storage", "saf-internal", "--runs", "1", "--no-build",
                                "--profile", "product-file-selection"], environment, root)
            report.update(summarize(output))
        report["result"] = "pass"
        report["owned_avd_removed"] = not Path(temporary).exists()
    except (SmokeFailure, OSError, subprocess.SubprocessError) as error:
        report["failure_type"] = str(error) if isinstance(error, SmokeFailure) else type(error).__name__
        print(f"Android runtime smoke: {report['failure_type']}", file=sys.stderr)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, sort_keys=True))
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

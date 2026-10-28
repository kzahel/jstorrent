#!/usr/bin/env python3
"""Run the full Android instrumentation suite on fresh API 28 and 35 AVDs."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import subprocess
import sys


REPOSITORY = Path(__file__).resolve().parents[3]
ANDROID = REPOSITORY / "clients" / "android"
PROBE_PATH = REPOSITORY / "experiments" / "android-storage-probe" / "run_probe.py"
DEVICES = {"28": "pixel_6", "35": "pixel_tablet"}


def system_image_abi() -> str:
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x86_64"
    if machine in {"arm64", "aarch64"}:
        return "arm64-v8a"
    raise RuntimeError(f"unsupported Android emulator host architecture {machine!r}")


def load_probe():
    spec = importlib.util.spec_from_file_location("rstorrent_android_probe", PROBE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {PROBE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sdk_tool(name: str) -> str:
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT", ""))
    candidates = [
        sdk / "cmdline-tools" / "latest" / "bin" / name,
        sdk / "cmdline-tools" / "bin" / name,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    resolved = subprocess.run(
        ["bash", "-lc", f"command -v {name}"],
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    return resolved


def avd_exists(avdmanager: str, name: str) -> bool:
    listing = subprocess.run(
        [avdmanager, "list", "avd"],
        text=True,
        capture_output=True,
        check=True,
    ).stdout
    return f"Name: {name}" in listing


def create_avd(avdmanager: str, name: str, api: str, abi: str) -> None:
    if avd_exists(avdmanager, name):
        raise RuntimeError(f"refusing to replace existing AVD {name}")
    subprocess.run(
        [
            avdmanager,
            "create",
            "avd",
            "--name",
            name,
            "--package",
            f"system-images;android-{api};google_apis;{abi}",
            "--device",
            DEVICES[api],
        ],
        input="no\n",
        text=True,
        check=True,
    )


def delete_avd(avdmanager: str, name: str) -> None:
    subprocess.run(
        [avdmanager, "delete", "avd", "--name", name],
        text=True,
        check=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", action="append", choices=["28", "35"])
    parser.add_argument("--class", dest="test_class")
    parser.add_argument("--locale", help="Actual locale for the language switching/layout tests (default: de)")
    arguments = parser.parse_args()
    apis = arguments.api or ["28", "35"]
    abi = system_image_abi()
    avdmanager = sdk_tool("avdmanager")
    probe = load_probe()
    results = []
    for api in apis:
        name = f"rstorrent-localization-api{api}"
        session = None
        created = False
        try:
            create_avd(avdmanager, name, api, abi)
            created = True
            session = probe.start_avd(name, api)
            serial = session.target.prefix[-1]
            environment = os.environ.copy()
            environment["ANDROID_SERIAL"] = serial
            gradle = ["./gradlew", "connectedDebugAndroidTest"]
            if arguments.test_class:
                gradle.append(
                    "-Pandroid.testInstrumentationRunnerArguments.class="
                    + arguments.test_class
                )
            if arguments.locale:
                gradle.append("-Pandroid.testInstrumentationRunnerArguments.locale=" + arguments.locale)
            subprocess.run(
                gradle,
                cwd=ANDROID,
                env=environment,
                check=True,
            )
            results.append(
                {
                    "api": int(api),
                    "device": DEVICES[api],
                    "serial": serial,
                    "release": session.target.property("ro.build.version.release"),
                    "abi": session.target.property("ro.product.cpu.abi"),
                    "display": session.target.shell(["wm", "size"]).stdout.strip(),
                    "result": "passed",
                }
            )
        finally:
            if session is not None:
                session.close()
            if created:
                delete_avd(avdmanager, name)
    print(json.dumps({"android_localization_matrix": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

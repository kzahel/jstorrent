#!/usr/bin/env python3
"""Check tracker timing through a real gateway and production React UI."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import threading
from urllib.parse import quote

from application_surface_harness import build_gateway
from browser_peer_inspection_surface import (
    build_and_start_production_web,
    start_development_gateway,
    terminate_gateway,
)
from browser_surface_harness import reserve_loopback_port, stop_process


class EmptyTracker:
    """Independent bounded BEP 15 fixture: accepted response, no peer traffic."""

    def __init__(self) -> None:
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind(("127.0.0.1", 0))
        self.socket.settimeout(0.2)
        self.port = self.socket.getsockname()[1]
        self.stop = threading.Event()
        self.failure: BaseException | None = None
        self.announces = 0
        self.thread = threading.Thread(target=self.serve, name="tracker-clock-fixture")

    def serve(self) -> None:
        try:
            packets = 0
            while not self.stop.is_set():
                try:
                    data, address = self.socket.recvfrom(2048)
                except socket.timeout:
                    continue
                packets += 1
                if packets > 16 or len(data) < 16:
                    raise RuntimeError("tracker packet bound exceeded or malformed request")
                action, transaction = struct.unpack_from("!II", data, 8)
                if action == 0 and len(data) == 16:
                    response = struct.pack("!IIQ", 0, transaction, 0x0102030405060708)
                elif action == 1 and len(data) == 98:
                    self.announces += 1
                    response = struct.pack("!IIIII", 1, transaction, 600, 11, 37)
                else:
                    raise RuntimeError("unexpected tracker request")
                self.socket.sendto(response, address)
        except BaseException as error:
            self.failure = error

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=2)
        self.socket.close()
        if self.thread.is_alive():
            raise RuntimeError("tracker fixture did not join")
        if self.failure is not None:
            raise RuntimeError("tracker fixture failed") from self.failure


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshot-dir", type=Path)
    parser.add_argument("--binary", type=Path, help="use an already built gateway")
    arguments = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    binary = arguments.binary.resolve() if arguments.binary is not None else build_gateway(repository)
    if not binary.is_file():
        raise RuntimeError(f"gateway binary is unavailable: {binary}")
    tracker = EmptyTracker()
    tracker.thread.start()
    gateway = None
    web = None
    temporary = tempfile.TemporaryDirectory(prefix="rstorrent-tracker-clock-")
    try:
        try:
            root = Path(temporary.name)
            port = reserve_loopback_port()
            origin = f"http://127.0.0.1:{port}"
            gateway, address = start_development_gateway(
                binary, root / "profile", root / "payload", origin,
                disk_pressure=False, bearer=False, lease_millis=30_000,
                bind="127.0.0.1:0",
            )
            web = build_and_start_production_web(repository, origin, port, address)
            tracker_url = f"udp://127.0.0.1:{tracker.port}"
            environment = os.environ.copy()
            environment.update({
                "RSTORRENT_PLAYWRIGHT_BASE_URL": origin,
                "RSTORRENT_TRACKER_COUNTDOWN_URL": tracker_url,
                "RSTORRENT_TRACKER_COUNTDOWN_MAGNET":
                    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"
                    f"&dn=Tracker%20clock%20fixture&tr={quote(tracker_url, safe='')}",
            })
            if arguments.screenshot_dir is not None:
                environment["RSTORRENT_SCREENSHOT_DIR"] = str(arguments.screenshot_dir.resolve())
            subprocess.run(
                ["npm", "run", "test:e2e", "--prefix", "clients/web", "--", "tracker-countdown.spec.ts"],
                cwd=repository, env=environment, check=True, timeout=65,
            )
            if tracker.announces != 1:
                raise RuntimeError(f"expected one unchanged schedule; got {tracker.announces} announces")
        finally:
            try:
                if web is not None:
                    stop_process(web, "production web preview")
            finally:
                try:
                    if gateway is not None:
                        terminate_gateway(gateway)
                finally:
                    tracker.close()
    finally:
        temporary.cleanup()
    print("tracker clock: one announce, joined gateway/web/tracker, temporary profile/payload removed")


if __name__ == "__main__":
    main()

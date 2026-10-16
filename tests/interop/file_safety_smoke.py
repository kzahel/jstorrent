#!/usr/bin/env python3
"""Loopback-only safety/selection, shared-piece promotion and restart gate.

Fixtures are independently generated; no executable is run and no archive is
extracted. The .exe/.zip suffixes exercise selection policy only.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import subprocess
import os
import signal
import time
import urllib.request
import sys
import tempfile
from pathlib import Path

import libtorrent as lt

from application_identity import torrent_id_from_add
from application_lifecycle_smoke import Application
from first_verified_piece import add_seed, create_session, wait_for_listener
from incoming_seeding import gateway_json


def quarantine(path: Path) -> bytes:
    result = subprocess.run(["/usr/bin/xattr", "-px", "com.apple.quarantine", str(path)], capture_output=True, check=False)
    if result.returncode:
        raise OSError("quarantine attribute unavailable")
    return bytes.fromhex(result.stdout.decode())


def files_view(app: Application, torrent_id: str) -> list[dict]:
    opened = gateway_json(app.address, "POST", "/api/v1/view-sets", {
        "views": [{"type": "torrent_files", "view_id": "files", "torrent_id": torrent_id,
                   "delivery": {"min_interval_millis": 0}}], "options": {},
    }, expected_status=201, origin=app.origin)
    try:
        return next(update["snapshot"]["files"] for update in opened["initial"]["updates"]
                    if update.get("snapshot", {}).get("type") == "files")
    finally:
        gateway_json(app.address, "DELETE", f"/api/v1/view-sets/{opened['view_set_id']}", expected_status=204, origin=app.origin)


def run(binary: Path, web_url: str | None = None) -> dict:
    app = None
    session = None
    handle = None
    resources = []
    with tempfile.TemporaryDirectory(prefix="jstorrent-file-safety-") as temporary:
        root = Path(temporary)
        seed = root / "seed"
        seed.mkdir()
        content = seed / "safety"
        content.mkdir()
        payloads = {"movie.mkv": bytes(range(251)) * 137,
                    "setup.exe": b"non-executable fixture" * 17,
                    "ROMs.zip": b"non-archive fixture" * 1801}
        storage = lt.file_storage()
        for name, payload in payloads.items():
            (content / name).write_bytes(payload)
            storage.add_file(f"safety/{name}", len(payload))
        builder = lt.create_torrent(storage, 16 * 1024, flags=lt.create_torrent.v1_only)
        lt.set_piece_hashes(builder, str(seed))
        metainfo = lt.bencode(builder.generate())
        info = lt.torrent_info(metainfo)
        profile, output = root / "profile", root / "downloads"
        try:
            session = create_session()
            diagnostics = []
            port = wait_for_listener(session, diagnostics)
            handle = add_seed(session, info, seed, diagnostics)
            handle.pause()
            app = Application(binary, profile, output, origin=web_url or "http://127.0.0.1:5173")
            torrent_id = torrent_id_from_add(app.command(
                "add_magnet", magnet=f"magnet:?xt=urn:btih:{info.info_hashes().v1}&x.pe=127.0.0.1:{port}",
                storage_root="downloads", start_content=True, await_file_selection=True, skip_files=[],
            ))
            app.command("download_all_pending_add", torrent_id=torrent_id, disable_future=True)
            before_metadata = app.command("snapshot")["snapshot"]["torrents"][0]
            assert not before_metadata["metadata_available"]
            assert not list(output.rglob("movie.mkv"))
            # Changing global rules before metadata arrives must not rewrite
            # the captured recommended policy: ROMs.zip remains selected.
            app.command("update_file_safety_settings", settings={
                "enabled": True, "preset": "archives", "custom_extensions": [], "mark_internet_origin": True,
            })
            resources.append(app.stop())
            app = Application(binary, profile, output, origin=web_url or "http://127.0.0.1:5173")
            handle.resume()
            app.wait(torrent_id, lambda row: row["metadata_available"] and row["state"] == "complete")
            for name in ("movie.mkv", "ROMs.zip"):
                actual = (output / "safety" / name).read_bytes()
                assert hashlib.sha256(actual).digest() == hashlib.sha256(payloads[name]).digest()
            executable = output / "safety/setup.exe"
            assert not executable.exists(), "shared boundary pieces must not materialize a skipped file"
            rows = files_view(app, torrent_id)
            dangerous = next(row for row in rows if row["path"][-1] == "setup.exe")
            assert dangerous["selection"] == "skipped"
            assert dangerous["safety"] == {"matched_extension": ".exe", "preset": "recommended", "overridden": False, "blocked": True}
            if sys.platform == "darwin":
                assert quarantine(output / "safety/movie.mkv").startswith(b"0081;")
            app.command("pause", torrent_id=torrent_id)
            if web_url:
                environment = dict(os.environ, RSTORRENT_PLAYWRIGHT_BASE_URL=web_url,
                    RSTORRENT_FILE_SAFETY_GATEWAY=f"http://{app.address}",
                    RSTORRENT_LIVE_GATEWAY_TOKEN="controlled-reactive-surface-token")
                environment.update(RSTORRENT_WEBUI_PROXY_TARGET=f"http://{app.address}", VITE_RSTORRENT_DEFAULT_LIVE="same-origin")
                port = web_url.rsplit(":", 1)[1]
                with tempfile.TemporaryFile() as vite_log:
                    vite = subprocess.Popen(["npm", "run", "dev", "--prefix", "clients/web", "--", "--host", "127.0.0.1", "--port", port, "--strictPort"],
                                            env=environment, stdout=vite_log, stderr=subprocess.STDOUT, start_new_session=True)
                    try:
                        deadline = time.monotonic() + 30
                        while True:
                            try:
                                if vite.poll() is not None:
                                    raise RuntimeError("owned Vite exited before readiness")
                                # A response from somebody else's process on
                                # this port is not proof our server owns it.
                                owned_output = os.pread(vite_log.fileno(), 64 * 1024, 0)
                                if web_url.encode() not in owned_output:
                                    raise OSError("owned Vite has not advertised its listener")
                                urllib.request.urlopen(web_url, timeout=1).close()
                                break
                            except OSError:
                                if vite.poll() is not None or time.monotonic() > deadline:
                                    raise RuntimeError("owned Vite did not become ready")
                                time.sleep(0.1)
                        subprocess.run(["npm", "run", "test:e2e", "--prefix", "clients/web", "--", "file-safety.spec.ts"],
                                       env=environment, check=True, timeout=120)
                    finally:
                        try:
                            os.killpg(vite.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        try:
                            vite.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            os.killpg(vite.pid, signal.SIGKILL)
                            vite.wait(timeout=5)
                assert not app.command("snapshot")["snapshot"]["torrents"][0]["desired_running"]
            app.command("update_file_safety_settings", settings={
                "enabled": True, "preset": "custom", "custom_extensions": [".zip"], "mark_internet_origin": False,
            })
            app.command("set_file_safety_override", torrent_id=torrent_id,
                        file_indices=[dangerous["file_index"]], allowed=True)
            assert not app.command("snapshot")["snapshot"]["torrents"][0]["desired_running"]
            resources.append(app.stop())
            app = Application(binary, profile, output, origin=web_url or "http://127.0.0.1:5173")
            app.command("resume", torrent_id=torrent_id)
            app.wait(torrent_id, lambda row: row["state"] == "complete" and executable.exists())
            assert executable.read_bytes() == payloads["setup.exe"], "override must promote verified part-file bytes"
            if sys.platform == "darwin":
                try:
                    quarantine(executable)
                except OSError:
                    pass
                else:
                    raise AssertionError("origin marking off must apply to the newly materialized file")
                assert quarantine(output / "safety/movie.mkv").startswith(b"0081;")
            allowed = next(row for row in files_view(app, torrent_id) if row["path"][-1] == "setup.exe")
            assert allowed["safety"]["overridden"] and not allowed["safety"]["blocked"]
            app.command("set_file_safety_override", torrent_id=torrent_id,
                        file_indices=[dangerous["file_index"]], allowed=False)
            assert executable.read_bytes() == payloads["setup.exe"], "undo must never delete downloaded user data"
            resources.append(app.stop())
            app = None
            # A newly added torrent whose entire catalog is excluded must idle
            # without becoming Complete or entering a download-error loop.
            handle.pause()
            session.pause()
            handle = None
            session = None
            gc.collect()
            session = create_session()
            port = wait_for_listener(session, diagnostics)
            handle = add_seed(session, info, seed, diagnostics)
            handle.resume()
            excluded_output = root / "all-excluded-downloads"
            app = Application(binary, root / "all-excluded-profile", excluded_output)
            app.command("update_file_safety_settings", settings={
                "enabled": True, "preset": "custom", "custom_extensions": [".exe", ".mkv", ".zip"], "mark_internet_origin": True,
            })
            excluded_id = torrent_id_from_add(app.command("add_magnet",
                magnet=f"magnet:?xt=urn:btih:{info.info_hashes().v1}&x.pe=127.0.0.1:{port}",
                storage_root="downloads", start_content=True, await_file_selection=False, skip_files=[]))
            app.wait(excluded_id, lambda row: row["metadata_available"] and row["state"] == "paused")
            time.sleep(0.2)
            excluded = app.command("snapshot")["snapshot"]["torrents"][0]
            assert excluded["state"] == "paused" and excluded["safety_summary"]["blocked_file_count"] == 3
            assert not any(path.is_file() for path in excluded_output.rglob("*"))
            resources.append(app.stop())
            app = None
            return {"result": "passed", "all_excluded_idle": True, "metadata_gate": True, "captured_rules": True,
                    "shared_piece_skip_and_promotion": True, "pause_and_restart": True,
                    "origin_toggle_native_macos": sys.platform == "darwin", "resources": resources}
        finally:
            if app is not None:
                app.cleanup()
            if handle is not None:
                handle.pause()
            if session is not None:
                session.pause()
            handle = None
            session = None
            gc.collect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--web-url", help="Owned Vite URL for the controlled browser test")
    arguments = parser.parse_args()
    print(json.dumps(run(arguments.binary.resolve(), arguments.web_url), indent=2))

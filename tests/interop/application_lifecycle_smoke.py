#!/usr/bin/env python3
"""Bounded application intake, integrity, restart, seeding and repair gate."""

from __future__ import annotations

import argparse
import gc
import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import libtorrent as lt

from application_identity import torrent_id_from_add
from application_surface_harness import (
    ORIGIN, TOKEN, application_metrics, build_gateway, connection_metrics,
    start_gateway, stop_gateway,
)
from first_verified_piece import ScenarioFailure, add_seed, create_session, wait_for_listener
from incoming_seeding import (
    GATEWAY_OWNER, GatewayViews, assert_resource_bounds,
    create_outbound_only_session, gateway_json,
)
from unified_resume_recheck import (
    OVERSIZED_SUFFIX, PIECE_SIZE, REFERENCE_REVISION, create_fixture, final_file, sha256_file, verify_final,
)

TRANSITION_SECONDS = 30


class Application:
    def __init__(self, binary: Path, profile: Path, storage: Path, origin: str = ORIGIN):
        self.origin = origin
        self.process, self.address = start_gateway(binary, profile, storage, origin=origin)
        self.sequence = 0
        self.instance = uuid.uuid4().hex

    def command(self, kind: str, **fields: object) -> dict:
        self.sequence += 1
        response = gateway_json(self.address, "POST", "/api/v1/commands", {
            "version": 1,
            "request_id": f"{self.instance}-{self.sequence}",
            "command": {"type": kind, **fields},
        }, origin=self.origin)
        if response.get("status") != "success":
            raise ScenarioFailure(f"application rejected {kind}: {response}")
        return response

    def wait(self, torrent_id: str, predicate) -> dict:
        deadline = time.monotonic() + TRANSITION_SECONDS
        last = None
        while time.monotonic() < deadline:
            rows = self.command("snapshot")["snapshot"]["torrents"]
            if len(rows) != 1 or rows[0]["torrent_id"] != torrent_id:
                raise ScenarioFailure("application lost the single torrent identity")
            last = rows[0]
            if predicate(last):
                return last
            if last["state"] == "needs_repair":
                raise ScenarioFailure("application entered unexpected storage repair")
            time.sleep(0.02)
        raise ScenarioFailure(f"application transition timed out: {last}")

    def complete(self, torrent_id: str, pieces: int) -> None:
        row = self.wait(torrent_id, lambda row: row["state"] == "complete")
        if row["verified_piece_count"] != pieces or row["piece_count"] != pieces:
            raise ScenarioFailure("completion did not establish exact verified authority")

    def upload(self, source: bytes) -> dict:
        query = urllib.parse.urlencode({
            "request_id": "lifecycle-file", "storage_root": "downloads",
            "start_content": "false", "selection": "all",
        })
        request = urllib.request.Request(
            f"http://{self.address}/api/v1/torrents?{query}", data=source,
            headers={"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN,
                     "X-RSTorrent-Owner": GATEWAY_OWNER,
                     "Content-Type": "application/x-bittorrent"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            result = json.load(response)
        if result.get("status") != "success":
            raise ScenarioFailure("application rejected independently encoded torrent bytes")
        return result

    def stop(self) -> dict:
        diagnostics = stop_gateway(self.process)
        resources = application_metrics(diagnostics)
        if connection_metrics(diagnostics)["active_connections"] != 0:
            raise ScenarioFailure("gateway retained application connections")
        for field in ("storage_owned_after_shutdown", "storage_cached_after_shutdown",
                      "platform_pending_after_shutdown"):
            if resources[field] != 0:
                raise ScenarioFailure(f"joined shutdown retained {field}")
        if resources["incoming_owner_after_shutdown"]:
            raise ScenarioFailure("joined shutdown retained its incoming owner")
        if resources["storage_owned_high_water"] > resources["storage_limit"]:
            raise ScenarioFailure("storage handle budget exceeded")
        incoming = resources["incoming"]
        if incoming is not None:
            assert_resource_bounds(incoming, minimum_established=0)
        host, port = self.address.rsplit(":", 1)
        try:
            with socket.create_connection((host, int(port)), timeout=1):
                raise ScenarioFailure("gateway listener survived joined shutdown")
        except ConnectionRefusedError:
            pass
        # Only bounded scalar resource observations enter retained evidence.
        return {
            "storage_owned_high_water": resources["storage_owned_high_water"],
            "incoming": {key: value for key, value in (incoming or {}).items()
                         if key.endswith("high_water") or key == "payload_bytes_sent"},
            "joined": True,
        }

    def cleanup(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.communicate(timeout=5)


def seed_copy(app: Application, torrent_id: str, fixture, output: Path) -> None:
    views = GatewayViews.open(app.address, torrent_id)
    session = create_outbound_only_session()
    handle = None
    try:
        host, port = views.listener.rsplit(":", 1)
        if host != "127.0.0.1":
            raise ScenarioFailure("application peer listener is not loopback")
        parameters = lt.add_torrent_params()
        parameters.ti = fixture.torrent_info
        parameters.save_path = str(output)
        parameters.flags &= ~lt.torrent_flags.paused
        parameters.flags &= ~lt.torrent_flags.auto_managed
        handle = session.add_torrent(parameters)
        handle.connect_peer((host, int(port)))
        deadline = time.monotonic() + TRANSITION_SECONDS
        while time.monotonic() < deadline:
            session.pop_alerts()
            status = handle.status()
            if status.errc.value():
                raise ScenarioFailure("independent leecher reported a storage/peer error")
            if status.is_seeding:
                break
            time.sleep(0.02)
        else:
            raise ScenarioFailure("restored application did not seed a complete copy")
        verify_final(output, fixture)
    finally:
        if handle is not None and handle.is_valid():
            session.remove_torrent(handle)
        session.pause()
        handle = None
        session = None
        gc.collect()
        views.close()


def run_case(binary: Path, shape: str, oversized: bool = False) -> dict:
    started = time.monotonic()
    stage = "intake"
    app = None
    seed_session = None
    seed_handle = None
    resources = []
    with tempfile.TemporaryDirectory(prefix="rstorrent-lifecycle-") as temporary:
        root = Path(temporary)
        fixture = create_fixture(root, shape)
        storage = root / "downloads"
        storage.mkdir()
        sentinel = storage / "unrelated.txt"
        sentinel.write_bytes(b"unrelated user content\n")
        try:
            seed_session = create_session()
            diagnostics = []
            port = wait_for_listener(seed_session, diagnostics)
            seed_handle = add_seed(seed_session, fixture.torrent_info,
                                   fixture.seed_directory, diagnostics)
            app = Application(binary, root / "profile", storage)
            torrent_id = torrent_id_from_add(app.command(
                "add_magnet", magnet=f"magnet:?xt=urn:btih:{fixture.info_hash}&x.pe=127.0.0.1:{port}",
                storage_root="downloads", start_content=True, skip_files=[],
            ))
            pieces = fixture.torrent_info.num_pieces()
            stage = "initial completion"
            app.complete(torrent_id, pieces)
            verify_final(storage, fixture)
            file_id = torrent_id_from_add(app.upload(fixture.torrent_path.read_bytes()))
            if torrent_id != file_id:
                raise ScenarioFailure("file/magnet duplicate created a second owner")
            if seed_handle.status().total_payload_upload != fixture.torrent_info.total_size():
                raise ScenarioFailure("fresh download did not transfer the exact payload")
            # Stop the source before restart: restored seeding cannot borrow its data.
            seed_handle.pause()
            resources.append(app.stop())
            if oversized:
                with final_file(storage, fixture, fixture.files[0]).open("ab") as payload:
                    payload.write(OVERSIZED_SUFFIX)
            app = Application(binary, root / "profile", storage)
            stage = "restored completion"
            app.complete(torrent_id, pieces)
            stage = "restored seeding"
            seed_copy(app, torrent_id, fixture, root / "first-leech")

            app.command("pause", torrent_id=torrent_id)
            app.wait(torrent_id, lambda row: not row["desired_running"])
            # A one-byte mutation in piece zero also exercises a cross-file piece.
            damaged = final_file(storage, fixture, fixture.files[0])
            with damaged.open("r+b") as payload:
                original = payload.read(1)
                payload.seek(0)
                payload.write(bytes([original[0] ^ 0xFF]))
            app.command("force_recheck", torrent_id=torrent_id)
            stage = "corrupt-piece invalidation"
            app.wait(torrent_id, lambda row: row["state"] != "checking"
                     and row["verified_piece_count"] == pieces - 1)
            seed_handle.resume()
            deadline = time.monotonic() + TRANSITION_SECONDS
            while seed_handle.status().flags & lt.torrent_flags.paused:
                if time.monotonic() >= deadline:
                    raise ScenarioFailure("controlled source did not resume")
                time.sleep(0.02)
            before_repair = seed_handle.status().total_payload_upload
            app.command("resume", torrent_id=torrent_id)
            stage = "repair completion"
            app.complete(torrent_id, pieces)
            verify_final(storage, fixture, preserve_oversized_suffix=oversized)
            repair_bytes = seed_handle.status().total_payload_upload - before_repair
            if repair_bytes != PIECE_SIZE:
                raise ScenarioFailure(f"repair transferred {repair_bytes}, expected {PIECE_SIZE}")
            seed_handle.pause()
            seed_copy(app, torrent_id, fixture, root / "repaired-leech")
            app.command("remove_torrent", torrent_id=torrent_id, data="keep")
            if app.command("snapshot")["snapshot"]["torrents"]:
                raise ScenarioFailure("keep-data removal retained the application row")
            verify_final(storage, fixture, preserve_oversized_suffix=oversized)
            if sentinel.read_bytes() != b"unrelated user content\n":
                raise ScenarioFailure("lifecycle modified unrelated content")
            resources.append(app.stop())
            app = None
            hashes = [file.sha1 for file in fixture.files]
        except ScenarioFailure as error:
            if seed_handle is not None:
                status = seed_handle.status()
                print(f"{shape}: {stage}: seed peers={status.num_peers} "
                      f"upload={status.total_payload_upload}", file=sys.stderr)
                for alert in seed_session.pop_alerts()[-12:]:
                    print(alert.message(), file=sys.stderr)
            raise ScenarioFailure(f"{shape}: {stage}: {error}") from error
        finally:
            if app is not None:
                app.cleanup()
            if seed_handle is not None and seed_handle.is_valid():
                seed_session.remove_torrent(seed_handle)
            if seed_session is not None:
                seed_session.pause()
            seed_handle = None
            seed_session = None
            gc.collect()
    if Path(temporary).exists():
        raise ScenarioFailure("fixture directory survived cleanup")
    return {"case": shape, "oversized": oversized, "pieces": pieces, "payload_sha1": hashes,
            "repair_bytes": repair_bytes, "seeded_copies": 2,
            "resources": resources, "cleanup": True,
            "elapsed_seconds": round(time.monotonic() - started, 3)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--extended", action="store_true", help="also verify oversized restart and seeding")
    args = parser.parse_args()
    result = {"schema_version": 1, "result": "fail", "cases": [],
              "libtorrent_version": lt.__version__, "reference_revision": REFERENCE_REVISION}
    try:
        binary = (args.binary or build_gateway(Path(__file__).resolve().parents[2])).resolve()
        result["binary_sha256"] = sha256_file(binary)
        for shape in ("length", "cross_file"):
            result["cases"].append(run_case(binary, shape))
        if args.extended:
            for shape in ("length", "one_entry_files"):
                result["cases"].append(run_case(binary, shape, oversized=True))
        result["result"] = "pass"
    except (ScenarioFailure, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        # Raw failures stay in transient console output; retained JSON is allowlisted.
        print(f"lifecycle failure: {error}", file=sys.stderr)
        result["failure_type"] = type(error).__name__
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    print(encoded, end="")
    return 0 if result["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

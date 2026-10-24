#!/usr/bin/env python3
"""Prove application-owned incoming seeding against controlled peers."""

from __future__ import annotations

import gc
import hashlib
import json
import selectors
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import libtorrent as lt

from first_verified_piece import DEFAULT_PAYLOAD_ALLOWANCE, ScenarioFailure
from application_surface_harness import (
    ORIGIN,
    TOKEN,
    application_metrics,
    connection_metrics,
    start_gateway,
    stop_gateway,
)


PIECE_SIZE = 16 * 1024
TRANSFER_TIMEOUT_SECONDS = 20
PROCESS_TIMEOUT_SECONDS = 30
GATEWAY_OWNER = "08600000000000000000000000000000"


@dataclass(frozen=True)
class Fixture:
    name: str
    torrent_path: Path
    storage_root: Path
    profile_root: Path
    torrent_info: lt.torrent_info
    info_hash: str
    files: tuple[tuple[Path, str], ...]
    output_is_file: bool

    @property
    def total_size(self) -> int:
        return self.torrent_info.total_size()


@dataclass(frozen=True)
class SeedRun:
    ready: dict[str, object]
    stopped: dict[str, object]


@dataclass
class GatewayViews:
    address: str
    view_set_id: str
    cursor: str
    listener: str
    peers: dict[str, dict[str, object]]
    peer_history: dict[str, dict[str, object]]
    swarm: dict[str, dict[str, object]]
    swarm_state: str

    @classmethod
    def open(cls, address: str, torrent_id: str) -> GatewayViews:
        response = gateway_json(
            address,
            "POST",
            "/api/v1/view-sets",
            {
                "views": [
                    {
                        "type": "torrent_list",
                        "view_id": "library",
                        "delivery": {"min_interval_millis": 0},
                    },
                    {
                        "type": "torrent_peers",
                        "view_id": "peers",
                        "torrent_id": torrent_id,
                        "delivery": {"min_interval_millis": 0},
                    },
                    {
                        "type": "torrent_swarm",
                        "view_id": "swarm",
                        "torrent_id": torrent_id,
                        "delivery": {"min_interval_millis": 0},
                    },
                ],
                "options": {},
            },
            expected_status=201,
        )
        initial = object_field(response, "initial")
        views = cls(
            address=address,
            view_set_id=string_field(response, "view_set_id"),
            cursor=string_field(initial, "cursor"),
            listener="",
            peers={},
            peer_history={},
            swarm={},
            swarm_state="torrent_missing",
        )
        views.apply_batch(initial)
        if not views.listener:
            raise ScenarioFailure("gateway view lacks the active incoming listener")
        return views

    def apply_batch(self, batch: dict[str, object]) -> None:
        updates = batch.get("updates")
        if not isinstance(updates, list):
            raise ScenarioFailure("gateway view batch lacks updates")
        for update in updates:
            if not isinstance(update, dict):
                raise ScenarioFailure("gateway view update is not an object")
            update_type = update.get("type")
            if update_type == "reset_required":
                raise ScenarioFailure(f"gateway view unexpectedly reset: {update}")
            payload = update.get("snapshot") if update_type == "snapshot" else update.get("patch")
            if update_type not in ("snapshot", "patch") or not isinstance(payload, dict):
                continue
            projection = payload.get("type")
            if projection == "torrent_list":
                settings = payload.get("client_settings")
                if isinstance(settings, dict):
                    status = settings.get("listener_status")
                    if isinstance(status, dict) and status.get("type") == "listening":
                        port = status.get("port")
                        if not isinstance(port, int):
                            raise ScenarioFailure("gateway listener port is not an integer")
                        self.listener = f"{string_field(status, 'address')}:{port}"
            elif projection == "peers":
                if update_type == "snapshot":
                    rows = object_list(payload, "peers")
                    self.peers = {
                        string_field(row, "connection_id"): row for row in rows
                    }
                else:
                    for row in object_list(payload, "upsert"):
                        self.peers[string_field(row, "connection_id")] = row
                    for connection_id in string_list(payload, "removed"):
                        self.peers.pop(connection_id, None)
                for connection_id, row in self.peers.items():
                    self.peer_history[connection_id] = row.copy()
            elif projection == "swarm":
                self.swarm_state = string_field(payload, "state")
                if update_type == "snapshot":
                    rows = object_list(payload, "peers")
                    self.swarm = {
                        string_field(row, "peer_record_id"): row for row in rows
                    }
                else:
                    for row in object_list(payload, "upsert"):
                        self.swarm[string_field(row, "peer_record_id")] = row
                    for record_id in string_list(payload, "removed"):
                        self.swarm.pop(record_id, None)
        self.cursor = string_field(batch, "cursor")

    def poll(self, wait_millis: int = 100) -> None:
        query = urllib.parse.urlencode(
            {"after": self.cursor, "wait_ms": str(wait_millis)}
        )
        batch = gateway_json(
            self.address,
            "GET",
            f"/api/v1/view-sets/{self.view_set_id}/updates?{query}",
        )
        self.apply_batch(batch)

    def close(self) -> None:
        gateway_json(
            self.address,
            "DELETE",
            f"/api/v1/view-sets/{self.view_set_id}",
            expected_status=204,
        )


def gateway_json(
    address: str,
    method: str,
    path: str,
    payload: dict[str, object] | None = None,
    *,
    expected_status: int = 200,
    origin: str = ORIGIN,
) -> dict[str, object]:
    encoded = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        f"http://{address}{path}",
        data=encoded,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Origin": origin,
            "X-RSTorrent-Owner": GATEWAY_OWNER,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
            body = response.read()
    except urllib.error.HTTPError as error:
        raise ScenarioFailure(
            f"gateway {method} {path} failed with {error.code}: "
            f"{error.read().decode(errors='replace')}"
        ) from error
    if status != expected_status:
        raise ScenarioFailure(
            f"gateway {method} {path} returned {status}, expected {expected_status}"
        )
    if not body:
        return {}
    decoded = json.loads(body)
    if not isinstance(decoded, dict):
        raise ScenarioFailure("gateway response is not a JSON object")
    return decoded


def string_field(observation: dict[str, object], field: str) -> str:
    value = observation.get(field)
    if not isinstance(value, str):
        raise ScenarioFailure(f"gateway observation field {field} is not a string")
    return value


def object_field(
    observation: dict[str, object], field: str
) -> dict[str, object]:
    value = observation.get(field)
    if not isinstance(value, dict):
        raise ScenarioFailure(f"gateway observation field {field} is not an object")
    return value


def object_list(
    observation: dict[str, object], field: str
) -> list[dict[str, object]]:
    value = observation.get(field)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ScenarioFailure(f"gateway observation field {field} is not an object list")
    return value


def string_list(observation: dict[str, object], field: str) -> list[str]:
    value = observation.get(field)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ScenarioFailure(f"gateway observation field {field} is not a string list")
    return value


def deterministic_bytes(offset: int, length: int) -> bytes:
    return bytes(((offset + index) * 37 + 11) % 251 for index in range(length))


def write_payload(path: Path, offset: int, length: int) -> str:
    payload = deterministic_bytes(offset, length)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return hashlib.sha1(payload).hexdigest()


def create_single_fixture(root: Path) -> Fixture:
    fixture_root = root / "single"
    storage_root = fixture_root / "published"
    storage_root.mkdir(parents=True)
    payload_name = "incoming-single.bin"
    payload_length = 64 * 1024 * 1024 + 731
    payload_path = storage_root / payload_name
    expected_hash = write_payload(payload_path, 0, payload_length)

    files = lt.file_storage()
    files.add_file(payload_name, payload_length)
    creator = lt.create_torrent(
        files,
        piece_size=PIECE_SIZE,
        flags=lt.create_torrent.v1_only,
    )
    lt.set_piece_hashes(creator, str(storage_root))
    torrent_path = fixture_root / "single.torrent"
    torrent_path.write_bytes(bytes(lt.bencode(creator.generate())))
    torrent_info = lt.torrent_info(str(torrent_path))
    validate_fixture(
        torrent_info,
        expected_pieces=(payload_length + PIECE_SIZE - 1) // PIECE_SIZE,
        expected_size=payload_length,
    )
    return Fixture(
        name="single",
        torrent_path=torrent_path,
        storage_root=storage_root,
        profile_root=fixture_root / "profile",
        torrent_info=torrent_info,
        info_hash=str(torrent_info.info_hashes().v1),
        files=((Path(payload_name), expected_hash),),
        output_is_file=True,
    )


def create_multi_fixture(root: Path) -> Fixture:
    fixture_root = root / "multi"
    storage_root = fixture_root / "published"
    torrent_root = storage_root / "incoming-multi"
    torrent_root.mkdir(parents=True)
    file_shapes = (
        (Path("a.bin"), 7_000),
        (Path("nested/b.bin"), 4_200_777),
        (Path("c.bin"), 4_193_456),
    )
    files = lt.file_storage()
    expected: list[tuple[Path, str]] = []
    offset = 0
    for relative, length in file_shapes:
        expected.append(
            (relative, write_payload(torrent_root / relative, offset, length))
        )
        files.add_file(f"incoming-multi/{relative.as_posix()}", length)
        offset += length

    creator = lt.create_torrent(
        files,
        piece_size=PIECE_SIZE,
        flags=lt.create_torrent.v1_only,
    )
    lt.set_piece_hashes(creator, str(storage_root))
    torrent_path = fixture_root / "multi.torrent"
    torrent_path.write_bytes(bytes(lt.bencode(creator.generate())))
    torrent_info = lt.torrent_info(str(torrent_path))
    validate_fixture(
        torrent_info,
        expected_pieces=(offset + PIECE_SIZE - 1) // PIECE_SIZE,
        expected_size=offset,
    )
    if file_shapes[0][1] >= PIECE_SIZE:
        raise ScenarioFailure("multi-file fixture no longer crosses its first boundary")
    if offset % PIECE_SIZE == 0:
        raise ScenarioFailure("multi-file fixture no longer has a short final piece")
    return Fixture(
        name="multi",
        torrent_path=torrent_path,
        storage_root=storage_root,
        profile_root=fixture_root / "profile",
        torrent_info=torrent_info,
        info_hash=str(torrent_info.info_hashes().v1),
        files=tuple(expected),
        output_is_file=False,
    )


def validate_fixture(
    torrent_info: lt.torrent_info,
    *,
    expected_pieces: int,
    expected_size: int,
) -> None:
    if torrent_info.piece_length() != PIECE_SIZE:
        raise ScenarioFailure("fixture piece size changed")
    if torrent_info.num_pieces() != expected_pieces:
        raise ScenarioFailure(
            f"fixture has {torrent_info.num_pieces()} pieces, expected {expected_pieces}"
        )
    if torrent_info.total_size() != expected_size:
        raise ScenarioFailure("fixture total size changed")
    if any(True for _ in torrent_info.trackers()):
        raise ScenarioFailure("controlled fixture unexpectedly contains a tracker")


def build_binaries(repository: Path) -> tuple[Path, Path, Path]:
    command = [
        "cargo",
        "build",
        "-p",
        "rstorrent-session",
        "--bin",
        "rstorrent-incoming-seed",
        "-p",
        "rstorrent-engine",
        "--bin",
        "rstorrent-download-piece",
        "-p",
        "rstorrent-gateway",
        "--bin",
        "rstorrent-gateway",
    ]
    completed = subprocess.run(
        command,
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if completed.returncode != 0:
        raise ScenarioFailure(
            "failed to build incoming-seeding diagnostics\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    seed = repository / "target/debug/rstorrent-incoming-seed"
    leech = repository / "target/debug/rstorrent-download-piece"
    gateway = repository / "target/debug/rstorrent-gateway"
    if not seed.is_file() or not leech.is_file() or not gateway.is_file():
        raise ScenarioFailure("incoming-seeding diagnostic binaries were not created")
    return seed, leech, gateway


def read_json_line(
    process: subprocess.Popen[str],
    timeout_seconds: float,
) -> dict[str, object]:
    if process.stdout is None:
        raise ScenarioFailure("seed harness stdout is unavailable")
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    try:
        if not selector.select(timeout_seconds):
            raise ScenarioFailure("seed harness did not report readiness")
        line = process.stdout.readline()
    finally:
        selector.close()
    if not line:
        stderr = process.stderr.read() if process.stderr is not None else ""
        raise ScenarioFailure(
            f"seed harness exited before readiness\nstderr:\n{stderr}"
        )
    try:
        value = json.loads(line)
    except json.JSONDecodeError as error:
        raise ScenarioFailure(f"invalid seed observation {line!r}: {error}") from error
    if not isinstance(value, dict):
        raise ScenarioFailure("seed observation is not a JSON object")
    return value


def start_seed(
    binary: Path,
    fixture: Fixture,
    encryption: str | None = None,
) -> tuple[subprocess.Popen[str], dict[str, object]]:
    command = [
        str(binary),
        "--profile-root",
        str(fixture.profile_root),
        "--storage-root",
        str(fixture.storage_root),
        "--metainfo",
        str(fixture.torrent_path),
    ]
    if encryption is not None:
        command.extend(["--encryption", encryption])
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        ready = read_json_line(process, 30)
        if ready.get("event") != "ready":
            raise ScenarioFailure(f"unexpected seed readiness observation: {ready}")
        if ready.get("info_hash") != fixture.info_hash:
            raise ScenarioFailure("seed harness registered the wrong torrent")
        if ready.get("registrations") != 1:
            raise ScenarioFailure("seed harness did not own exactly one registration")
        return process, ready
    except BaseException:
        terminate_process(process)
        raise


def stop_seed(
    process: subprocess.Popen[str],
    expected_payload: int,
    minimum_established: int,
) -> dict[str, object]:
    if process.stdin is None:
        raise ScenarioFailure("seed harness stdin is unavailable")
    process.stdin.write("\n")
    process.stdin.flush()
    stopped = read_json_line(process, 10)
    try:
        returncode = process.wait(timeout=10)
    except subprocess.TimeoutExpired as error:
        terminate_process(process)
        raise ScenarioFailure("seed harness did not complete joined shutdown") from error
    stderr = process.stderr.read() if process.stderr is not None else ""
    if returncode != 0:
        raise ScenarioFailure(
            f"seed harness exited with status {returncode}\nstderr:\n{stderr}"
        )
    if stopped.get("event") != "stopped":
        raise ScenarioFailure(f"unexpected seed shutdown observation: {stopped}")
    payload = integer_field(stopped, "payload_bytes_sent")
    if payload < expected_payload:
        raise ScenarioFailure(
            f"seed sent {payload} payload bytes, expected at least {expected_payload}"
        )
    assert_resource_bounds(stopped, minimum_established)
    return stopped


def seed_snapshot(process: subprocess.Popen[str]) -> dict[str, object]:
    if process.stdin is None:
        raise ScenarioFailure("seed harness stdin is unavailable")
    process.stdin.write("snapshot\n")
    process.stdin.flush()
    snapshot = read_json_line(process, 5)
    if snapshot.get("event") != "snapshot":
        raise ScenarioFailure(f"unexpected live seed observation: {snapshot}")
    return snapshot


def integer_field(observation: dict[str, object], field: str) -> int:
    value = observation.get(field)
    if not isinstance(value, int):
        raise ScenarioFailure(f"seed observation field {field} is not an integer")
    return value


def assert_resource_bounds(
    observation: dict[str, object], minimum_established: int
) -> None:
    limits = {
        "pending_high_water": 8,
        "established_high_water": 210,
        "connection_high_water": 210,
        "queued_requests_high_water": 2_000,
        "queued_bytes_high_water": 2_000 * 16 * 1024,
        "read_high_water": 10,
        "read_bytes_high_water": 10 * 16 * 1024,
        "writer_send_buffer_high_water": 528_396,
        "upload_slots_high_water": 8,
        "upload_optimistic_high_water": 1,
    }
    for field, maximum in limits.items():
        actual = integer_field(observation, field)
        if actual > maximum:
            raise ScenarioFailure(f"{field} reached {actual}, exceeding {maximum}")
    established = integer_field(observation, "established_high_water")
    if established < minimum_established:
        raise ScenarioFailure(
            f"established high water reached {established}, "
            f"expected at least {minimum_established}"
        )
    connections = integer_field(observation, "connection_high_water")
    if connections < minimum_established:
        raise ScenarioFailure(
            f"connection high water reached {connections}, "
            f"expected at least {minimum_established}"
        )
    slots = integer_field(observation, "upload_slots_high_water")
    if slots < minimum_established:
        raise ScenarioFailure(
            f"upload slot high water reached {slots}, "
            f"expected at least {minimum_established}"
        )


def parse_address(ready: dict[str, object]) -> tuple[str, int]:
    address = ready.get("listen")
    if not isinstance(address, str):
        raise ScenarioFailure("seed readiness lacks a listener address")
    host, separator, port = address.rpartition(":")
    if separator != ":" or host != "127.0.0.1":
        raise ScenarioFailure(f"seed bound outside loopback: {address}")
    return host, int(port)


def create_outbound_only_session(download_rate_limit: int = 0) -> lt.session:
    settings = {
        "listen_interfaces": "127.0.0.1:0",
        "enable_dht": False,
        "enable_lsd": False,
        "enable_upnp": False,
        "enable_natpmp": False,
        "enable_incoming_utp": False,
        "enable_outgoing_utp": False,
        "enable_incoming_tcp": False,
        "enable_outgoing_tcp": True,
        "alert_queue_size": 1000,
    }
    if download_rate_limit > 0:
        settings["download_rate_limit"] = download_rate_limit
    return lt.session(settings)


def await_barrier(barrier: threading.Barrier, timeout_seconds: float) -> None:
    try:
        barrier.wait(timeout=timeout_seconds)
    except threading.BrokenBarrierError as error:
        raise ScenarioFailure("concurrent leecher start barrier broke") from error


def leech_with_libtorrent(
    fixture: Fixture,
    ready: dict[str, object],
    output_root: Path,
    start: threading.Barrier | None = None,
    finish: threading.Barrier | None = None,
    connected: threading.Event | None = None,
    release_download: threading.Event | None = None,
) -> None:
    session = create_outbound_only_session()
    handle: lt.torrent_handle | None = None
    diagnostics: list[str] = []
    try:
        parameters = lt.add_torrent_params()
        parameters.ti = fixture.torrent_info
        parameters.save_path = str(output_root)
        parameters.flags &= ~lt.torrent_flags.paused
        parameters.flags &= ~lt.torrent_flags.auto_managed
        if connected is not None:
            session.apply_settings({"download_rate_limit": 1})
        handle = session.add_torrent(parameters)
        if start is not None:
            await_barrier(start, 5)
        handle.connect_peer(parse_address(ready))
        if connected is not None:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                diagnostics.extend(alert.message() for alert in session.pop_alerts())
                if handle.status().num_peers >= 1:
                    connected.set()
                    break
                time.sleep(0.01)
            else:
                raise ScenarioFailure(
                    "libtorrent upload-only peer did not connect\n"
                    + "\n".join(diagnostics[-30:])
                )
            if release_download is None or not release_download.wait(timeout=30):
                raise ScenarioFailure("libtorrent download release was not published")
            session.apply_settings({"download_rate_limit": 0})
        deadline = time.monotonic() + TRANSFER_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            diagnostics.extend(alert.message() for alert in session.pop_alerts())
            status = handle.status()
            if status.errc.value() != 0:
                raise ScenarioFailure(
                    f"libtorrent leech failed: {status.errc.message()}"
                )
            if status.is_seeding:
                break
            time.sleep(0.02)
        else:
            raise ScenarioFailure(
                "libtorrent did not complete from the incoming seed\n"
                + "\n".join(diagnostics[-30:])
            )
        compare_fixture_files(fixture, output_root, include_torrent_root=True)
        if finish is not None:
            await_barrier(finish, PROCESS_TIMEOUT_SECONDS)
    finally:
        if handle is not None and handle.is_valid():
            session.remove_torrent(handle)
        session.pause()
        handle = None
        session = None
        gc.collect()


def leech_with_rstorrent(
    binary: Path,
    fixture: Fixture,
    ready: dict[str, object],
    output_root: Path,
    start: threading.Barrier | None = None,
    finish: threading.Barrier | None = None,
) -> str:
    host, port = parse_address(ready)
    magnet = f"magnet:?xt=urn:btih:{fixture.info_hash}&x.pe={host}:{port}"
    if start is not None:
        await_barrier(start, 5)
    completed = subprocess.run(
        [
            str(binary),
            "--magnet",
            magnet,
            "--output",
            str(output_root),
            "--timeout-seconds",
            str(TRANSFER_TIMEOUT_SECONDS),
            "--max-buffered-payload-bytes",
            str(DEFAULT_PAYLOAD_ALLOWANCE),
        ],
        capture_output=True,
        text=True,
        timeout=PROCESS_TIMEOUT_SECONDS,
        check=False,
    )
    if completed.returncode != 0:
        raise ScenarioFailure(
            f"RSTorrent leech exited with status {completed.returncode}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    fields = {
        key: value
        for token in completed.stdout.split()
        if "=" in token
        for key, value in [token.split("=", 1)]
    }
    if fields.get("info_hash") != fixture.info_hash:
        raise ScenarioFailure("RSTorrent leech reported the wrong info hash")
    expected_piece_field = (
        f"{fixture.torrent_info.num_pieces()}/{fixture.torrent_info.num_pieces()}"
    )
    if fields.get("pieces") != expected_piece_field:
        raise ScenarioFailure(
            f"RSTorrent reported pieces={fields.get('pieces')}, "
            f"expected {expected_piece_field}"
        )
    compare_fixture_files(fixture, output_root, include_torrent_root=False)
    if finish is not None:
        await_barrier(finish, PROCESS_TIMEOUT_SECONDS)
    return completed.stdout.strip()


def compare_fixture_files(
    fixture: Fixture,
    output_root: Path,
    *,
    include_torrent_root: bool,
) -> None:
    for relative, expected_hash in fixture.files:
        if fixture.output_is_file:
            actual_path = (
                output_root / relative if include_torrent_root else output_root
            )
        else:
            prefix = Path("incoming-multi") if include_torrent_root else Path()
            actual_path = output_root / prefix / relative
        if not actual_path.is_file():
            raise ScenarioFailure(f"downloaded payload is missing: {actual_path}")
        actual_hash = hashlib.sha1(actual_path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise ScenarioFailure(f"downloaded payload differs: {actual_path}")


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def run_fixture(
    seed_binary: Path,
    leech_binary: Path,
    fixture: Fixture,
    concurrent_clients: bool,
) -> tuple[SeedRun, SeedRun, tuple[str, ...], str]:
    first_process, first_ready = start_seed(seed_binary, fixture)
    first_stopped: dict[str, object]
    try:
        diagnostics: dict[str, str] = {}
        if concurrent_clients:
            start = threading.Barrier(3)
            finish = threading.Barrier(4)
            release_download = threading.Event()
            libtorrent_connected = (threading.Event(), threading.Event())
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = {}
                for ordinal in range(2):
                    libtorrent_output = fixture.torrent_path.parent / (
                        f"libtorrent-output-{ordinal}"
                    )
                    libtorrent_output.mkdir()
                    future = executor.submit(
                        leech_with_libtorrent,
                        fixture,
                        first_ready,
                        libtorrent_output,
                        None,
                        finish,
                        libtorrent_connected[ordinal],
                        release_download,
                    )
                    futures[future] = f"libtorrent-{ordinal}"
                for ordinal in range(2):
                    rstorrent_output = fixture.torrent_path.parent / (
                        f"rstorrent-single-{ordinal}.out"
                        if fixture.output_is_file
                        else f"rstorrent-output-{ordinal}"
                    )
                    future = executor.submit(
                        leech_with_rstorrent,
                        leech_binary,
                        fixture,
                        first_ready,
                        rstorrent_output,
                        start,
                        finish,
                    )
                    futures[future] = f"rstorrent-{ordinal}"
                for connected in libtorrent_connected:
                    if not connected.wait(timeout=5):
                        raise ScenarioFailure(
                            "libtorrent peers did not establish before Rust release"
                        )
                await_barrier(start, 5)
                deadline = time.monotonic() + 15
                snapshot: dict[str, object] = {}
                while time.monotonic() < deadline:
                    snapshot = seed_snapshot(first_process)
                    if integer_field(snapshot, "established_high_water") >= 4:
                        break
                    time.sleep(0.01)
                else:
                    raise ScenarioFailure(
                        "four leecher connections did not overlap before release: "
                        f"{snapshot}"
                    )
                release_download.set()
                for future in as_completed(futures):
                    label = futures[future]
                    result = future.result()
                    if isinstance(result, str):
                        diagnostics[label] = result
            first_stopped = stop_seed(
                first_process,
                fixture.total_size * 4,
                minimum_established=4,
            )
        else:
            libtorrent_output = fixture.torrent_path.parent / "libtorrent-output"
            libtorrent_output.mkdir()
            leech_with_libtorrent(fixture, first_ready, libtorrent_output)
            first_stopped = stop_seed(
                first_process,
                fixture.total_size,
                minimum_established=1,
            )
    except BaseException:
        terminate_process(first_process)
        raise

    second_process, second_ready = start_seed(seed_binary, fixture)
    second_stopped: dict[str, object]
    try:
        rstorrent_output = fixture.torrent_path.parent / (
            "rstorrent-single.out" if fixture.output_is_file else "rstorrent-output"
        )
        rstorrent_diagnostic = leech_with_rstorrent(
            leech_binary,
            fixture,
            second_ready,
            rstorrent_output,
        )
        second_stopped = stop_seed(
            second_process,
            fixture.total_size,
            minimum_established=1,
        )
    except BaseException:
        terminate_process(second_process)
        raise
    return (
        SeedRun(first_ready, first_stopped),
        SeedRun(second_ready, second_stopped),
        tuple(diagnostics[key] for key in sorted(diagnostics)),
        rstorrent_diagnostic,
    )


def peer_client(row: dict[str, object]) -> str | None:
    client = row.get("client_name")
    if not isinstance(client, str):
        return None
    folded = client.casefold()
    if "libtorrent" in folded:
        return "libtorrent"
    if "rstorrent" in folded:
        return "rstorrent"
    return None


def assert_incoming_peer_row(row: dict[str, object], listener: str) -> None:
    expected = {
        "direction": "incoming",
        "transport": "tcp",
        "lifecycle": "connected",
        "role": "content",
        "supports_extensions": True,
        "supports_ut_metadata": True,
        "remote_interested": True,
        "local_choking": False,
        "local_endpoint": listener,
    }
    for field, value in expected.items():
        if row.get(field) != value:
            raise ScenarioFailure(
                f"incoming peer field {field}={row.get(field)!r}, expected {value!r}"
            )
    remote = string_field(row, "remote_endpoint")
    if not remote.startswith("127.0.0.1:"):
        raise ScenarioFailure(f"incoming peer endpoint escaped loopback: {remote}")
    sources = string_list(row, "sources")
    if "incoming" not in sources:
        raise ScenarioFailure("incoming peer row lacks its incoming source")
    flags = string_list(row, "peer_flags")
    for flag in (
        "incoming",
        "upload_allowed",
        "extension_protocol",
        "metadata_extension",
    ):
        if flag not in flags:
            raise ScenarioFailure(f"incoming peer row lacks {flag}: {flags}")
    if row.get("peer_record_id") is None or row.get("peer_id") is None:
        raise ScenarioFailure("incoming peer row lacks stable record or handshake identity")
    if peer_client(row) is None:
        raise ScenarioFailure(f"incoming peer client was not identified: {row}")
    if not isinstance(row.get("pending_requests"), int):
        raise ScenarioFailure("incoming peer row lacks its upload request count")
    for field in (
        "queued_payload_bytes",
        "payload_upload_rate_bytes",
        "payload_uploaded_bytes",
        "connected_age_millis",
    ):
        value = row.get(field)
        if not isinstance(value, str) or not value.isdecimal():
            raise ScenarioFailure(f"incoming peer row lacks numeric {field}")
    capabilities = object_field(row, "capabilities")
    for field in (
        "local_endpoint",
        "client_name",
        "ut_metadata",
        "interest_directions",
        "local_choke",
        "upload",
    ):
        if capabilities.get(field) != "available":
            raise ScenarioFailure(
                f"incoming peer capability {field}={capabilities.get(field)!r}"
            )


def dispatch_pause(address: str, torrent_id: str) -> None:
    response = gateway_json(
        address,
        "POST",
        "/api/v1/commands",
        {
            "version": 1,
            "request_id": "pause-controlled-incoming-seed",
            "command": {"type": "pause", "torrent_id": torrent_id},
        },
    )
    if response.get("status") != "success":
        raise ScenarioFailure(f"gateway pause was rejected: {response}")


def assert_gateway_terminal_metrics(
    gateway: dict[str, object],
    application: dict[str, object],
    expected_payload: int,
) -> dict[str, object]:
    if gateway.get("active_connections") != 0:
        raise ScenarioFailure("gateway retained a connection after joined shutdown")
    incoming = object_field(application, "incoming")
    terminal_zero = (
        "registrations_before_shutdown",
        "pending_before_shutdown",
        "established_before_shutdown",
        "reads_before_shutdown",
        "read_bytes_before_shutdown",
        "peer_budget_total_before_shutdown",
        "outgoing_connecting_before_shutdown",
        "outgoing_established_before_shutdown",
        "incoming_connecting_before_shutdown",
        "incoming_established_before_shutdown",
        "upload_peers_before_shutdown",
        "upload_interested_before_shutdown",
        "upload_regular_before_shutdown",
        "upload_optimistic_before_shutdown",
        "torrent_upload_records_before_shutdown",
        "peer_upload_records_before_shutdown",
    )
    for field in terminal_zero:
        if integer_field(incoming, field) != 0:
            raise ScenarioFailure(f"gateway seed retained {field}={incoming.get(field)}")
    if integer_field(incoming, "payload_bytes_sent") != expected_payload:
        raise ScenarioFailure(
            f"gateway seed sent {incoming.get('payload_bytes_sent')} bytes, "
            f"expected exactly {expected_payload}"
        )
    assert_resource_bounds(incoming, minimum_established=2)
    for field in (
        "storage_owned_after_shutdown",
        "storage_cached_after_shutdown",
        "platform_pending_after_shutdown",
    ):
        if integer_field(application, field) != 0:
            raise ScenarioFailure(f"application shutdown retained {field}")
    if application.get("incoming_owner_after_shutdown") is not False:
        raise ScenarioFailure("application shutdown retained the incoming owner")
    return incoming


def run_gateway_view_evidence(
    gateway_binary: Path,
    leech_binary: Path,
    fixture: Fixture,
    torrent_id: str,
) -> dict[str, object]:
    gateway: subprocess.Popen[str] | None = None
    views: GatewayViews | None = None
    failure: BaseException | None = None
    try:
        gateway, gateway_address = start_gateway(
            gateway_binary,
            fixture.profile_root,
            fixture.storage_root,
        )
        views = GatewayViews.open(gateway_address, torrent_id)
        ready = {"listen": views.listener}
        libtorrent_output = fixture.torrent_path.parent / "gateway-libtorrent-output"
        libtorrent_output.mkdir()
        rstorrent_output = fixture.torrent_path.parent / "gateway-rstorrent-single.out"
        connected = threading.Event()
        release_download = threading.Event()
        observed_clients: dict[str, dict[str, object]] = {}
        with ThreadPoolExecutor(max_workers=2) as executor:
            libtorrent_future = executor.submit(
                leech_with_libtorrent,
                fixture,
                ready,
                libtorrent_output,
                None,
                None,
                connected,
                release_download,
            )
            if not connected.wait(timeout=5):
                raise ScenarioFailure("gateway libtorrent peer did not connect")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                views.poll(50)
                for row in views.peers.values():
                    client = peer_client(row)
                    if (
                        client == "libtorrent"
                        and row.get("lifecycle") == "connected"
                        and row.get("supports_ut_metadata") is True
                        and row.get("remote_interested") is True
                        and row.get("local_choking") is False
                        and isinstance(row.get("payload_uploaded_bytes"), str)
                        and int(row["payload_uploaded_bytes"]) > 0
                    ):
                        observed_clients[client] = row.copy()
                if "libtorrent" in observed_clients:
                    break
            else:
                raise ScenarioFailure("gateway views did not observe libtorrent")

            rstorrent_future = executor.submit(
                leech_with_rstorrent,
                leech_binary,
                fixture,
                ready,
                rstorrent_output,
            )
            deadline = time.monotonic() + TRANSFER_TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                views.poll(20)
                for row in views.peers.values():
                    client = peer_client(row)
                    if (
                        client is not None
                        and row.get("lifecycle") == "connected"
                        and row.get("supports_ut_metadata") is True
                        and row.get("remote_interested") is True
                        and row.get("local_choking") is False
                        and isinstance(row.get("payload_uploaded_bytes"), str)
                        and int(row["payload_uploaded_bytes"]) > 0
                    ):
                        observed_clients[client] = row.copy()
                if set(observed_clients) == {"libtorrent", "rstorrent"}:
                    break
                if rstorrent_future.done():
                    rstorrent_future.result()
                    break
            if set(observed_clients) != {"libtorrent", "rstorrent"}:
                raise ScenarioFailure(
                    f"gateway views did not observe both peer clients: {observed_clients}"
                )
            release_download.set()
            rstorrent_diagnostic = rstorrent_future.result()
            libtorrent_future.result()

        for row in observed_clients.values():
            assert_incoming_peer_row(row, views.listener)

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            views.poll(50)
            retained = [
                row
                for row in views.swarm.values()
                if "incoming" in string_list(row, "sources")
            ]
            if not views.peers and len(retained) == 2 and all(
                row.get("state") == "not_connectable"
                and row.get("connectable") is False
                for row in retained
            ):
                break
        else:
            raise ScenarioFailure(
                "gateway views did not reach empty Peers and retained Swarm state"
            )

        dispatch_pause(gateway_address, torrent_id)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            views.poll(50)
            if not views.peers and not views.swarm and views.swarm_state == "inactive":
                break
        else:
            raise ScenarioFailure("pause did not publish terminal empty peer views")
        views.close()
        views = None

        stderr = stop_gateway(gateway)
        gateway = None
        gateway_observation = connection_metrics(stderr)
        application_observation = application_metrics(stderr)
        incoming = assert_gateway_terminal_metrics(
            gateway_observation,
            application_observation,
            fixture.total_size * 2,
        )
        return {
            "listen": ready["listen"],
            "clients": {
                client: {
                    "connection_id": string_field(row, "connection_id"),
                    "client_name": string_field(row, "client_name"),
                    "flags": string_list(row, "peer_flags"),
                    "payload_uploaded_bytes": string_field(
                        row, "payload_uploaded_bytes"
                    ),
                }
                for client, row in sorted(observed_clients.items())
            },
            "payload_bytes_sent": integer_field(incoming, "payload_bytes_sent"),
            "pending_high_water": integer_field(incoming, "pending_high_water"),
            "established_high_water": integer_field(
                incoming, "established_high_water"
            ),
            "connection_high_water": integer_field(
                incoming, "connection_high_water"
            ),
            "upload_slots_high_water": integer_field(
                incoming, "upload_slots_high_water"
            ),
            "queued_requests_high_water": integer_field(
                incoming, "queued_requests_high_water"
            ),
            "queued_bytes_high_water": integer_field(
                incoming, "queued_bytes_high_water"
            ),
            "read_high_water": integer_field(incoming, "read_high_water"),
            "read_bytes_high_water": integer_field(
                incoming, "read_bytes_high_water"
            ),
            "writer_send_buffer_high_water": integer_field(
                incoming, "writer_send_buffer_high_water"
            ),
            "rstorrent_diagnostic": rstorrent_diagnostic,
            "peers_terminal": 0,
            "swarm_after_pause": "inactive_empty",
            "shutdown": "joined_zero",
        }
    except BaseException as error:
        failure = error
        raise
    finally:
        if views is not None:
            try:
                views.close()
            except BaseException as cleanup_error:
                if failure is None:
                    raise
                print(f"view cleanup failed: {cleanup_error}", file=sys.stderr)
        if gateway is not None:
            try:
                stop_gateway(gateway)
            except BaseException as cleanup_error:
                if failure is None:
                    raise
                print(f"gateway cleanup failed: {cleanup_error}", file=sys.stderr)


def run(repository: Path) -> None:
    run_root = Path(tempfile.mkdtemp(prefix="rstorrent-incoming-seeding-"))
    failure: BaseException | None = None
    try:
        seed_binary, leech_binary, gateway_binary = build_binaries(repository)
        fixtures = (create_single_fixture(run_root), create_multi_fixture(run_root))
        for fixture in fixtures:
            concurrent = fixture.name == "single"
            first, restarted, diagnostics, restart_diagnostic = run_fixture(
                seed_binary,
                leech_binary,
                fixture,
                concurrent,
            )
            gateway_evidence = (
                run_gateway_view_evidence(
                    gateway_binary,
                    leech_binary,
                    fixture,
                    string_field(restarted.ready, "torrent_id"),
                )
                if fixture.name == "single"
                else None
            )
            print(
                json.dumps(
                    {
                        "fixture": fixture.name,
                        "info_hash": fixture.info_hash,
                        "bytes": fixture.total_size,
                        "pieces": fixture.torrent_info.num_pieces(),
                        "concurrent_four_peer_evidence": concurrent,
                        "libtorrent_seed": first.stopped,
                        "restarted_rstorrent_seed": restarted.stopped,
                        "rstorrent_diagnostics": diagnostics,
                        "restart_diagnostic": restart_diagnostic,
                        "gateway_view_evidence": gateway_evidence,
                    },
                    sort_keys=True,
                )
            )
    except BaseException as error:
        failure = error
        raise
    finally:
        try:
            shutil.rmtree(run_root)
        except OSError as cleanup_error:
            if failure is None:
                raise
            print(f"cleanup failed: {cleanup_error}", file=sys.stderr)


if __name__ == "__main__":
    try:
        run(Path(__file__).resolve().parents[2])
    except ScenarioFailure as error:
        print(f"incoming seeding failed: {error}", file=sys.stderr)
        raise SystemExit(1)

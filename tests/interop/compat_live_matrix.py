#!/usr/bin/env python3
"""Live old/new host x old/new client happy path for the compatibility matrix.

For each pair, a real host (rstorrent-gateway built from the host's commit)
serves a temporary profile while a pinned libtorrent seed on loopback offers a
fixture. The client side runs clients/web/src/compat-live-driver.test.ts inside
the client commit's checkout, so that version's own LiveApplication and
WebSocket client connect, set the download folder, add the torrent, download
and verify it, and remove it with its data.

Pairs come from compat/deliveries.json: every captured host with the current
client, and the current host with every captured client, plus current with
current. compat/known-breaks.json entries with "check": "live" name the step
a pair is expected to fail at; any other failure, or an expected failure that
now passes, fails the run.

    uv run --project tests/interop --locked \\
      python tests/interop/compat_live_matrix.py [--host current|<sha>] [--client current|<sha>]

Old commits are built once into target/compat-live/ and reused. See
docs/tactical/359-mixed-version-compatibility-matrix.md (Slice 6).
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import libtorrent as lt

from application_surface_harness import ORIGIN, TOKEN, start_gateway, stop_gateway
from first_verified_piece import ScenarioFailure, add_seed, create_session, wait_for_listener
from magnet_metadata import ROOT_NAME, create_fixture, magnet_uri

REPOSITORY = Path(__file__).resolve().parents[2]
CACHE = REPOSITORY / "target" / "compat-live"
DRIVER = "src/compat-live-driver.test.ts"
STORAGE_ROOT = "downloads"
CURRENT = "current"


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None, timeout: int = 1800) -> None:
    completed = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout, check=False)
    if completed.returncode != 0:
        raise ScenarioFailure(
            f"{' '.join(command)} failed in {cwd}\nstdout:\n{completed.stdout[-4000:]}\nstderr:\n{completed.stderr[-4000:]}"
        )


class Worktree:
    """A temporary checkout of one commit, removed on exit."""

    def __init__(self, commit: str):
        self.commit = commit
        self.path = Path(tempfile.mkdtemp(prefix=f"compat-live-{commit[:12]}-"))
        self.path.rmdir()

    def __enter__(self) -> Path:
        run(["git", "worktree", "add", "--detach", str(self.path), self.commit], REPOSITORY)
        return self.path

    def __exit__(self, *_: object) -> None:
        run(["git", "worktree", "remove", "--force", str(self.path)], REPOSITORY)


def host_binary(host: str) -> Path:
    """The gateway binary for a host version, built once per commit."""
    if host == CURRENT:
        run(["cargo", "build", "--locked", "-p", "rstorrent-gateway"], REPOSITORY)
        return REPOSITORY / "target" / "debug" / "rstorrent-gateway"
    cached = CACHE / "hosts" / host / "rstorrent-gateway"
    if cached.is_file():
        return cached
    shared_target = REPOSITORY / "target" / "compat-capture"
    with Worktree(host) as checkout:
        env = {**os.environ, "CARGO_TARGET_DIR": str(shared_target)}
        run(["cargo", "build", "--locked", "-p", "rstorrent-gateway"], checkout, env)
    cached.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(shared_target / "debug" / "rstorrent-gateway", cached)
    return cached


def run_client(client: str, environment: dict[str, str]) -> None:
    """Runs the driver with the client version's own sources."""
    command = ["npx", "vitest", "run", DRIVER, "--disableConsoleIntercept"]
    if client == CURRENT:
        run(command, REPOSITORY / "clients" / "web", environment, timeout=600)
        return
    with Worktree(client) as checkout:
        web = checkout / "clients" / "web"
        # The client's sources are its own; dependencies come from the current
        # install, which only supplies the test runner and the WebSocket.
        (web / "node_modules").symlink_to(REPOSITORY / "clients" / "web" / "node_modules")
        shutil.copy2(REPOSITORY / "clients" / "web" / DRIVER, web / DRIVER)
        run(command, web, environment, timeout=600)


def happy_path(host: str, client: str) -> dict:
    run_path = Path(tempfile.mkdtemp(prefix="compat-live-"))
    session = None
    handle = None
    gateway = None
    diagnostics: list[str] = []
    try:
        fixture = create_fixture(run_path)
        session = create_session()
        port = wait_for_listener(session, diagnostics)
        handle = add_seed(session, fixture.torrent_info, fixture.seed_directory, diagnostics)
        binary = host_binary(host)
        storage = run_path / STORAGE_ROOT
        gateway, address = start_gateway(binary, run_path / "profile", storage)
        result_path = run_path / "result.json"
        environment = {
            **os.environ,
            "RSTORRENT_COMPAT_GATEWAY_URL": f"http://{address}",
            "RSTORRENT_COMPAT_GATEWAY_ORIGIN": ORIGIN,
            "RSTORRENT_COMPAT_GATEWAY_TOKEN": TOKEN,
            "RSTORRENT_COMPAT_STORAGE_ROOT": STORAGE_ROOT,
            "RSTORRENT_COMPAT_MAGNET": magnet_uri(fixture.info_hash, f"127.0.0.1:{port}"),
            "RSTORRENT_COMPAT_PAYLOAD": str(storage / ROOT_NAME / "payload.bin"),
            "RSTORRENT_COMPAT_PAYLOAD_SHA1": fixture.payload_hash,
            "RSTORRENT_COMPAT_RESULT": str(result_path),
        }
        run_client(client, environment)
        if not result_path.is_file():
            raise ScenarioFailure("the client driver did not record a result")
        return json.loads(result_path.read_text())
    finally:
        if gateway is not None:
            try:
                stop_gateway(gateway)
            except BaseException as error:  # noqa: BLE001 - cleanup must continue
                print(f"gateway cleanup failed: {error}", file=sys.stderr)
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


def default_pairs() -> list[tuple[str, str]]:
    ledger = json.loads((REPOSITORY / "compat" / "deliveries.json").read_text())
    hosts, clients = [], []
    for delivery in ledger["deliveries"]:
        if delivery["status"] == "withdrawn":
            continue
        if "host" in delivery["roles"] and delivery["commit"] not in hosts:
            hosts.append(delivery["commit"])
        if "client" in delivery["roles"] and delivery["commit"] not in clients:
            clients.append(delivery["commit"])
    return [(CURRENT, CURRENT)] + [(host, CURRENT) for host in hosts] + [(CURRENT, client) for client in clients]


def expected_failure(host: str, client: str) -> str | None:
    breaks = json.loads((REPOSITORY / "compat" / "known-breaks.json").read_text())["breaks"]
    for entry in breaks:
        if entry["check"] == "live" and entry["host"] == host and entry["client"] == client:
            return entry["failsAt"]
    return None


def summary(error: str | None) -> str:
    """The informative part of a long validation error."""
    if error is None:
        return ""
    parts = [part.strip() for part in error.split(";")]
    specific = [part for part in parts if "additional properties" in part or "must be equal to one of" in part]
    chosen = specific or parts[:1]
    text = "; ".join(dict.fromkeys(chosen))
    return text if len(text) <= 300 else text[:297] + "..."


def resolve(revision: str) -> str:
    if revision == CURRENT:
        return CURRENT
    return subprocess.run(
        ["git", "rev-parse", f"{revision}^{{commit}}"], cwd=REPOSITORY, capture_output=True, text=True, check=True
    ).stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", help="host version: current or a commit (default: every pair)")
    parser.add_argument("--client", help="client version: current or a commit (default: every pair)")
    arguments = parser.parse_args()
    if (arguments.host is None) != (arguments.client is None):
        parser.error("give both --host and --client, or neither")
    pairs = (
        [(resolve(arguments.host), resolve(arguments.client))]
        if arguments.host is not None
        else default_pairs()
    )
    problems = []
    for host, client in pairs:
        started = time.monotonic()
        outcome = happy_path(host, client)
        expected = expected_failure(host, client)
        label = f"host {host[:12]} x client {client[:12]}"
        verdict = "ok"
        if outcome["failedAt"] != expected:
            verdict = "UNEXPECTED"
            problems.append(
                f"{label}: expected failure at {expected}, got {outcome['failedAt']} ({summary(outcome['error'])})"
            )
        print(
            f"{verdict:10} {label}: completed {','.join(outcome['completed']) or '-'}"
            + (f"; failed at {outcome['failedAt']}: {summary(outcome['error'])}" if outcome["failedAt"] else "")
            + f" [{time.monotonic() - started:.0f}s]",
            flush=True,
        )
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

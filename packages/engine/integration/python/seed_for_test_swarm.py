#!/usr/bin/env python3
"""
Swarm seeder for testing multi-peer downloads.

Starts N seeders all seeding the same torrent on consecutive ports.
Uses the same deterministic data as seed_for_test.py.

Usage:
    uv run python seed_for_test_swarm.py                  # 10 seeders on 6881-6890
    uv run python seed_for_test_swarm.py --count 5        # 5 seeders on 6881-6885
    uv run python seed_for_test_swarm.py --size 1gb       # Seed 1GB file
    uv run python seed_for_test_swarm.py --port 7000      # Start at port 7000
    uv run python seed_for_test_swarm.py --kill           # Kill existing processes on ports first
"""
import argparse
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import quote

import libtorrent as lt

from seed_for_test import (
    SEED,
    DEFAULT_DATA_DIR,
    ANDROID_EMU_HOST,
    CROSTINI_HOST,
    SIZE_CONFIGS,
    ensure_data_exists,
    get_lan_ip,
)

DEFAULT_PORT = 6881
DEFAULT_COUNT = 10

# =============================================================================
# Signal Handling
# =============================================================================
shutdown_requested = False


def handle_signal(signum, frame):
    global shutdown_requested
    shutdown_requested = True


# =============================================================================
# Port Management
# =============================================================================
def check_port_available(port: int) -> Optional[int]:
    """Check if port is in use. Returns PID if in use, None if available."""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            pids = result.stdout.strip().split("\n")
            return int(pids[0]) if pids[0] else None
    except (FileNotFoundError, ValueError):
        pass
    return None


def kill_process_on_port(port: int, quiet: bool = False) -> bool:
    """Kill process on port. Returns True if something was killed."""
    pid = check_port_available(port)
    if pid:
        try:
            subprocess.run(["kill", str(pid)], check=True)
            if not quiet:
                print(f"Killed existing process on port {port} (PID {pid})")
            time.sleep(0.3)
            return True
        except subprocess.CalledProcessError:
            pass
    return False


def check_all_ports(start_port: int, count: int, kill: bool, quiet: bool) -> bool:
    """
    Check all ports are available.
    If kill=True, kill existing processes first.
    Returns True if all ports are available.
    """
    ports = list(range(start_port, start_port + count))

    if kill:
        for port in ports:
            kill_process_on_port(port, quiet)

    # Check all ports
    blocked = []
    for port in ports:
        pid = check_port_available(port)
        if pid:
            blocked.append((port, pid))

    if blocked:
        print("ERROR: The following ports are in use:", file=sys.stderr)
        for port, pid in blocked:
            print(f"  Port {port}: PID {pid}", file=sys.stderr)
        print("\nUse --kill to terminate existing processes first.", file=sys.stderr)
        return False

    return True


# =============================================================================
# Seeding
# =============================================================================
def create_seeding_session(port: int, bind_addr: str = "0.0.0.0") -> lt.session:
    """Create libtorrent session configured for seeding."""
    settings = {
        "listen_interfaces": f"{bind_addr}:{port}",
        "enable_dht": False,
        "enable_lsd": False,
        "enable_upnp": False,
        "enable_natpmp": False,
        "in_enc_policy": 1,
        "out_enc_policy": 1,
        "allowed_enc_level": 3,
        "prefer_rc4": False,
        "enable_incoming_utp": False,
        "enable_outgoing_utp": False,
        "user_agent": "jstorrent_test_swarm",
        "alert_mask": lt.alert.category_t.all_categories,
        "allow_multiple_connections_per_ip": True,
    }

    params = lt.session_params()
    params.settings = settings
    session = lt.session(params)
    session.apply_settings(settings)

    return session


def seed_torrent(
    session: lt.session, torrent_path: Path, data_dir: Path
) -> lt.torrent_handle:
    """Add torrent to session in seed mode."""
    params = lt.add_torrent_params()
    params.ti = lt.torrent_info(str(torrent_path))
    params.save_path = str(data_dir)
    params.flags = lt.torrent_flags.seed_mode
    params.flags &= ~lt.torrent_flags.auto_managed

    handle = session.add_torrent(params)
    handle.resume()
    handle.force_recheck()

    return handle


def build_swarm_magnet(info_hash: str, name: str, hosts_ports: List[Tuple[str, int]]) -> str:
    """Build magnet link with multiple peer hints."""
    encoded_name = quote(name)
    peer_hints = "&".join(f"x.pe={host}:{port}" for host, port in hosts_ports)
    return f"magnet:?xt=urn:btih:{info_hash}&dn={encoded_name}&{peer_hints}"


# =============================================================================
# Main
# =============================================================================
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Start multiple seeders for swarm testing."
    )
    parser.add_argument(
        "--count",
        "-n",
        type=int,
        default=DEFAULT_COUNT,
        help=f"Number of seeders to start (default: {DEFAULT_COUNT})",
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=DEFAULT_PORT,
        help=f"Starting port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--size",
        "-s",
        choices=["100mb", "1gb"],
        default="100mb",
        help="Data size to seed (default: 100mb)",
    )
    parser.add_argument(
        "--kill",
        "-k",
        action="store_true",
        help="Kill existing processes on ports before starting",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Machine-parseable output only",
    )
    parser.add_argument(
        "--bind",
        type=str,
        default="0.0.0.0",
        help="Interface to bind to (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help=f"Data directory (default: {DEFAULT_DATA_DIR})",
    )

    args = parser.parse_args()

    # Setup signal handlers
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Check all ports are available
    if not check_all_ports(args.port, args.count, args.kill, args.quiet):
        return 1

    # Ensure data exists (reuse from seed_for_test)
    data_path, torrent_path, info_hash = ensure_data_exists(
        args.data_dir, args.size, regenerate=False, quiet=args.quiet
    )

    config = SIZE_CONFIGS[args.size]

    # Start all seeders
    sessions: List[lt.session] = []
    handles: List[lt.torrent_handle] = []
    ports: List[int] = []

    if not args.quiet:
        print(f"\nStarting {args.count} seeders on ports {args.port}-{args.port + args.count - 1}...")

    for i in range(args.count):
        port = args.port + i
        session = create_seeding_session(port, args.bind)

        actual_port = session.listen_port()
        if actual_port != port:
            print(f"ERROR: Requested port {port} but got {actual_port}", file=sys.stderr)
            return 1

        handle = seed_torrent(session, torrent_path, args.data_dir)

        sessions.append(session)
        handles.append(handle)
        ports.append(actual_port)

        if not args.quiet:
            print(f"  Seeder {i+1}/{args.count} started on port {actual_port}")

    # Wait for all to reach seeding state
    if not args.quiet:
        print("\nWaiting for all seeders to be ready...")

    timeout = 30
    start = time.time()
    all_seeding = False
    while not all_seeding and time.time() - start < timeout:
        all_seeding = all(h.status().is_seeding for h in handles)
        if not all_seeding:
            time.sleep(0.1)

    if not all_seeding:
        print("ERROR: Timeout waiting for all seeders", file=sys.stderr)
        return 1

    # Build magnet links
    lan_ip = get_lan_ip()

    # All interfaces, all seeders
    all_peers_emu = [(ANDROID_EMU_HOST, p) for p in ports]
    all_peers_localhost = [("127.0.0.1", p) for p in ports]
    all_peers_crostini = [(CROSTINI_HOST, p) for p in ports]
    all_peers_lan = [(lan_ip, p) for p in ports] if lan_ip else []

    magnet_emu = build_swarm_magnet(info_hash, config["filename"], all_peers_emu)
    magnet_localhost = build_swarm_magnet(info_hash, config["filename"], all_peers_localhost)
    magnet_crostini = build_swarm_magnet(info_hash, config["filename"], all_peers_crostini)
    magnet_lan = build_swarm_magnet(info_hash, config["filename"], all_peers_lan) if lan_ip else None

    # Kitchen sink: all interfaces, all ports
    all_peers_kitchen = all_peers_emu + all_peers_localhost + all_peers_crostini
    if all_peers_lan:
        all_peers_kitchen.extend(all_peers_lan)
    magnet_kitchen_sink = build_swarm_magnet(info_hash, config["filename"], all_peers_kitchen)

    if args.quiet:
        print(f"INFOHASH={info_hash}")
        print(f"PORTS={','.join(map(str, ports))}")
        print(f"COUNT={args.count}")
        print(f"MAGNET_EMU={magnet_emu}")
        print(f"MAGNET_LOCALHOST={magnet_localhost}")
        print(f"MAGNET_CROSTINI={magnet_crostini}")
        if lan_ip:
            print(f"LAN_IP={lan_ip}")
            print(f"MAGNET_LAN={magnet_lan}")
        print(f"MAGNET_KITCHEN_SINK={magnet_kitchen_sink}")
    else:
        print()
        print("=" * 80)
        print(f"JSTorrent Swarm Test Seeder ({args.count} seeders)")
        print("=" * 80)
        print(f"Data: {data_path} ({config['size']} bytes)")
        print(f"Info hash: {info_hash}")
        print(f"Ports: {ports[0]}-{ports[-1]} ({args.count} seeders)")
        if lan_ip:
            print(f"LAN IP: {lan_ip}")
        print()
        print("=" * 80)
        print("KITCHEN SINK (all interfaces, all seeders):")
        print("=" * 80)
        print(magnet_kitchen_sink)
        print()
        print("=" * 80)
        print(f"MAGNET (Android emulator {ANDROID_EMU_HOST}):")
        print("=" * 80)
        print(magnet_emu)
        print()
        print("=" * 80)
        print("MAGNET (localhost):")
        print("=" * 80)
        print(magnet_localhost)
        print()
        print("=" * 80)
        print(f"MAGNET (Crostini {CROSTINI_HOST}):")
        print("=" * 80)
        print(magnet_crostini)
        if magnet_lan:
            print()
            print("=" * 80)
            print(f"MAGNET (LAN {lan_ip}):")
            print("=" * 80)
            print(magnet_lan)
        print()
        print("=" * 80)
        print("Press Ctrl+C to stop all seeders")
        print("=" * 80)

    # Main loop
    try:
        while not shutdown_requested:
            time.sleep(1)

            if not args.quiet:
                total_peers = sum(h.status().num_peers for h in handles)
                total_upload_rate = sum(h.status().upload_rate for h in handles) / 1024
                total_uploaded = sum(h.status().total_upload for h in handles) / (1024 * 1024)

                # Per-seeder stats
                peer_counts = [h.status().num_peers for h in handles]
                active_seeders = sum(1 for p in peer_counts if p > 0)

                print(
                    f"\rSeeding... ("
                    f"seeders: {active_seeders}/{args.count} active, "
                    f"total peers: {total_peers}, "
                    f"upload: {total_upload_rate:.1f} KB/s, "
                    f"uploaded: {total_uploaded:.1f} MB)",
                    end="",
                    flush=True,
                )

            # Pop alerts to prevent memory buildup
            for session in sessions:
                session.pop_alerts()

    except KeyboardInterrupt:
        pass

    if not args.quiet:
        print("\nShutting down all seeders...")

    return 0


if __name__ == "__main__":
    sys.exit(main())

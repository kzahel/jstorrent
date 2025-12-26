#!/usr/bin/env python3
"""
Seeder for Android emulator testing.

Generates deterministic test data and seeds it via libtorrent or JSTEngine.
Data is cached in ~/.jstorrent-test-seed/ for fast subsequent runs.

The same seed always produces the same data, which means the same infohash.
This allows using a predictable magnet link for testing.

Usage:
    uv run python seed_for_test.py                        # Seed 1GB file with libtorrent
    uv run python seed_for_test.py --engine jstengine     # Seed with JSTEngine
    uv run python seed_for_test.py --size 100mb           # Seed 100MB file
    uv run python seed_for_test.py --regenerate           # Force regenerate data
    uv run python seed_for_test.py --quiet                # Machine-parseable output
"""
import argparse
import signal
import socket
import sys
import time
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote

import libtorrent as lt
import numpy as np

from jst import JSTEngine

# =============================================================================
# Constants - DO NOT CHANGE SEED (it would change the infohash)
# =============================================================================
SEED = 0xDEADBEEF
DEFAULT_DATA_DIR = Path.home() / ".jstorrent-test-seed"
ANDROID_EMU_HOST = "10.0.2.2"
CROSTINI_HOST = "100.115.92.206"
DEFAULT_PORT = 6881


def get_lan_ip() -> Optional[str]:
    """Get the local LAN IP address."""
    try:
        # Connect to an external address to determine which interface would be used
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        # Doesn't actually send anything, just determines the route
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


SIZE_CONFIGS = {
    "100mb": {
        "size": 100 * 1024 * 1024,
        "piece_length": 256 * 1024,
        "filename": "testdata_100mb.bin",
    },
    "1gb": {
        "size": 1024 * 1024 * 1024,
        "piece_length": 1024 * 1024,
        "filename": "testdata_1gb.bin",
    },
}

# =============================================================================
# Signal Handling
# =============================================================================
shutdown_requested = False


def handle_signal(signum, frame):
    global shutdown_requested
    shutdown_requested = True


# =============================================================================
# Data Generation
# =============================================================================
def generate_deterministic_data(
    path: Path, size: int, seed: int = SEED, quiet: bool = False
) -> None:
    """Generate deterministic random data file using numpy."""
    rng = np.random.default_rng(seed)
    chunk_size = 16 * 1024 * 1024  # 16MB chunks
    remaining = size

    if not quiet:
        print(f"Generating {size / (1024*1024):.0f}MB deterministic data...")

    with open(path, "wb") as f:
        while remaining > 0:
            chunk_len = min(chunk_size, remaining)
            chunk = rng.integers(0, 256, size=chunk_len, dtype=np.uint8)
            f.write(chunk.tobytes())
            remaining -= chunk_len
            if not quiet:
                progress = (size - remaining) / size * 100
                print(f"\r  Progress: {progress:.1f}%", end="", flush=True)

    if not quiet:
        print()  # newline after progress


# =============================================================================
# Torrent Creation
# =============================================================================
def create_torrent_for_file(
    file_path: Path, piece_length: int, quiet: bool = False
) -> Tuple[Path, str]:
    """Create .torrent file for an existing file. Returns (torrent_path, info_hash)."""
    if not quiet:
        print(f"Creating torrent file (piece size: {piece_length // 1024}KB)...")

    base_dir = str(file_path.parent)
    filename = file_path.name

    fs = lt.file_storage()
    lt.add_files(fs, str(file_path))
    t = lt.create_torrent(fs, piece_size=piece_length)
    t.set_creator("jstorrent_test_seeder")
    lt.set_piece_hashes(t, base_dir)

    torrent_path = file_path.with_suffix(".bin.torrent")
    with open(torrent_path, "wb") as f:
        f.write(lt.bencode(t.generate()))

    info = lt.torrent_info(str(torrent_path))
    # For hybrid v1+v2 torrents, info_hash() returns the v2 hash (truncated).
    # We need the v1 hash (SHA1 of full info dict) for compatibility with JSTEngine.
    hashes = info.info_hashes()
    if hashes.has_v1():
        info_hash = str(hashes.v1)
    else:
        info_hash = str(info.info_hash())

    return torrent_path, info_hash


# =============================================================================
# Data Management
# =============================================================================
def ensure_data_exists(
    data_dir: Path, size_key: str, regenerate: bool = False, quiet: bool = False
) -> Tuple[Path, Path, str]:
    """
    Ensure data and torrent files exist.
    Returns (data_path, torrent_path, info_hash).
    """
    config = SIZE_CONFIGS[size_key]
    data_dir.mkdir(parents=True, exist_ok=True)

    data_path = data_dir / config["filename"]
    torrent_path = data_path.with_suffix(".bin.torrent")

    # Check if we need to regenerate
    needs_data = not data_path.exists() or regenerate
    needs_torrent = not torrent_path.exists() or regenerate

    if needs_data:
        generate_deterministic_data(
            data_path, config["size"], seed=SEED, quiet=quiet
        )
        needs_torrent = True  # Always regenerate torrent if data changed

    if needs_torrent:
        torrent_path, info_hash = create_torrent_for_file(
            data_path, config["piece_length"], quiet=quiet
        )
    else:
        # Load existing torrent to get info_hash
        # For hybrid v1+v2 torrents, info_hash() returns the v2 hash (truncated).
        # We need the v1 hash (SHA1 of full info dict) for compatibility with JSTEngine.
        info = lt.torrent_info(str(torrent_path))
        hashes = info.info_hashes()
        if hashes.has_v1():
            info_hash = str(hashes.v1)
        else:
            info_hash = str(info.info_hash())

    if not quiet and not needs_data:
        print(f"Using existing data at {data_path}")

    return data_path, torrent_path, info_hash


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
        # Encryption: pe_enabled (1) = accept both plaintext and encrypted
        # This provides maximum compatibility
        "in_enc_policy": 1,  # pe_enabled - accept both
        "out_enc_policy": 1,  # pe_enabled - accept both
        "allowed_enc_level": 3,  # both (1=plaintext, 2=rc4, 3=both)
        "prefer_rc4": False,
        "enable_incoming_utp": False,
        "enable_outgoing_utp": False,
        "user_agent": "jstorrent_test_seeder",
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
    # Force recheck to verify we have the data and transition to seeding state
    handle.force_recheck()

    return handle


def build_magnet_link(info_hash: str, name: str, host: str, port: int) -> str:
    """Build magnet link with peer hint (x.pe parameter)."""
    encoded_name = quote(name)
    return f"magnet:?xt=urn:btih:{info_hash}&dn={encoded_name}&x.pe={host}:{port}"


# =============================================================================
# Main
# =============================================================================
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed deterministic test data for Android emulator testing."
    )
    parser.add_argument(
        "--regenerate",
        "-r",
        action="store_true",
        help="Regenerate data even if it exists",
    )
    parser.add_argument(
        "--size",
        "-s",
        choices=["100mb", "1gb"],
        default="1gb",
        help="Data size to generate/seed (default: 1gb)",
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=DEFAULT_PORT,
        help=f"Listen port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=ANDROID_EMU_HOST,
        help=f"Host IP for magnet peer hint (default: {ANDROID_EMU_HOST} for Android emulator)",
    )
    parser.add_argument(
        "--bind",
        type=str,
        default="0.0.0.0",
        help="Interface to bind to (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Machine-parseable output only",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help=f"Data directory (default: {DEFAULT_DATA_DIR})",
    )
    parser.add_argument(
        "--engine",
        "-e",
        choices=["libtorrent", "jstengine"],
        default="libtorrent",
        help="Seeding engine to use (default: libtorrent)",
    )

    args = parser.parse_args()

    # Setup signal handlers
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Ensure data exists
    data_path, torrent_path, info_hash = ensure_data_exists(
        args.data_dir, args.size, args.regenerate, args.quiet
    )

    config = SIZE_CONFIGS[args.size]

    if args.engine == "libtorrent":
        return run_libtorrent_seeder(args, data_path, torrent_path, info_hash, config)
    else:
        return run_jstengine_seeder(args, data_path, torrent_path, info_hash, config)


def run_libtorrent_seeder(args, data_path, torrent_path, info_hash, config) -> int:
    """Run seeder using libtorrent."""
    # Create session and start seeding
    session = create_seeding_session(args.port, args.bind)

    # Verify we got the port we asked for
    actual_port = session.listen_port()
    if actual_port != args.port:
        print(
            f"ERROR: Requested port {args.port} but got {actual_port}. "
            f"Port {args.port} may be in use.",
            file=sys.stderr,
        )
        return 1

    handle = seed_torrent(session, torrent_path, args.data_dir)

    # Wait for seeding state
    timeout = 10
    start = time.time()
    while not handle.status().is_seeding:
        if time.time() - start > timeout:
            print("ERROR: Timeout waiting for seeding state", file=sys.stderr)
            return 1
        time.sleep(0.1)

    magnet = build_magnet_link(info_hash, config["filename"], args.host, actual_port)
    magnet_localhost = build_magnet_link(info_hash, config["filename"], "127.0.0.1", actual_port)
    magnet_crostini = build_magnet_link(info_hash, config["filename"], CROSTINI_HOST, actual_port)
    lan_ip = get_lan_ip()
    magnet_lan = build_magnet_link(info_hash, config["filename"], lan_ip, actual_port) if lan_ip else None

    if args.quiet:
        # Machine-parseable output
        print(f"INFOHASH={info_hash}")
        print(f"PORT={actual_port}")
        print(f"MAGNET={magnet}")
        print(f"MAGNET_LOCALHOST={magnet_localhost}")
        print(f"MAGNET_CROSTINI={magnet_crostini}")
        if lan_ip:
            print(f"LAN_IP={lan_ip}")
            print(f"MAGNET_LAN={magnet_lan}")
    else:
        print_banner(args, data_path, torrent_path, info_hash, config, actual_port, magnet, magnet_localhost, magnet_crostini, magnet_lan, lan_ip, "libtorrent")

    # Main loop - keep seeding until Ctrl+C
    try:
        while not shutdown_requested:
            time.sleep(1)
            status = handle.status()
            if not args.quiet:
                peers = status.num_peers
                upload_rate = status.upload_rate / 1024
                uploaded = status.total_upload / (1024 * 1024)
                print(
                    f"\rSeeding... (peers: {peers}, "
                    f"upload: {upload_rate:.1f} KB/s, "
                    f"uploaded: {uploaded:.1f} MB)",
                    end="",
                    flush=True,
                )

            # Pop alerts to prevent memory buildup
            session.pop_alerts()
    except KeyboardInterrupt:
        pass

    if not args.quiet:
        print("\nShutting down...")

    return 0


def run_jstengine_seeder(args, data_path, torrent_path, info_hash, config) -> int:
    """Run seeder using JSTEngine."""
    engine = None
    try:
        # Start JSTEngine
        engine = JSTEngine(
            port=0,  # RPC port (auto-assign)
            config={"port": args.port, "downloadPath": str(args.data_dir)},
            verbose=not args.quiet,
        )

        # Add torrent and recheck to discover existing pieces
        tid = engine.add_torrent_file(str(torrent_path))
        engine.recheck(tid)

        # Verify JSTEngine computed the same infohash as libtorrent (using v1 hash)
        if tid.lower() != info_hash.lower():
            print(f"ERROR: JSTEngine infohash ({tid}) differs from libtorrent v1 hash ({info_hash})", file=sys.stderr)
            return 1

        # Wait for seeding state (progress >= 1.0)
        timeout = 60
        start = time.time()
        while True:
            status = engine.get_torrent_status(tid)
            if status.get("progress", 0) >= 1.0:
                break
            if time.time() - start > timeout:
                print("ERROR: Timeout waiting for seeding state", file=sys.stderr)
                return 1
            time.sleep(0.5)

        actual_port = engine.bt_port
        magnet = build_magnet_link(info_hash, config["filename"], args.host, actual_port)
        magnet_localhost = build_magnet_link(info_hash, config["filename"], "127.0.0.1", actual_port)
        magnet_crostini = build_magnet_link(info_hash, config["filename"], CROSTINI_HOST, actual_port)
        lan_ip = get_lan_ip()
        magnet_lan = build_magnet_link(info_hash, config["filename"], lan_ip, actual_port) if lan_ip else None

        if args.quiet:
            # Machine-parseable output
            print(f"INFOHASH={info_hash}")
            print(f"PORT={actual_port}")
            print(f"MAGNET={magnet}")
            print(f"MAGNET_LOCALHOST={magnet_localhost}")
            print(f"MAGNET_CROSTINI={magnet_crostini}")
            if lan_ip:
                print(f"LAN_IP={lan_ip}")
                print(f"MAGNET_LAN={magnet_lan}")
        else:
            print_banner(args, data_path, torrent_path, info_hash, config, actual_port, magnet, magnet_localhost, magnet_crostini, magnet_lan, lan_ip, "JSTEngine")

        # Main loop - keep seeding until Ctrl+C
        try:
            while not shutdown_requested:
                time.sleep(1)
                if not args.quiet:
                    status = engine.get_torrent_status(tid)
                    peers = status.get("peers", 0)
                    upload_rate = status.get("uploadRate", 0) / 1024
                    uploaded = status.get("totalUploaded", 0) / (1024 * 1024)
                    print(
                        f"\rSeeding... (peers: {peers}, "
                        f"upload: {upload_rate:.1f} KB/s, "
                        f"uploaded: {uploaded:.1f} MB)",
                        end="",
                        flush=True,
                    )
        except KeyboardInterrupt:
            pass

        if not args.quiet:
            print("\nShutting down...")

        return 0

    finally:
        if engine:
            engine.close()


def print_banner(args, data_path, torrent_path, info_hash, config, actual_port, magnet, magnet_localhost, magnet_crostini, magnet_lan, lan_ip, engine_name):
    """Print human-readable banner."""
    print()
    print("=" * 80)
    print("JSTorrent Test Seeder")
    print("=" * 80)
    print(f"Engine: {engine_name}")
    print(f"Data directory: {args.data_dir}")
    print(f"Data file: {data_path} ({config['size']} bytes)")
    print(f"Torrent file: {torrent_path}")
    print(f"Info hash: {info_hash}")
    print()
    print(f"Seeder listening on port {actual_port}")
    print(f"Peer hint host: {args.host}")
    if lan_ip:
        print(f"LAN IP: {lan_ip}")
    print()
    print("=" * 80)
    print(f"MAGNET LINK ({args.host}):")
    print("=" * 80)
    print(magnet)
    print()
    print("=" * 80)
    print("MAGNET LINK (127.0.0.1):")
    print("=" * 80)
    print(magnet_localhost)
    print()
    print("=" * 80)
    print(f"MAGNET LINK (Crostini: {CROSTINI_HOST}):")
    print("=" * 80)
    print(magnet_crostini)
    if magnet_lan:
        print()
        print("=" * 80)
        print(f"MAGNET LINK (LAN: {lan_ip}):")
        print("=" * 80)
        print(magnet_lan)
    print()
    print("=" * 80)
    print("Press Ctrl+C to stop seeding")
    print("=" * 80)


if __name__ == "__main__":
    sys.exit(main())

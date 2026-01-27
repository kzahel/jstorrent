#!/usr/bin/env python3
"""
Benchmark tick performance during torrent download.

Measures the game tick (piece picker) performance which runs every 100ms.
This is the hot path that needs optimization for QuickJS.

Usage:
    # Run with JIT (default V8 mode)
    uv run python benchmark_tick.py

    # Run with --jitless (simulates QuickJS-like performance)
    uv run python benchmark_tick.py --jitless

    # Run with 1GB test file
    uv run python benchmark_tick.py --size 1gb

    # Multi-peer swarm test (starts its own seeders)
    uv run python benchmark_tick.py --peers 5
    uv run python benchmark_tick.py --peers 10 --size 1gb

    # Quiet mode (machine-parseable output)
    uv run python benchmark_tick.py --quiet

Prerequisites (single peer mode):
    Start the seeder first in another terminal:
    pnpm seed-for-test --size 1gb

For --peers mode, seeders are started automatically.
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple
from urllib.parse import quote

from jst import JSTEngine

# Test info hashes and filenames (must match seed_for_test.py)
INFOHASH_100MB = "67d01ece1b99c49c257baada0f760b770a7530b9"
INFOHASH_1GB = "18a7aacab6d2bc518e336921ccd4b6cc32a9624b"
FILENAME_100MB = "testdata_100mb.bin"
FILENAME_1GB = "testdata_1gb.bin"


def build_magnet(info_hash: str, name: str, peers: List[Tuple[str, int]]) -> str:
    """Build magnet link with peer hints."""
    encoded_name = quote(name)
    peer_hints = "&".join(f"x.pe={host}:{port}" for host, port in peers)
    return f"magnet:?xt=urn:btih:{info_hash}&dn={encoded_name}&{peer_hints}"


@dataclass
class TickSample:
    """A sample of tick statistics at a point in time."""
    timestamp: float
    tick_count: int
    tick_total_ms: float
    tick_max_ms: float
    tick_avg_ms: float
    active_pieces: int
    connected_peers: int
    progress: float
    download_rate: float


@dataclass
class BenchmarkResult:
    """Final benchmark results."""
    total_ticks: int
    total_time_sec: float
    avg_tick_ms: float
    max_tick_ms: float
    p95_tick_ms: float
    p99_tick_ms: float
    download_speed_mbps: float
    jitless: bool
    size_bytes: int
    num_peers: int = 1


def collect_tick_samples(
    engine: JSTEngine,
    tid: str,
    poll_interval: float = 1.0,
    timeout: float = 600.0,
    quiet: bool = False,
) -> List[TickSample]:
    """Collect tick samples until download completes or timeout."""
    samples: List[TickSample] = []
    start_time = time.time()
    last_tick_count = 0
    all_tick_times: List[float] = []

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            if not quiet:
                print(f"\nTimeout after {timeout}s")
            break

        try:
            status = engine.get_torrent_status(tid)
            tick_stats = engine.get_tick_stats()
        except Exception as e:
            if not quiet:
                print(f"\nError getting stats: {e}")
            break

        progress = status.get("progress", 0)
        download_rate = status.get("downloadRate", 0)

        # The tick stats reset every 5 seconds in the engine, so we capture windows
        tick_count = tick_stats.get("tickCount", 0)
        tick_total_ms = tick_stats.get("tickTotalMs", 0)
        tick_max_ms = tick_stats.get("tickMaxMs", 0)
        tick_avg_ms = tick_stats.get("tickAvgMs", 0)
        active_pieces = tick_stats.get("activePieces", 0)
        connected_peers = tick_stats.get("connectedPeers", 0)

        sample = TickSample(
            timestamp=elapsed,
            tick_count=tick_count,
            tick_total_ms=tick_total_ms,
            tick_max_ms=tick_max_ms,
            tick_avg_ms=tick_avg_ms,
            active_pieces=active_pieces,
            connected_peers=connected_peers,
            progress=progress,
            download_rate=download_rate,
        )
        samples.append(sample)

        # Track individual tick times for percentile calculation
        # Since we get aggregate stats, we approximate by using the avg
        if tick_count > 0:
            # Add the max as one data point (we know at least one tick took this long)
            all_tick_times.append(tick_max_ms)
            # Add avg for the rest (approximation)
            for _ in range(tick_count - 1):
                all_tick_times.append(tick_avg_ms)

        if not quiet:
            speed_mbps = download_rate / (1024 * 1024)
            print(
                f"\r[{elapsed:6.1f}s] Progress: {progress*100:5.1f}% | "
                f"Speed: {speed_mbps:6.1f} MB/s | "
                f"Ticks: {tick_count:3d} | "
                f"Avg: {tick_avg_ms:5.1f}ms | "
                f"Max: {tick_max_ms:5.1f}ms | "
                f"Peers: {connected_peers} | "
                f"Pieces: {active_pieces}",
                end="",
                flush=True,
            )

        if progress >= 1.0:
            if not quiet:
                print(f"\nDownload complete in {elapsed:.1f}s")
            break

        time.sleep(poll_interval)

    return samples, all_tick_times


def calculate_results(
    samples: List[TickSample],
    all_tick_times: List[float],
    jitless: bool,
    size_bytes: int,
    num_peers: int = 1,
) -> BenchmarkResult:
    """Calculate final benchmark statistics."""
    if not samples:
        return BenchmarkResult(
            total_ticks=0,
            total_time_sec=0,
            avg_tick_ms=0,
            max_tick_ms=0,
            p95_tick_ms=0,
            p99_tick_ms=0,
            download_speed_mbps=0,
            jitless=jitless,
            size_bytes=size_bytes,
        )

    total_time = samples[-1].timestamp
    total_ticks = sum(s.tick_count for s in samples)
    total_tick_ms = sum(s.tick_total_ms for s in samples)
    max_tick_ms = max(s.tick_max_ms for s in samples)

    avg_tick_ms = total_tick_ms / total_ticks if total_ticks > 0 else 0

    # Calculate percentiles from collected tick times
    if all_tick_times:
        sorted_times = sorted(all_tick_times)
        p95_idx = int(len(sorted_times) * 0.95)
        p99_idx = int(len(sorted_times) * 0.99)
        p95_tick_ms = sorted_times[min(p95_idx, len(sorted_times) - 1)]
        p99_tick_ms = sorted_times[min(p99_idx, len(sorted_times) - 1)]
    else:
        p95_tick_ms = 0
        p99_tick_ms = 0

    # Calculate average download speed
    download_speed_mbps = (size_bytes / (1024 * 1024)) / total_time if total_time > 0 else 0

    return BenchmarkResult(
        total_ticks=total_ticks,
        total_time_sec=total_time,
        avg_tick_ms=avg_tick_ms,
        max_tick_ms=max_tick_ms,
        p95_tick_ms=p95_tick_ms,
        p99_tick_ms=p99_tick_ms,
        download_speed_mbps=download_speed_mbps,
        jitless=jitless,
        size_bytes=size_bytes,
        num_peers=num_peers,
    )


def print_results(result: BenchmarkResult, quiet: bool = False):
    """Print benchmark results."""
    if quiet:
        # Machine-parseable output
        print(f"JITLESS={result.jitless}")
        print(f"SIZE_BYTES={result.size_bytes}")
        print(f"NUM_PEERS={result.num_peers}")
        print(f"TOTAL_TICKS={result.total_ticks}")
        print(f"TOTAL_TIME_SEC={result.total_time_sec:.2f}")
        print(f"AVG_TICK_MS={result.avg_tick_ms:.2f}")
        print(f"MAX_TICK_MS={result.max_tick_ms:.2f}")
        print(f"P95_TICK_MS={result.p95_tick_ms:.2f}")
        print(f"P99_TICK_MS={result.p99_tick_ms:.2f}")
        print(f"DOWNLOAD_SPEED_MBPS={result.download_speed_mbps:.2f}")
    else:
        mode = "JIT-less" if result.jitless else "JIT (V8)"
        size_mb = result.size_bytes / (1024 * 1024)
        peers_str = f", {result.num_peers} peers" if result.num_peers > 1 else ""
        print()
        print("=" * 60)
        print(f"TICK BENCHMARK RESULTS ({mode}{peers_str})")
        print("=" * 60)
        print(f"Download size:     {size_mb:.0f} MB")
        if result.num_peers > 1:
            print(f"Seeders:           {result.num_peers}")
        print(f"Total time:        {result.total_time_sec:.1f} seconds")
        print(f"Download speed:    {result.download_speed_mbps:.1f} MB/s")
        print()
        print("Tick Performance (100ms interval):")
        print(f"  Total ticks:     {result.total_ticks}")
        print(f"  Average:         {result.avg_tick_ms:.2f} ms")
        print(f"  Maximum:         {result.max_tick_ms:.2f} ms")
        print(f"  P95:             {result.p95_tick_ms:.2f} ms")
        print(f"  P99:             {result.p99_tick_ms:.2f} ms")
        print()

        # Analysis
        if result.avg_tick_ms > 50:
            print("WARNING: Average tick time exceeds 50ms - may cause performance issues")
        elif result.avg_tick_ms > 20:
            print("NOTE: Average tick time is elevated (>20ms)")
        else:
            print("OK: Tick performance is good (<20ms average)")

        if result.max_tick_ms > 100:
            print(f"WARNING: Max tick ({result.max_tick_ms:.0f}ms) exceeds tick interval (100ms)")
        print("=" * 60)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark tick performance during torrent download."
    )
    parser.add_argument(
        "--jitless",
        action="store_true",
        help="Run Node.js with --jitless flag (simulates QuickJS-like performance)",
    )
    parser.add_argument(
        "--size",
        choices=["100mb", "1gb"],
        default="100mb",
        help="Test file size (default: 100mb)",
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Machine-parseable output only",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=600,
        help="Timeout in seconds (default: 600)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=1.0,
        help="How often to poll stats in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--peers",
        type=int,
        default=1,
        help="Number of seeders to use (default: 1). If >1, starts swarm automatically.",
    )
    parser.add_argument(
        "--base-port",
        type=int,
        default=6881,
        help="Base port for seeders (default: 6881)",
    )

    args = parser.parse_args()

    # Determine info hash, filename, and size
    if args.size == "1gb":
        info_hash = INFOHASH_1GB
        filename = FILENAME_1GB
        size_bytes = 1024 * 1024 * 1024
    else:
        info_hash = INFOHASH_100MB
        filename = FILENAME_100MB
        size_bytes = 100 * 1024 * 1024

    # Build peer list
    peer_list = [("127.0.0.1", args.base_port + i) for i in range(args.peers)]
    magnet = build_magnet(info_hash, filename, peer_list)

    # For swarm mode, we'll start the seeders ourselves
    seeder_proc = None
    if args.peers > 1:
        if not args.quiet:
            mode = "JIT-less" if args.jitless else "JIT (V8)"
            print(f"Starting tick benchmark ({mode}, {args.size}, {args.peers} peers)")
            print(f"Starting swarm seeder with {args.peers} peers...")

        # Start the swarm seeder
        script_dir = os.path.dirname(os.path.abspath(__file__))
        seeder_cmd = [
            "uv", "run", "python", "seed_for_test_swarm.py",
            "--count", str(args.peers),
            "--size", args.size,
            "--port", str(args.base_port),
            "--kill",  # Kill any existing processes on those ports
            "--quiet",
        ]
        seeder_proc = subprocess.Popen(
            seeder_cmd,
            cwd=script_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Give seeders time to start
        time.sleep(3)

        if seeder_proc.poll() is not None:
            print("ERROR: Swarm seeder failed to start", file=sys.stderr)
            stdout, stderr = seeder_proc.communicate()
            print(stderr.decode(), file=sys.stderr)
            return 1

        if not args.quiet:
            print(f"Swarm seeder started (PID {seeder_proc.pid})")
            print()
    else:
        if not args.quiet:
            mode = "JIT-less" if args.jitless else "JIT (V8)"
            print(f"Starting tick benchmark ({mode}, {args.size})")
            print(f"Make sure seeder is running: pnpm seed-for-test --size {args.size}")
            print()

    # Create temp directory for download
    import tempfile
    import shutil

    download_dir = tempfile.mkdtemp(prefix="tick_benchmark_")

    try:
        # Start engine
        if not args.quiet:
            print(f"Starting engine (jitless={args.jitless})...")

        engine = JSTEngine(
            download_dir=download_dir,
            jitless=args.jitless,
            verbose=not args.quiet,
        )

        if not args.quiet:
            print(f"Engine started on RPC port {engine.rpc_port}")
            print(f"Adding magnet link...")

        # Add torrent
        tid = engine.add_magnet(magnet)

        if not args.quiet:
            print(f"Torrent added: {tid}")
            print(f"Waiting for peer connection and download...")
            print()

        # Collect samples during download
        samples, all_tick_times = collect_tick_samples(
            engine,
            tid,
            poll_interval=args.poll_interval,
            timeout=args.timeout,
            quiet=args.quiet,
        )

        # Calculate and print results
        result = calculate_results(samples, all_tick_times, args.jitless, size_bytes, args.peers)
        print_results(result, args.quiet)

        return 0

    except KeyboardInterrupt:
        if not args.quiet:
            print("\nInterrupted by user")
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        # Cleanup
        try:
            engine.close()
        except:
            pass
        shutil.rmtree(download_dir, ignore_errors=True)
        # Stop swarm seeder if we started it
        if seeder_proc is not None:
            try:
                seeder_proc.terminate()
                seeder_proc.wait(timeout=5)
            except:
                seeder_proc.kill()


if __name__ == "__main__":
    sys.exit(main())

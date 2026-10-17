#!/usr/bin/env python3
"""Observe a real shipping JSTorrent update through its authenticated API.

Runs in an owned VM. Uses the production identity, installed binary, real feed
and real timers. It never supplies installer bytes or overrides updater trust.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import guest
from live_files import publish_text

guest.IDENTIFIER = "com.jstorrent.desktop"


def schemas():
    config = guest.config_root()
    data = (Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / guest.IDENTIFIER
            if sys.platform.startswith("linux") else config)
    result = {}
    for name, path in (("product", config / "product.db"), ("session", data / "profile/session.db"),
                       ("metrics", data / "profile/metrics.db")):
        if not path.exists():
            continue
        with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2) as connection:
            version = connection.execute("SELECT schema_version FROM metrics_meta WHERE singleton=1" if name == "metrics" else "PRAGMA user_version").fetchone()[0]
            result[name] = {"version": version}
            if name == "session":
                result[name]["torrents"] = connection.execute("SELECT count(*) FROM torrents").fetchone()[0]
                ids = [row[0].hex() for row in connection.execute("SELECT torrent_id FROM torrents ORDER BY torrent_id")]
                result[name]["identityDigest"] = hashlib.sha256(json.dumps(ids).encode()).hexdigest()
                if connection.execute("SELECT count(*) FROM sqlite_master WHERE name='qualification_update_probe'").fetchone()[0]:
                    result[name]["qualificationProbe"] = connection.execute("SELECT marker FROM qualification_update_probe WHERE singleton=1").fetchone()[0]
            if name == "product":
                value = connection.execute("SELECT installation_id FROM product_state WHERE singleton=1").fetchone()[0]
                result[name]["identityDigest"] = hashlib.sha256(value.encode()).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--expect-version")
    parser.add_argument("--expect-phase")
    parser.add_argument("--channel", choices=["stable", "latest"])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--snapshot", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / ".jstorrent-update-test").is_file() or not 1 <= args.timeout <= 7200:
        raise ValueError("An owned test root and bounded timeout are required")
    deadline = time.monotonic() + args.timeout
    connection = None
    records = []
    next_report = 0
    channel_sent = False
    check_sent = False
    try:
        while time.monotonic() < deadline:
            try:
                if connection is None:
                    connection = guest.Application()
                    records.append({"kind": "connected", "at": time.monotonic(),
                                    "version": connection.hello.get("product", {}).get("version"), "schemas": schemas()})
                    next_report = 0
                if args.channel and not channel_sent:
                    connection.update({"action": "select_channel", "channel": args.channel})
                    channel_sent = True
                if args.check and not check_sent:
                    connection.update({"action": "check"})
                    check_sent = True
                if time.monotonic() >= next_report:
                    connection.update({"action": "activity", "interacted": False, "blocked": False})
                    next_report = time.monotonic() + 15
                status = connection.update({"action": "status"})
                version = connection.hello.get("product", {}).get("version")
                record = {"kind": "status", "at": time.monotonic(), "version": version,
                          "phase": status["phase"], "candidate": status["version"], "message": status["message"],
                          "restartInSeconds": status["restartInSeconds"], "automaticAvailable": status["automaticAvailable"],
                          "automaticInstall": status["automaticInstall"], "channel": status["channel"]}
                if not records or {k: v for k, v in records[-1].items() if k != "at"} != {k: v for k, v in record.items() if k != "at"}:
                    records.append(record)
                if len(records) > 4096:
                    raise RuntimeError("Observation bound exceeded")
                if args.snapshot or ((not args.expect_version or version == args.expect_version)
                                     and (not args.expect_phase or status["phase"] == args.expect_phase)
                                     and (not args.expect_version or (status.get("lastOutcome") or {}).get("succeeded") is True)
                                     and (args.expect_version or args.expect_phase)):
                    receipt = {"passed": True, "version": version, "status": status, "schemas": schemas(), "records": records}
                    (root / "live-result.json").write_text(json.dumps(receipt, indent=2))
                    print(json.dumps({k: v for k, v in receipt.items() if k != "records"}))
                    return
            except (OSError, ValueError, EOFError) as error:
                if connection:
                    connection.close()
                connection = None
                (root / "last-error").write_text(str(error)[:1024])
            finally:
                publish_text(root / "live-observations.json", json.dumps(records, indent=2))
            time.sleep(.5)
        raise TimeoutError("Real installed update did not satisfy the expected state")
    finally:
        if connection:
            connection.close()


if __name__ == "__main__":
    main()

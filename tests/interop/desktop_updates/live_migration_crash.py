"""Kill only the owned Linux app after a private migration spills WAL writes.

The driver must relaunch the installed app afterward and verify completion.
This observes a real process crash; it does not inject database writes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import time

import guest

guest.IDENTIFIER = "com.jstorrent.desktop"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--previous-pid", type=int, required=True)
    parser.add_argument("--appimage-sha256", required=True)
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()
    root = args.root.resolve()
    profile = Path.home() / ".local/share/com.jstorrent.desktop"
    if not (root / ".jstorrent-update-test").is_file() or not 1 <= args.timeout <= 1800:
        raise ValueError("An owned test root and bounded timeout are required")
    if (profile / ".jstorrent-377-owned-profile").read_text() != str(root):
        raise ValueError("Refusing an unowned profile")
    image = root / "JSTorrent.AppImage"
    database = profile / "profile/session.db"
    wal = database.with_name(database.name + "-wal")
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        if wal.exists() and wal.stat().st_size > 2 * 1024 * 1024:
            for process in Path("/proc").iterdir():
                if not process.name.isdigit() or int(process.name) == args.previous_pid:
                    continue
                try:
                    if process.stat().st_uid != os.getuid() or (process / "exe").resolve().name != "jstorrent-client":
                        continue
                    environment = (process / "environ").read_bytes().split(b"\0")
                    if ("APPIMAGE=" + str(image)).encode() not in environment:
                        continue
                    with image.open("rb") as stream:
                        if hashlib.file_digest(stream, "sha256").hexdigest() != args.appimage_sha256:
                            continue
                    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1) as connection:
                        if connection.execute("PRAGMA user_version").fetchone()[0] != 29:
                            raise ValueError("The migration already committed")
                        ids = [row[0].hex() for row in connection.execute("SELECT torrent_id FROM torrents ORDER BY torrent_id")]
                        if connection.execute("SELECT count(*) FROM sqlite_master WHERE name='qualification_update_probe'").fetchone()[0]:
                            raise ValueError("Uncommitted probe became visible")
                    receipt = {"pid": int(process.name), "walBytes": wal.stat().st_size,
                               "versionBeforeCrash": 29, "uncommittedProbeVisible": False,
                               "identityDigest": hashlib.sha256(json.dumps(ids).encode()).hexdigest()}
                    os.kill(int(process.name), signal.SIGKILL)
                    (root / "migration-crash.json").write_text(json.dumps(receipt, indent=2))
                    print(json.dumps(receipt))
                    return
                except FileNotFoundError:
                    continue
        time.sleep(.025)
    raise TimeoutError("The owned migration did not enter its uncommitted spill window")


if __name__ == "__main__":
    main()

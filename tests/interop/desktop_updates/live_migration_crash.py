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
import struct
import time

import guest

guest.IDENTIFIER = "com.jstorrent.desktop"


def uncommitted_wal_bytes(path):
    """Count checksum-valid pages after the last commit, excluding stale tails.

    Independently authored from https://sqlite.org/fileformat2.html#wal_format.
    This is a bounded test observer, not a database recovery implementation.
    """
    with path.open("rb") as stream:
        data = stream.read(32 * 1024 * 1024 + 1)
    if len(data) < 32 or len(data) > 32 * 1024 * 1024:
        return 0
    magic, version, size = struct.unpack_from(">III", data)
    if magic not in (0x377F0682, 0x377F0683) or version != 3007000 or size < 512 or size > 65536 or size & (size - 1):
        return 0
    order = "<" if magic == 0x377F0682 else ">"

    def checksum(value, state):
        first, second = state
        for left, right in struct.iter_unpack(order + "II", value):
            first = (first + left + second) & 0xFFFFFFFF
            second = (second + right + first) & 0xFFFFFFFF
        return first, second

    state = checksum(data[:24], (0, 0))
    if state != struct.unpack_from(">II", data, 24):
        return 0
    pending = 0
    for offset in range(32, len(data) - size - 23, size + 24):
        page, committed = struct.unpack_from(">II", data, offset)
        if not page or data[offset + 8:offset + 16] != data[16:24]:
            break
        state = checksum(memoryview(data)[offset:offset + 8], state)
        state = checksum(memoryview(data)[offset + 24:offset + 24 + size], state)
        if state != struct.unpack_from(">II", data, offset + 16):
            break
        pending = 0 if committed else pending + size
    return pending


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
                    if process.stat().st_uid != os.getuid() or (process / "comm").read_text().strip() not in ("jstorrent-clien", "jstorrent-client"):
                        continue
                    if (process / "exe").resolve().name != "jstorrent-client":
                        continue
                    environment = (process / "environ").read_bytes().split(b"\0")
                    if ("APPIMAGE=" + str(image)).encode() not in environment:
                        continue
                    with image.open("rb") as stream:
                        if hashlib.file_digest(stream, "sha256").hexdigest() != args.appimage_sha256:
                            continue
                    uncommitted = uncommitted_wal_bytes(wal)
                    if uncommitted <= 2 * 1024 * 1024:
                        continue
                    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1) as connection:
                        if connection.execute("PRAGMA user_version").fetchone()[0] != 29:
                            raise ValueError("The migration already committed")
                        ids = [row[0].hex() for row in connection.execute("SELECT torrent_id FROM torrents ORDER BY torrent_id")]
                        if connection.execute("SELECT count(*) FROM sqlite_master WHERE name='qualification_update_probe'").fetchone()[0]:
                            raise ValueError("Uncommitted probe became visible")
                    receipt = {"pid": int(process.name), "walBytes": wal.stat().st_size,
                               "uncommittedWalBytes": uncommitted,
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

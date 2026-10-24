#!/usr/bin/env python3
"""Independent read-only oracle for Tactical 233's closed generated cohort."""
import argparse
import base64
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import libtorrent as lt


def json_file(path):
    assert path.stat().st_size <= 16 * 1024 * 1024
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).parents[1] / "fixtures/legacy-desktop-v0.2.1")
    parser.add_argument("--closed-root", type=Path)
    args = parser.parse_args()
    assert lt.version.startswith("2.0.11")
    total = 0
    for platform in ("linux", "windows"):
        folder = args.fixtures / platform
        manifest = json_file(folder / "manifest.json")
        assert manifest["platform"] == platform
        assert len(manifest["profiles"]) == 7
        assert len(manifest["expectedUnion"]) == 4
        closed = args.closed_root / platform if args.closed_root else None
        for profile in manifest["profiles"]:
            values = json_file(folder / (profile["variant"] + ".json"))
            assert len(values) <= 64 and all(key.startswith("session:") for key in values)
            index = json.loads(values["session:torrents"])
            assert index["version"] == 2
            assert {row["infoHash"] for row in index["torrents"]} == {row["infoHash"] for row in profile["records"]}
            if closed:
                db = closed / profile["snapshot"]
                assert hashlib.sha256(db.read_bytes()).hexdigest() == profile["sha256"]
                with closing(sqlite3.connect(db.as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
                    assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
                    assert dict(connection.execute("SELECT key,value FROM kv")) == values
            for record in profile["records"]:
                total += 1
                identity = record["infoHash"]
                state = json.loads(values[f"session:torrent:{identity}:state"])
                assert state["storageKey"] == profile["rootKey"]
                assert state["userState"] == record["intent"]
                if record["source"] == "magnet":
                    entry = next(row for row in index["torrents"] if row["infoHash"] == identity)
                    assert identity in entry["magnetUri"]
                    continue
                data = base64.b64decode(json.loads(values[f"session:torrent:{identity}:torrentfile"]), validate=True)
                assert len(data) <= 8 * 1024 * 1024
                info = lt.torrent_info(data)
                assert str(info.info_hashes().v1) == identity
                assert info.num_pieces() == state["pieceCount"]
                if not closed:
                    continue
                location = closed / profile["location"]
                if profile["availability"] == "missing":
                    assert not location.exists()
                    location = location.with_name("unavailable-offline")
                payload = location / record["name"]
                assert hashlib.sha256(payload.read_bytes()).hexdigest() == record["sha256"]
                files = info.files()
                joined = bytearray()
                available = bytearray()
                for file_index in range(files.num_files()):
                    relative = Path(files.file_path(file_index))
                    assert not relative.is_absolute() and ".." not in relative.parts
                    path = location / relative
                    block = path.read_bytes() if path.exists() else b""
                    size = files.file_size(file_index)
                    assert len(block) <= size and len(joined) + size <= 64 * 1024 * 1024
                    joined.extend(block + bytes(size - len(block)))
                    available.extend(bytes([1]) * len(block) + bytes(size - len(block)))
                verified = []
                for piece in range(info.num_pieces()):
                    start = piece * info.piece_length()
                    stop = start + info.piece_size(piece)
                    verified.append(all(available[start:stop]) and hashlib.sha1(joined[start:stop]).digest() == info.hash_for_piece(piece))
                assert sum(verified) == record["verifiedPieces"]
                bits = bytes.fromhex(state["bitfield"])
                assert [bool(bits[i // 8] & (128 >> (i % 8))) for i in range(len(verified))] == verified
        for mutation in manifest["syntheticMutations"]:
            values = json_file(folder / (mutation["kind"] + ".json"))
            state_text = next(value for key, value in values.items() if key.endswith(":state"))
            if mutation["kind"] == "invalid-state-json":
                try:
                    json.loads(state_text)
                except json.JSONDecodeError:
                    pass
                else:
                    raise AssertionError("malformed-state fixture became valid")
            else:
                assert json.loads(state_text)["storageKey"] == mutation["rootKey"]
        print(json.dumps({"platform": platform, "profiles": 7, "mutations": 2, "identities": 4, "result": "pass"}))
    assert total == 16


if __name__ == "__main__":
    main()

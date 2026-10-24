#!/usr/bin/env python3
"""Audit the generated Android 1.0.24 format cohort, never an installed profile.

This is a fixture/format oracle, not a metainfo validator or migration preview.
It creates the pinned nullable Android KV schema in temporary SQLite files and
backs it up read-only, including committed WAL. No destination is opened.
"""
import argparse
import base64
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile

FIXTURES = Path(__file__).parents[1] / "fixtures/legacy-android-v1.0.24/cohort.json"
SOURCE_COMMIT = "7b454be4410385f9c4f7f135cb6b16194a2b0409"
MAX_BYTES = 1024 * 1024
MAX_RECORDS = 500


def bounded_json(path):
    if path.is_symlink() or path.stat().st_size > MAX_BYTES:
        raise ValueError("fixture file exceeds bound or is a symlink")
    return json.loads(path.read_text(encoding="utf-8"))


def binary(value):
    if not isinstance(value, str) or len(value) > MAX_BYTES:
        raise ValueError("invalid fixture binary value")
    encoded = json.loads(value)
    if not isinstance(encoded, str):
        raise ValueError("binary must be a JSON-wrapped string")
    normalized = "".join(encoded.split()).replace("-", "+").replace("_", "/")
    return base64.b64decode(normalized, validate=True)


def audit(values, roots, preferences):
    """Classify format-level candidates; access and metainfo remain unproven."""
    if len(roots) > 32:
        raise ValueError("too many roots")
    index = json.loads(values.get("session:torrents") or "null")
    if not isinstance(index, dict) or index.get("version") != 2:
        raise ValueError("unsupported session index")
    entries = index.get("torrents")
    if not isinstance(entries, list) or len(entries) > MAX_RECORDS:
        raise ValueError("invalid record count")
    valid_roots = {}
    for root in roots:
        key, uri = root.get("key"), root.get("uri")
        if not isinstance(uri, str) or len(uri) > 16 * 1024:
            continue
        if not uri.startswith("content://") or "/tree/" not in uri:
            continue
        if key != hashlib.sha256(uri.encode()).hexdigest()[:16]:
            continue
        valid_roots.setdefault(key, []).append(root)
    review = any(
        preferences.get(key, False) is not False
        for key in ("vpn_only_enabled", "shutdown_low_battery_enabled")
    ) or not isinstance(preferences.get("wifi_only_enabled", False), bool)
    outcomes = []
    metadata, pending, candidates = 0, 0, 0
    bound_roots = set()
    for ordinal, entry in enumerate(entries):
        disposition = "invalid_record"
        try:
            digest = entry["infoHash"]
            if not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{40}", digest):
                raise ValueError("invalid identity")
            prefix = f"session:torrent:{digest}"
            state = json.loads(values[f"{prefix}:state"])
            if state["userState"] not in ("active", "queued", "stopped", "awaitingFileSelection"):
                raise ValueError("invalid intent")
            root_key = state.get("storageKey")
            if root_key in ("", "default"):
                disposition = "private_storage_requires_handoff"
            elif len(valid_roots.get(root_key, [])) != 1:
                disposition = "unknown_or_ambiguous_root"
            else:
                priorities = state.get("filePriorities", [])
                if not isinstance(priorities, list) or any(type(p) is not int or p not in (0, 1) for p in priorities):
                    raise ValueError("invalid selection")
                if entry["source"] == "file":
                    binary(values[f"{prefix}:torrentfile"])
                    has_metadata = True
                elif entry["source"] == "magnet":
                    if f"xt=urn:btih:{digest}" not in entry.get("magnetUri", ""):
                        raise ValueError("mismatched fixture magnet")
                    info = values.get(f"{prefix}:infodict")
                    has_metadata = info is not None
                    if has_metadata and hashlib.sha1(binary(info)).hexdigest() != digest:
                        raise ValueError("cached info mismatch")
                else:
                    raise ValueError("invalid source")
                candidates += 1
                metadata += int(has_metadata)
                pending += int(not has_metadata)
                bound_roots.add(root_key)
                disposition = "candidate_requires_validation"
        except (KeyError, TypeError, ValueError):
            pass
        outcomes.append({"record": ordinal, "disposition": disposition})
    return {
        "records": len(entries), "format_candidates": candidates,
        "metadata_requires_checking": metadata, "pending_magnets": pending,
        "roots_require_runtime_grant_check": len(bound_roots),
        "requires_policy_review": review, "verified_pieces": 0,
        "outcomes": outcomes,
    }


def verify_cohort(path=FIXTURES):
    cohort = bounded_json(path)
    if cohort["source_commit"] != SOURCE_COMMIT or cohort["kind"] != "independently-authored-format-fixtures":
        raise ValueError("incorrect fixture provenance")
    if not isinstance(cohort["cases"], list) or len(cohort["cases"]) > 16:
        raise ValueError("fixture case count exceeds bound")
    results = []
    with tempfile.TemporaryDirectory(prefix="rstorrent-android-inventory-") as owned:
        root = Path(owned)
        for ordinal, case in enumerate(cohort["cases"]):
            if len(case["kv"]) > 128:
                raise ValueError("fixture KV count exceeds bound")
            database = root / f"source-{ordinal}.db"
            with closing(sqlite3.connect(database)) as writer:
                writer.executescript("PRAGMA user_version=1; PRAGMA journal_mode=WAL; CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT)")
                writer.executemany("INSERT INTO kv VALUES (?, ?)", case["kv"].items())
                writer.commit()
                wal = Path(str(database) + "-wal")
                assert wal.stat().st_size > 32
                source_bytes = (database.read_bytes(), wal.read_bytes())
                # Keep writer open to ensure the backup actually sees committed WAL.
                with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source:
                    before = list(source.execute("SELECT key, value FROM kv ORDER BY key"))
                    with closing(sqlite3.connect(root / f"snapshot-{ordinal}.db")) as snapshot:
                        source.backup(snapshot)
                        assert snapshot.execute("PRAGMA user_version").fetchone() == (1,)
                        values = dict(snapshot.execute("SELECT key, value FROM kv"))
                    assert before == list(source.execute("SELECT key, value FROM kv ORDER BY key"))
                    assert values == case["kv"]
                    assert source_bytes == (database.read_bytes(), wal.read_bytes())
            report = audit(values, case["roots"]["roots"], case["preferences"])
            for field, expected in case["expected"].items():
                assert report[field] == expected, (ordinal, field)
            results.append({"case": ordinal, **report})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=FIXTURES)
    args = parser.parse_args()
    print(json.dumps({"kind": "format-audit-only", "cases": verify_cohort(args.fixtures)}, indent=2))


if __name__ == "__main__":
    main()

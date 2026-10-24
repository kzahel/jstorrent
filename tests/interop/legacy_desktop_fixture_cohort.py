#!/usr/bin/env python3
"""Create only generated Tactical 233 libraries with pinned legacy writers.

Run inside a claimed disposable guest. Never point --root at an existing tree.
The native binaries must be extracted from the checksum-pinned release, and
--source must be the pinned source archive, with its tsx/bn.js test dependencies.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import sqlite3
import struct
import subprocess
import threading

PIN = "73427b7d3aef2eaf1c4ac1409922fbb52dff751d"
LIMIT = 8 * 1024 * 1024
SOURCE_TREE = "4e7b3aaeee42e454f82c89dd1e4ee500d7ee649e74d1df33230c85e8cb4cc2a9"
BINARIES = {
    "linux": ("e7046ce3e957eb73296886faf84380b77c73e3b6b0392e7926afb93712b8a480",
              "4ab2c88ac0152cf9276e3586c6fc43e004fdbb5e8a8be763a039c1a38103d548"),
    "windows": ("fb79545830c8aae032820100a0044c2a3ea29763aba2f1d35623025ae82af38c",
                "6cd89eed30f417b97cb13d123280cdcf7138564d8630e29a1db14a8ed1346754"),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Host:
    def __init__(self, executable, config, log):
        self.log = log.open("wb")
        self.process = subprocess.Popen([str(executable), "--launcher", "tauri"],
            env={**os.environ, "JSTORRENT_CONFIG_DIR": str(config)},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log)
        self.messages = queue.Queue(maxsize=32)
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()
        self.serial = 0

    def read(self):
        try:
            while header := self.process.stdout.read(4):
                if len(header) != 4:
                    raise ValueError("truncated native header")
                length, = struct.unpack("<I", header)
                if not 0 < length <= LIMIT:
                    raise ValueError("oversized native response")
                body = self.process.stdout.read(length)
                if len(body) != length:
                    raise ValueError("truncated native body")
                self.messages.put(json.loads(body), timeout=5)
        except Exception as error:
            self.messages.put(error, timeout=5)

    def call(self, op, **fields):
        self.serial += 1
        request_id = str(self.serial)
        body = json.dumps(dict(id=request_id, op=op, **fields)).encode()
        if len(body) > LIMIT:
            raise ValueError("oversized request")
        self.process.stdin.write(struct.pack("<I", len(body)) + body)
        self.process.stdin.flush()
        for _ in range(32):
            response = self.messages.get(timeout=20)
            if isinstance(response, Exception):
                raise response
            if response.get("id") != request_id:
                continue
            if not response.get("ok"):
                raise RuntimeError("legacy operation refused: " + op)
            return response.get("payload", {})
        raise RuntimeError("too many unsolicited messages")

    def close(self):
        self.process.stdin.close()
        try:
            code = self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
            raise RuntimeError("legacy host failed graceful teardown")
        finally:
            self.thread.join(timeout=5)
            self.process.stdout.close()
            self.log.close()
        if code or self.thread.is_alive():
            raise RuntimeError("legacy host/reader did not close cleanly")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--host", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--writer", type=Path, required=True)
    parser.add_argument("--tsx", type=Path, required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if not args.root.is_absolute():
        parser.error("root must be a new absolute controlled directory")
    platform = "windows" if os.name == "nt" else "linux"
    daemon = args.host.with_name("jstorrent-io-daemon" + (".exe" if os.name == "nt" else ""))
    if (digest(args.host), digest(daemon)) != BINARIES[platform]:
        raise ValueError("native binaries do not match the released cohort")
    source_hash = hashlib.sha256()
    source_root = args.source / "packages"
    for path in sorted(source_root.rglob("*"), key=lambda p: p.relative_to(source_root).as_posix()):
        if path.is_file():
            source_hash.update(path.relative_to(source_root).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
    if source_hash.hexdigest() != SOURCE_TREE:
        raise ValueError("legacy source tree differs from the pinned prepared archive")
    args.root.mkdir(parents=True, exist_ok=False)
    config = args.root / "live-config"
    snapshots = args.root / "snapshots"
    snapshots.mkdir()
    manifest = {"sourceCommit": PIN, "hostSha256": digest(args.host),
        "sourceTreeSha256": SOURCE_TREE, "platform": platform,
        "kind": "released-host-and-pinned-engine-writer", "profiles": []}
    for variant in ("empty", "alpha", "same", "conflict", "disjoint", "unavailable", "multifile"):
        logical_root = "shared" if variant in ("alpha", "same") else variant
        payload_root = args.root / "payload" / logical_root
        payload_root.mkdir(parents=True, exist_ok=True)
        host = Host(args.host, config, args.root / (variant + ".host.log"))
        try:
            hello = host.call("handshake", extensionId="fixture-desktop", clientType="tauri")
            profile_id = hello["profileId"]
            root = host.call("registerDownloadRoot", path=str(payload_root))["root"]
            spec = args.root / (variant + ".spec.json")
            output = args.root / (variant + ".records.json")
            spec.write_text(json.dumps(dict(variant=variant, rootKey=root["key"], rootPath=str(payload_root))), encoding="utf-8")
            with (args.root / (variant + ".writer.log")).open("wb") as log:
                subprocess.run([args.node, str(args.tsx), str(args.writer), str(spec), str(output)],
                    env={**os.environ, "RSTORRENT_LEGACY_SOURCE": str(args.source)},
                    stdout=log, stderr=subprocess.STDOUT, check=True, timeout=45)
            if output.stat().st_size > 16 * 1024 * 1024:
                raise ValueError("oversized writer output")
            written = json.loads(output.read_text(encoding="utf-8"))
            if len(written["kv"]) > 64:
                raise ValueError("too many writer records")
            for entry in written["kv"]:
                host.call("kvSet", **entry)
                assert host.call("kvGet", key=entry["key"])["value"] == entry["value"]
        finally:
            host.close()
        original = config / "jstorrent-native" / "profiles" / profile_id / "data.db"
        if original.stat().st_size > 16 * 1024 * 1024:
            raise ValueError("oversized source database")
        snapshot = snapshots / (variant + ".db")
        with closing(sqlite3.connect(original)) as source, closing(sqlite3.connect(snapshot)) as destination:
            source.backup(destination)
            assert destination.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            actual = dict(destination.execute("SELECT key,value FROM kv"))
            assert actual == {entry["key"]: entry["value"] for entry in written["kv"]}
        for record in written["records"]:
            if record["source"] == "file":
                assert digest(payload_root / record["name"]) == record["sha256"]
        if variant == "unavailable":
            payload_root.rename(payload_root.with_name("unavailable-offline"))
        manifest["profiles"].append(dict(variant=variant, sourceProfile=profile_id,
            rootKey=root["key"], location="payload/" + logical_root,
            availability="missing" if variant == "unavailable" else "available",
            snapshot="snapshots/" + snapshot.name, sha256=digest(snapshot),
            keys=sorted(actual), records=written["records"]))
    groups = {}
    for profile in manifest["profiles"]:
        for record in profile["records"]:
            groups.setdefault(record["infoHash"], []).append({
                "profile": profile["variant"], "location": profile["location"],
                "availability": profile["availability"], "source": record["source"],
                "intent": record["intent"]})
    manifest["expectedUnion"] = [{"infoHash": identity, "sources": members,
        "disposition": "held-location-conflict" if len({m["location"] for m in members}) > 1
        else "held-metadata" if members[0]["source"] == "magnet"
        else "inactive-pending-reverification"}
        for identity, members in sorted(groups.items())]
    # Keep valid writer snapshots intact; mutation provenance is explicit.
    alpha = next(p for p in manifest["profiles"] if p["variant"] == "alpha")
    conflict = next(p for p in manifest["profiles"] if p["variant"] == "conflict")
    mutations = []
    for kind, original_profile in (("colliding-root-key", conflict), ("invalid-state-json", alpha)):
        target = snapshots / (kind + ".db")
        shutil.copyfile(args.root / original_profile["snapshot"], target)
        with closing(sqlite3.connect(target)) as database:
            key, value = database.execute("SELECT key,value FROM kv WHERE key LIKE '%:state'").fetchone()
            state = json.loads(value)
            state["storageKey"] = alpha["rootKey"]
            database.execute("UPDATE kv SET value=? WHERE key=?",
                ("{" if kind == "invalid-state-json" else json.dumps(state), key))
            database.commit()
        mutations.append({"kind": kind, "derivedFrom": original_profile["snapshot"],
            "originalSha256": original_profile["sha256"], "snapshot": "snapshots/" + target.name,
            "sha256": digest(target), "rootKey": alpha["rootKey"],
            "location": original_profile["location"],
            "expected": "visible-held-invalid-state" if kind == "invalid-state-json" else "source-qualified-location-conflict"})
    manifest["syntheticMutations"] = mutations
    (args.root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"profiles": len(manifest["profiles"]),
        "records": sum(len(p["records"]) for p in manifest["profiles"]),
        "integrity": "ok", "payloadHashes": "matched", "sourceCommit": PIN}))


if __name__ == "__main__":
    main()

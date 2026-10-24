#!/usr/bin/env python3
"""Tactical 242 installed macOS rehearsal, ONLY inside a claimed test guest.

Requires checksum-pinned v0.2.1 app archive, a local production-identity
candidate archive, and a new absolute --root. Native UI inspection and Quit/OK
actions belong to Machine Control on the controller, not this driver. Watch
root/phase.json; at legacy-ui use Quit, at idle-host-blocked/registration-blocked
inspect and press OK, and at migrated/restarted inspect the connected native
view then Quit. Closed SQLite checks own the library/verification assertions.
Parentless macOS migration alerts belong to UserNotificationCenter, not the
JSTorrent process. Inspect the alert's title/message before selecting its OK
button; other applications may have alerts under that same owner. An ended
Machine Control grant stops UI actions rather than changing control routes.
The driver restores inherited app/profile/registration state in finally.
No browser is started and no public swarm is used.
"""
import argparse
import base64
from contextlib import closing, contextmanager
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time

from legacy_desktop_signed_update import assert_gui_source, check_and_apply, owned_pids, stop_owned
from legacy_desktop_fixture_cohort import Host, digest

LEGACY_ARCHIVE = "4bc5e979635fe9283d9ba60e43f86bfadcf619adf546cdbe4b68b27d424343f1"
LEGACY_BINARIES = {
    "jstorrent-desktop": "f008e2d00e7e414e16096d1ea319d870807ddeddb25d459740b01a0727b019e7",
    "jstorrent-host": "cc5faaefa59e72d6ac098251ea7cc7c9ec90b35711c342a1211faa01e04a0411",
    "jstorrent-io-daemon": "57b77c713f4f6b09c955f73694bd3dce7731042093d215e1ec64871d15f88f56",
}
BROWSERS = ("Google/Chrome", "Google/Chrome Canary", "Google/Chrome for Testing",
            "Google/ChromeForTesting", "Chromium", "BraveSoftware/Brave-Browser",
            "Microsoft Edge", "Vivaldi", "Arc/User Data")


def bencode(value):
    if isinstance(value, int):
        return b"i" + str(value).encode() + b"e"
    if isinstance(value, bytes):
        return str(len(value)).encode() + b":" + value
    return b"d" + b"".join(bencode(k) + bencode(v) for k, v in sorted(value.items())) + b"e"


def extract(archive, destination):
    destination.mkdir()
    # The pinned release and our own candidate must contain one real app tree.
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts or path.parts[0] != "JSTorrent.app":
                raise ValueError("archive is not the expected app tree")
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError("unexpected archive member type")
        source.extractall(destination)
    app = destination / "JSTorrent.app"
    with (app / "Contents/Info.plist").open("rb") as source:
        assert plistlib.load(source)["CFBundleIdentifier"] == "com.jstorrent.desktop"
    return app


def wait_until(predicate, seconds=180):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.25)
    raise TimeoutError("rehearsal phase timed out")


@contextmanager
def closed_copy(db, root):
    """Inspect a closed writer's DB/WAL without initializing its source SHM."""
    with tempfile.TemporaryDirectory(dir=root) as temporary:
        copied = Path(temporary) / "data.db"
        for suffix in ("", "-wal"):
            original = db.with_name(db.name + suffix)
            if original.exists():
                assert original.stat().st_size <= 16 * 1024 * 1024
                shutil.copyfile(original, copied.with_name(copied.name + suffix))
        with closing(sqlite3.connect(copied)) as connection:
            connection.execute("PRAGMA query_only=ON")
            yield connection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--isolated-guest", action="store_true", required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--legacy", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--candidate-sha256", required=True)
    parser.add_argument("--candidate-executable", choices=("jstorrent-client", "rstorrent-desktop"),
                        default="jstorrent-client",
                        help="select rstorrent-desktop only for historical pre-280 packages")
    parser.add_argument("--trial-installation-id", type=Path,
                        help="Use the released HTTPS updater instead of manual replacement")
    parser.add_argument("--trial-gui", action="store_true")
    parser.add_argument("--trial-negative", choices=("wrong-signature", "interrupted"))
    args = parser.parse_args()
    assert not (args.trial_gui or args.trial_negative) or args.trial_installation_id
    if sys.platform != "darwin" or not args.root.is_absolute() or args.root.exists():
        parser.error("requires macOS and a new absolute controlled root")
    assert digest(args.legacy) == LEGACY_ARCHIVE
    assert digest(args.candidate) == args.candidate_sha256
    args.root.mkdir(parents=True)
    root = args.root
    home = Path.home()
    support = home / "Library/Application Support"
    app = home / "Applications/JSTorrent.app"
    native = support / "jstorrent-native"
    product = support / "com.jstorrent.desktop"
    children, logs, saved, created_dirs = [], [], [], []
    results = {"legacyArchiveSha256": LEGACY_ARCHIVE,
               "candidateArchiveSha256": args.candidate_sha256, "checks": []}

    def phase(name):
        (root / "phase.json").write_text(json.dumps({"phase": name, "pid": os.getpid()}))

    def preserve(path):
        backup = root / "inherited" / str(len(saved))
        backup.parent.mkdir(exist_ok=True)
        existed = path.exists() or path.is_symlink()
        if existed:
            path.rename(backup)
        saved.append((path, backup, existed))

    def ensure_dir(path):
        if not path.exists():
            if not path.parent.exists():
                ensure_dir(path.parent)
            path.mkdir()
            created_dirs.append(path)

    def launch(name, arguments=()):
        log = (root / (name + ".log")).open("wb")
        logs.append(log)
        binary = "jstorrent-desktop" if name == "legacy" else args.candidate_executable
        child = subprocess.Popen([str(app / "Contents/MacOS" / binary), *arguments],
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        children.append(child)
        return child

    def quit_and_join(child):
        wait_until(lambda: child.poll() is not None, seconds=600)
        exit_code = child.wait()
        assert exit_code == 0, f"native Quit failed (exit {exit_code})"

    def source_snapshot():
        data = {"discovery": digest(native / "rpc-info.json"), "profiles": {}, "files": {}}
        for db in sorted(native.glob("profiles/*/data.db")):
            # Released writers may leave a WAL without a reusable SHM. Inspect
            # a private copy after all writers join; never initialize source SHM.
            with closed_copy(db, root) as source:
                data["profiles"][db.parent.name] = dict(source.execute("SELECT key,value FROM kv"))
            for suffix in ("", "-wal"):
                path = db.with_name(db.name + suffix)
                # A read-only SQLite open may create an empty WAL/SHM. These
                # carry no user data; all original/nonempty WAL bytes count.
                if path.exists() and (suffix != "-wal" or path.stat().st_size > 0):
                    data["files"][str(path.relative_to(native))] = digest(path)
        return data

    def check_catalog(expected_ids=None):
        db = product / "profile/session.db"
        if not db.exists():
            return False
        # The native owner has joined before this closed-catalog inspection.
        with closed_copy(db, root) as connection:
            connection.row_factory = sqlite3.Row
            report = json.loads(connection.execute("SELECT report_json FROM legacy_desktop_import").fetchone()[0])
            settings = connection.execute("SELECT dht_enabled, peer_exchange_enabled, peer_connection_limit, upload_slots, download_rate_limit FROM client_settings").fetchone()
            assert tuple(settings) == (0, 0, 73, 5, 65536), "supported settings did not migrate"
            assert (report["imported"], report["skipped"], report["already_present"]) == (4, 0, 0)
            rows = list(connection.execute("SELECT t.*, lower(hex(i.full_hash)) AS identity FROM torrents t JOIN torrent_identities i USING(torrent_id)"))
            assert len(rows) == 4 and all(r["desired_state"] == "paused" for r in rows)
            identities = {r["identity"]: bytes(r["torrent_id"]).hex() for r in rows}
            assert set(identities) == set(expected)
            if expected_ids is not None:
                assert identities == expected_ids
            complete = True
            for row in rows:
                kind = expected[row["identity"]]
                if kind == "magnet":
                    assert row["raw_info"] is None and row["have_state"] is None
                    continue
                have = bytes(row["have_state"])
                assert have[:10] == b"RSTHAVE\0\0\x02" and len(have) == 63
                assert have[10:26] == bytes(row["torrent_id"]) and int.from_bytes(have[58:62], "big") == 1
                wanted_have = 128 if kind == "good" else 0
                if kind == "missing":
                    assert have[62] == 0
                    continue
                complete &= (row["verification_requested"] == row["verification_completed"] > 0
                             and have[62] == wanted_have)
            if not complete:
                return False
            return identities

    expected, payload_hashes = {}, {}
    try:
        # Refuse interference with an inherited running torrent app/host.
        process_names = subprocess.check_output(["/bin/ps", "-U", str(os.getuid()), "-o", "comm="]).decode()
        assert not any(Path(line.strip()).name in LEGACY_BINARIES or
                       Path(line.strip()).name in {"rstorrent-desktop", "jstorrent-client"} for line in process_names.splitlines())
        old_app = extract(args.legacy, root / "old")
        new_app = extract(args.candidate, root / "new")
        for name, sha in LEGACY_BINARIES.items():
            assert digest(old_app / "Contents/MacOS" / name) == sha
        results["legacyBinaries"] = LEGACY_BINARIES
        results["candidateBinarySha256"] = digest(new_app / "Contents/MacOS" / args.candidate_executable)
        for path in (app, native, product, home / "Library/Preferences/com.jstorrent.desktop.plist",
                     home / "Library/Saved Application State/com.jstorrent.desktop.savedState",
                     home / "Library/Caches/com.jstorrent.desktop",
                     home / "Library/WebKit/com.jstorrent.desktop"):
            preserve(path)
        ensure_dir(app.parent)
        for browser in BROWSERS:
            directory = support / browser
            ensure_dir(directory)
            preserve(directory / "NativeMessagingHosts")
        shutil.copytree(old_app, app)
        profiles = []
        for kinds in (("good", "corrupt", "magnet"), ("missing",)):
            payload = root / ("missing-root" if kinds == ("missing",) else "payload")
            payload.mkdir()
            host = Host(app / "Contents/MacOS/jstorrent-host", support, root / (kinds[0] + ".host.log"))
            try:
                hello = host.call("handshake", extensionId="isolated-rehearsal", clientType="tauri")
                profiles.append(hello["profileId"])
                storage = host.call("registerDownloadRoot", path=str(payload))["root"]["key"]
                entries = []
                for kind in kinds:
                    content = bytes([37]) * 16384
                    info = bencode({b"length": len(content), b"name": (kind + ".bin").encode(),
                                    b"piece length": len(content), b"pieces": hashlib.sha1(content).digest(), b"private": 1})
                    identity = hashlib.sha1(info).hexdigest() if kind != "magnet" else "11" * 20
                    expected[identity] = kind
                    entry = dict(infoHash=identity, source="magnet" if kind == "magnet" else "file", addedAt=1)
                    if kind == "magnet":
                        entry["magnetUri"] = "magnet:?xt=urn:btih:" + identity
                    else:
                        path = payload / (kind + ".bin")
                        path.write_bytes(content)
                        payload_hashes[str(path)] = digest(path)
                        host.call("kvSet", key=f"session:torrent:{identity}:torrentfile",
                                  value=json.dumps(base64.b64encode(b"d4:info" + info + b"e").decode()))
                    state = dict(userState="stopped", storageKey=storage,
                                 uploaded=0, downloaded=0, updatedAt=1)
                    if kind != "magnet":
                        state.update(bitfield="80", pieceCount=1, filePriorities=[0])
                    host.call("kvSet", key=f"session:torrent:{identity}:state", value=json.dumps(state))
                    entries.append(entry)
                host.call("kvSet", key="session:torrents", value=json.dumps(dict(version=2, torrents=entries)))
                host.call("kvSet", key="config:dhtEnabled", value="false")
                host.call("kvSet", key="config:pexEnabled", value="false")
                host.call("kvSet", key="config:maxGlobalPeers", value="73")
                host.call("kvSet", key="config:maxUploadSlots", value="5")
                host.call("kvSet", key="config:downloadSpeedUnlimited", value="false")
                host.call("kvSet", key="config:downloadSpeedLimit", value="65536")
            finally:
                host.close()
        old = launch("legacy", ("--force-desktop", "--profile", profiles[0]))
        phase("legacy-ui")
        quit_and_join(old)
        def old_sidecars_stopped():
            names = subprocess.check_output(["/bin/ps", "-U", str(os.getuid()), "-o", "comm="]).decode()
            return not any(Path(line.strip()).name in LEGACY_BINARIES for line in names.splitlines())
        wait_until(old_sidecars_stopped, seconds=30)
        # Corrupt previously complete content only after the released owner has
        # joined, so migration must discard its persisted completion claim.
        corrupt = root / "payload/corrupt.bin"
        corrupt.write_bytes(bytes([38]) * 16384)
        payload_hashes[str(corrupt)] = digest(corrupt)
        # Simulate a disconnected external/download volume after old GUI Quit.
        (root / "missing-root").rename(root / "missing-offline")
        missing_file = str(root / "missing-root/missing.bin")
        payload_hashes[str(root / "missing-offline/missing.bin")] = payload_hashes.pop(missing_file)
        before = source_snapshot()
        (root / "source-before.json").write_text(json.dumps(before, indent=2))
        shutil.rmtree(app)
        shutil.copytree(new_app, app)
        idle_log = (root / "idle-host.log").open("wb")
        logs.append(idle_log)
        idle = subprocess.Popen([str(old_app / "Contents/MacOS/jstorrent-host"), "--launcher", "tauri"],
                                stdin=subprocess.PIPE, stdout=idle_log, stderr=idle_log)
        children.append(idle)
        time.sleep(1)
        assert idle.poll() is None and source_snapshot() == before
        blocked = launch("idle-blocked")
        phase("idle-host-blocked")
        wait_until(lambda: blocked.poll() is not None)
        assert not (product / "profile").exists() and source_snapshot() == before
        results["checks"].append("pre-handshake-host-blocks-before-catalog")
        idle.stdin.close()
        assert idle.wait(timeout=20) == 0
        # Force one released browser-family registration failure before import.
        failure = support / "Arc/User Data/NativeMessagingHosts"
        if failure.exists():
            shutil.rmtree(failure)
        failure.write_text("controlled registration failure")
        blocked = launch("registration-blocked")
        phase("registration-blocked")
        wait_until(lambda: blocked.poll() is not None)
        assert not (product / "profile").exists() and source_snapshot() == before
        failure.unlink()
        results["checks"].append("registration-failure-blocks-before-catalog")
        if args.trial_installation_id:
            shutil.rmtree(app)
            shutil.copytree(old_app, app)
            wanted_binary = digest(new_app / "Contents/MacOS" / args.candidate_executable)
            def installed():
                binary = app / "Contents/MacOS" / args.candidate_executable
                return binary.exists() and digest(binary) == wanted_binary
            args.rehearsal_profile = profiles[0]
            phase("ready-for-signed-update")
            wait_until(lambda: (root / "allow-update").is_file(), seconds=1800)
            migrated = check_and_apply(args, native, app, launch, wait_until, phase, installed, results)
        else:
            migrated = launch("migrated")
        wait_until(lambda: (product / "profile/session.db").exists())
        phase("migrated")
        # Probe every installed legacy manifest's real executable route.
        for browser in BROWSERS:
            manifest = json.loads((support / browser / "NativeMessagingHosts/com.jstorrent.native.json").read_text())
            assert manifest["name"] == "com.jstorrent.native"
            body = json.dumps(dict(id="probe", op="handshake")).encode()
            reply = subprocess.run([manifest["path"], manifest["allowed_origins"][0]],
                                   input=len(body).to_bytes(4, "little") + body,
                                   capture_output=True, check=True, timeout=10)
            assert len(reply.stdout) == 4 + int.from_bytes(reply.stdout[:4], "little")
            result = json.loads(reply.stdout[4:])
            assert set(result) == {"id", "ok", "error", "type"}
            assert result["id"] == "probe" and result["ok"] is False and result["type"] == "Empty"
            assert "Update the JSTorrent extension" in result["error"]
        if args.trial_installation_id:
            wait_until(lambda: not owned_pids(app), seconds=600)
            migrated.wait(timeout=15)
        else:
            quit_and_join(migrated)
        identities = check_catalog()
        assert identities, "ordinary checker did not finish valid/corrupt work"
        handoff_source = source_snapshot()
        if args.trial_gui:
            assert_gui_source(before, handoff_source, profiles[0])
            results["sourceVerification"] = "GUI logical values and inactive bytes; all bytes across successor restart"
        else:
            assert handoff_source == before
        restarted = launch("restarted")
        wait_until(lambda: restarted.poll() is None and (product / "profile/session.db").exists())
        phase("restarted")
        quit_and_join(restarted)
        assert check_catalog(identities)
        after = source_snapshot()
        (root / "source-after.json").write_text(json.dumps(after, indent=2))
        assert after == handoff_source
        assert all(digest(Path(path)) == sha for path, sha in payload_hashes.items())
        assert not (root / "missing-root").exists()
        results["checks"] += ["four-record-import-and-paused-intent", "valid-and-corrupt-reverification",
                              "missing-root-not-created", "nine-registered-refusal-routes",
                              "restart-identities-and-single-marker", "source-and-payload-preserved"]
        results["imported"] = 4
        results["status"] = "passed"
    except BaseException:
        results["status"] = "failed"
        raise
    finally:
        if args.trial_installation_id:
            stop_owned(app)
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            if child.stdin is not None and not child.stdin.closed:
                child.stdin.close()
        for log in logs:
            log.close()
        for path, backup, existed in reversed(saved):
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            elif path.exists() or path.is_symlink():
                path.unlink()
            if existed:
                path.parent.mkdir(parents=True, exist_ok=True)
                backup.rename(path)
        for path in reversed(created_dirs):
            if path.exists():
                path.rmdir()
        (root / "result.json").write_text(json.dumps(results, indent=2) + "\n")
        phase("finished")
    print(json.dumps(results))


if __name__ == "__main__":
    # Controller cancellation still executes restoration.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()

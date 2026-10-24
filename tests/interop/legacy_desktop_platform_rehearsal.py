#!/usr/bin/env python3
"""Installed Windows/Linux legacy replacement, ONLY in a claimed test guest.

Run this Python driver through Machine Control's interactive-session launch.
Use native Quit at legacy-ui/migrated/restarted and dismiss the startup errors
at idle-host-blocked/registration-blocked. phase.json/result.json are bounded
coordination/evidence files. No browser, public swarm or personal data is used.
Windows requires pinned NSIS installers; Linux requires pinned AppImages and
uses their supported extract-and-run route (no guest FUSE package change).
"""
import argparse
import base64
import csv
import hashlib
import json
import os
import pickle
import platform as host_platform
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import traceback

from desktop_updates.registry_windows import Registry
from legacy_desktop_signed_update import assert_gui_source, check_and_apply, owned_pids, stop_owned
from legacy_desktop_fixture_cohort import Host, digest, BINARIES
from legacy_desktop_replacement_rehearsal import bencode, closed_copy, wait_until

PACKAGES = {
    "windows": "55ce6c119e3ada6b66da3f706e4659aa50f0550fea84d56757ba7180f51047c3",
    "linux": "1c35bb7dd5bdefcd780c19fc09e160dc7b0e6a5a2ada35f07007089d85e180df",
}
# AppImage helpers differ from the deb helpers pinned by the fixture cohort.
APPIMAGE_BINARIES = (
    "e7b93708c0c9f9218a2402efae373ce5c56b9d00463ae5c7944bbad15e9dfd63",
    "eaf386835af15b140ff5f9c91680af198554cf9deb9480e571ed60ad2bf8bce1",
)
ARM_APPIMAGE_PACKAGE = "5c74f3f7f0f375a0eb17b3e5f2da171a07c8fdc45948b3b46489e9cb87d446ae"
ARM_APPIMAGE_BINARIES = (
    "7bfd7ee516933119d830f678db38bd66095eec9c8d848021751422d14b165bc8",
    "25b424417aeadd1b7d6b85696988953cdb7804263e1cc668174a7b9dec18f33d",
)


def linux_legacy_pins(architecture):
    if architecture in ("x86_64", "amd64"):
        return PACKAGES["linux"], APPIMAGE_BINARIES
    if architecture in ("aarch64", "arm64"):
        return ARM_APPIMAGE_PACKAGE, ARM_APPIMAGE_BINARIES
    raise ValueError("unsupported native Linux rehearsal architecture")


def inspect_debian_candidate(platform, architecture, updater_trial, package):
    """Read the trusted package's architecture before changing guest state."""
    if platform != "linux":
        raise ValueError("Debian comparison requires native Linux")
    if updater_trial:
        raise ValueError("extracted Debian comparison cannot qualify updater trials")
    expected = {"aarch64": "arm64", "arm64": "arm64",
                "x86_64": "amd64", "amd64": "amd64"}.get(architecture)
    if expected is None:
        raise ValueError("unsupported native Linux rehearsal architecture")
    actual = subprocess.check_output(
        ["dpkg-deb", "--field", str(package), "Architecture"],
        text=True, timeout=15,
    ).strip()
    if actual != expected:
        raise ValueError("Debian package architecture does not match native guest")
    return actual
BROWSERS = ("google-chrome", "google-chrome-for-testing", "chromium",
            "BraveSoftware/Brave-Browser", "microsoft-edge")
WIN_BROWSERS = (r"Google\Chrome", "Chromium", r"BraveSoftware\Brave-Browser", r"Microsoft\Edge")


def process_names():
    if os.name == "nt":
        user = os.environ["USERDOMAIN"] + "\\" + os.environ["USERNAME"]
        output = subprocess.check_output(["tasklist.exe", "/FO", "CSV", "/NH",
                                          "/FI", "USERNAME eq " + user], timeout=10)
        return [row[0].lower().removesuffix(".exe") for row in
                csv.reader(output.decode().splitlines()) if len(row) == 5]
    output = subprocess.check_output(["/bin/ps", "-U", str(os.getuid()), "-o", "comm="], timeout=10)
    return [Path(line.strip()).name.lower() for line in output.decode().splitlines()]


def old_running():
    names = {"jstorrent", "jstorrent.exe", "jstorrent-desktop", "jstorrent-deskt",
             "jstorrent-host", "jstorrent-io-daemon", "jstorrent-io-da"}
    return bool(names.intersection(process_names()))




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
    parser.add_argument("--linux-candidate-format", choices=("appimage", "deb"),
                        default="appimage",
                        help="deb is an extracted native-payload comparison, not an installed update")
    parser.add_argument("--trial-installation-id", type=Path,
                        help="Use the released HTTPS updater instead of manual replacement")
    parser.add_argument("--trial-gui", action="store_true")
    parser.add_argument("--trial-negative", choices=("wrong-signature", "interrupted"))
    args = parser.parse_args()
    assert not (args.trial_gui or args.trial_negative) or args.trial_installation_id
    platform = "windows" if os.name == "nt" else "linux" if sys.platform == "linux" else None
    if platform is None or not args.root.is_absolute() or args.root.exists():
        parser.error("requires Windows/Linux and a new absolute controlled root")
    architecture = host_platform.machine().lower()
    legacy_package, binary_pins = (
        linux_legacy_pins(architecture) if platform == "linux"
        else (PACKAGES["windows"], BINARIES["windows"])
    )
    assert digest(args.legacy) == legacy_package
    assert digest(args.candidate) == args.candidate_sha256
    candidate_architecture = None
    if args.linux_candidate_format == "deb":
        candidate_architecture = inspect_debian_candidate(
            platform, architecture, bool(args.trial_installation_id), args.candidate)
    assert not old_running() and not {"rstorrent-desktop", "rstorrent-deskt", "jstorrent-client", "jstorrent-clien"}.intersection(process_names())
    args.root.mkdir(parents=True)
    sys.stdout = sys.stderr = (args.root / "driver.log").open("w", encoding="utf-8", buffering=1)
    root, home = args.root, Path.home()
    if platform == "windows":
        config, data = Path(os.environ["APPDATA"]), Path(os.environ["APPDATA"])
        local = Path(os.environ["LOCALAPPDATA"])
        app = local / "Programs/JSTorrent"
        scopes = (app, local / "JSTorrent", config / "jstorrent-native", config / "com.jstorrent.desktop",
                  local / "com.jstorrent.desktop",
                  config / "Microsoft/Windows/Start Menu/Programs/JSTorrent.lnk",
                  home / "Desktop/JSTorrent.lnk")
    else:
        # Match the product's standard config/data discovery, never redirect it.
        assert not os.environ.get("XDG_CONFIG_HOME") and not os.environ.get("XDG_DATA_HOME")
        config, data = home / ".config", home / ".local/share"
        app = home / "Applications/JSTorrent.AppImage"
        scopes = (app, config / "jstorrent-native", config / "com.jstorrent.desktop",
                  data / "com.jstorrent.desktop", home / ".local/lib/jstorrent")
    native, product = config / "jstorrent-native", data / "com.jstorrent.desktop"
    children, logs, saved, created = [], [], [], []
    registry = None
    results = {"platform": platform, "hostArchitecture": architecture,
               "legacyPackageSha256": legacy_package,
               "candidatePackageSha256": args.candidate_sha256, "checks": []}
    if candidate_architecture:
        results.update(candidateFormat="deb_extracted_native_payload",
                       candidateArchitecture=candidate_architecture,
                       packageManagerInstallation="unrun")

    def phase(name):
        (root / "phase.json").write_text(json.dumps({"phase": name, "pid": os.getpid()}), encoding="utf-8")

    def receipt():
        # Task-only recovery evidence, retained until restoration is verified.
        state = dict(saved=[(str(path), str(backup), existed) for path, backup, existed in saved],
                     created=[str(path) for path in created])
        pending = root / "restoration.pending"
        pending.write_text(json.dumps(state, indent=2), encoding="utf-8")
        pending.replace(root / "restoration.json")

    def preserve(path):
        backup = root / "inherited" / str(len(saved))
        backup.parent.mkdir(exist_ok=True)
        existed = path.exists() or path.is_symlink()
        saved.append((path, backup, existed))
        receipt()
        if existed:
            path.rename(backup)

    def ensure_dir(path):
        if not path.exists():
            ensure_dir(path.parent)
            created.append(path)
            receipt()
            path.mkdir()

    def install(package):
        if platform == "linux" and package == args.candidate and candidate_architecture:
            destination = root / "debian-candidate"
            subprocess.run(["dpkg-deb", "--extract", str(package), str(destination)],
                           check=True, timeout=60)
            for name in (args.candidate_executable, "rstorrent-native-host"):
                binary = destination / "usr/bin" / name
                assert binary.is_file() and not binary.is_symlink()
                results.setdefault("debianBinaries", {})[name] = digest(binary)
            return
        ensure_dir(app.parent)
        if platform == "windows":
            # /D must be the final NSIS argument, without embedded quotes.
            reply = subprocess.run([str(package), "/S", "/D=" + str(app)], timeout=120)
            assert reply.returncode == 0, "NSIS install failed"
        else:
            shutil.copyfile(package, app)
            app.chmod(0o700)
        assert app.exists()

    def launch(name, arguments=()):
        log = (root / (name + ".log")).open("wb")
        logs.append(log)
        if platform == "windows":
            binary = app / ("jstorrent-desktop.exe" if name == "legacy" else args.candidate_executable + ".exe")
            command = [str(binary), *arguments]
        elif candidate_architecture and name != "legacy":
            command = [str(root / "debian-candidate/usr/bin" / args.candidate_executable), *arguments]
        else:
            command = [str(app), "--appimage-extract-and-run", *arguments]
        environment = dict(os.environ)
        if platform == "linux" and not (candidate_architecture and name != "legacy"):
            # Tauri's restart retains the environment, not AppImage's consumed
            # runtime flag. Keep the same supported no-FUSE route on relaunch.
            environment["APPIMAGE_EXTRACT_AND_RUN"] = "1"
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                 start_new_session=platform == "linux", env=environment)
        children.append(child)
        return child

    def joined(child, success=True):
        wait_until(lambda: child.poll() is not None, seconds=600)
        if success:
            assert child.wait() == 0, "native Quit failed"

    def snapshot():
        result = {"discovery": digest(native / "rpc-info.json"), "profiles": {}, "files": {}}
        for db in sorted(native.glob("profiles/*/data.db")):
            with closed_copy(db, root) as source:
                result["profiles"][db.parent.name] = dict(source.execute("SELECT key,value FROM kv"))
            for suffix in ("", "-wal"):
                path = db.with_name(db.name + suffix)
                if path.exists() and (suffix != "-wal" or path.stat().st_size > 0):
                    # Source guards use a portable profile prefix on every OS.
                    result["files"][path.relative_to(native).as_posix()] = digest(path)
        return result

    def catalog(previous=None):
        with closed_copy(product / "profile/session.db", root) as connection:
            connection.row_factory = sqlite3.Row
            reports = list(connection.execute("SELECT report_json FROM legacy_desktop_import"))
            assert len(reports) == 1
            report = json.loads(reports[0][0])
            settings = connection.execute("SELECT dht_enabled, peer_exchange_enabled, peer_connection_limit, upload_slots, download_rate_limit FROM client_settings").fetchone()
            assert tuple(settings) == (0, 0, 73, 5, 65536), "supported settings did not migrate"
            assert (report["imported"], report["skipped"], report["already_present"]) == (4, 0, 0)
            rows = list(connection.execute("SELECT t.*, lower(hex(i.full_hash)) AS identity FROM torrents t JOIN torrent_identities i USING(torrent_id)"))
            assert len(rows) == 4 and all(row["desired_state"] == "paused" for row in rows)
            ids = {row["identity"]: bytes(row["torrent_id"]).hex() for row in rows}
            assert set(ids) == set(expected) and (previous is None or ids == previous)
            for row in rows:
                kind = expected[row["identity"]]
                if kind == "magnet":
                    assert row["raw_info"] is None and row["have_state"] is None
                    continue
                have = bytes(row["have_state"])
                assert have[:10] == b"RSTHAVE\0\0\x02" and len(have) == 63
                assert have[10:26] == bytes(row["torrent_id"]) and int.from_bytes(have[58:62], "big") == 1
                assert have[62] == (128 if kind == "good" else 0)
                if kind != "missing":
                    assert row["verification_requested"] == row["verification_completed"] > 0
            return ids

    def remove_scope(path):
        # WebView2 can release its owned profile handles shortly after native
        # Quit. Retry only this preserved scope, with a fixed cleanup deadline.
        deadline = time.monotonic() + 30
        while True:
            try:
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                elif path.exists() or path.is_symlink():
                    path.unlink()
                return
            except PermissionError:
                if platform != "windows" or time.monotonic() >= deadline:
                    raise
                time.sleep(0.25)

    expected, payload_hashes, profiles = {}, {}, []
    try:
        if platform == "windows":
            registry = Registry()
            # Binary registry values require a binary receipt. Never load this
            # private pickle from an untrusted source; it is operator recovery.
            with (root / "registry-before.pickle").open("wb") as saved_registry:
                pickle.dump((registry.saved, registry.parents), saved_registry)
            command = "Get-NetFirewallRule | Select-Object -ExpandProperty Name | ConvertTo-Json"
            firewall = subprocess.check_output(["powershell.exe", "-NoProfile", "-Command", command], timeout=30)
            (root / "firewall-before.json").write_bytes(firewall)
        for path in scopes:
            preserve(path)
        if registry:
            registry.isolate_installation()
        if platform == "linux":
            for browser in BROWSERS:
                directory = config / browser
                ensure_dir(directory)
                preserve(directory / "NativeMessagingHosts")
        install(args.legacy)
        # Extract only to obtain the exact released host for pre-handshake and
        # fixture writes. Normal GUI execution still uses the installed package.
        if platform == "linux":
            old_tree = root / "old"
            old_tree.mkdir()
            subprocess.run([str(app), "--appimage-extract"], cwd=old_tree,
                           stdout=subprocess.DEVNULL, check=True, timeout=60)
            old_bin = old_tree / "squashfs-root/usr/bin"
            host_path = old_bin / "jstorrent-host"
        else:
            old_bin = root / "old"
            old_bin.mkdir()
            for source in app.glob("jstorrent-*.exe"):
                shutil.copy2(source, old_bin / source.name)
            host_path = next(old_bin.glob("jstorrent-host*.exe"))
        assert digest(host_path) == binary_pins[0]
        daemon = next(old_bin.glob("jstorrent-io-daemon*"))
        assert digest(daemon) == binary_pins[1]
        results["legacyBinaries"] = binary_pins
        for kinds in (("good", "corrupt", "magnet"), ("missing",)):
            payload = root / ("missing-root" if kinds == ("missing",) else "payload")
            payload.mkdir()
            host = Host(host_path, config, root / (kinds[0] + ".host.log"))
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
                    state = dict(userState="stopped", storageKey=storage, uploaded=0, downloaded=0, updatedAt=1)
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
        joined(old)
        wait_until(lambda: not old_running(), seconds=30)
        corrupt = root / "payload/corrupt.bin"
        corrupt.write_bytes(bytes([38]) * 16384)
        payload_hashes[str(corrupt)] = digest(corrupt)
        (root / "missing-root").rename(root / "missing-offline")
        payload_hashes[str(root / "missing-offline/missing.bin")] = payload_hashes.pop(str(root / "missing-root/missing.bin"))
        before = snapshot()
        (root / "source-before.json").write_text(json.dumps(before, indent=2), encoding="utf-8")
        install(args.candidate)
        idle_log = (root / "idle-host.log").open("wb")
        logs.append(idle_log)
        idle = subprocess.Popen([str(host_path), "--launcher", "tauri"], stdin=subprocess.PIPE,
                                stdout=idle_log, stderr=idle_log,
                                start_new_session=platform == "linux")
        children.append(idle)
        time.sleep(1)
        assert idle.poll() is None and snapshot() == before
        blocked = launch("idle-blocked")
        phase("idle-host-blocked")
        joined(blocked, False)
        assert not (product / "profile").exists() and snapshot() == before
        results["checks"].append("pre-handshake-host-blocks-before-catalog")
        idle.stdin.close()
        assert idle.wait(timeout=20) == 0
        # Deterministic filesystem failure covers registration ordering on both
        # platforms; Windows also independently probes every registry route.
        failure = config / "com.jstorrent.desktop/native-host"
        if failure.exists():
            shutil.rmtree(failure)
        failure.write_text("controlled registration failure", encoding="utf-8")
        blocked = launch("registration-blocked")
        phase("registration-blocked")
        joined(blocked, False)
        assert not (product / "profile").exists() and snapshot() == before
        failure.unlink()
        results["checks"].append("registration-failure-blocks-before-catalog")
        if args.trial_installation_id:
            wanted_binary = digest(app / (args.candidate_executable + ".exe")) if platform == "windows" else None
            install(args.legacy)
            def installed():
                if platform == "linux":
                    return (app.exists() and app.stat().st_size == args.candidate.stat().st_size
                            and digest(app) == args.candidate_sha256)
                binary = app / (args.candidate_executable + ".exe")
                return (binary.exists() and digest(binary) == wanted_binary
                        and not (app / "jstorrent-desktop.exe").exists())
            args.rehearsal_profile = profiles[0]
            phase("ready-for-signed-update")
            wait_until(lambda: (root / "allow-update").is_file(), seconds=1800)
            migrated = check_and_apply(args, native, app, launch, wait_until, phase, installed, results)
        else:
            migrated = launch("migrated")
        wait_until(lambda: (product / "profile/session.db").exists())
        phase("migrated")
        manifests = list(registry.manifests()) if registry else [
            config / browser / "NativeMessagingHosts/com.jstorrent.native.json" for browser in BROWSERS]
        paths = []
        for path in manifests:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            assert manifest["name"] == "com.jstorrent.native"
            paths.append((manifest["path"], manifest["allowed_origins"][0]))
        if platform == "linux":
            paths.append((str(home / ".local/lib/jstorrent/jstorrent-host"), paths[0][1]))
        for binary, origin in paths:
            body = json.dumps(dict(id="probe", op="handshake")).encode()
            reply = subprocess.run([binary, origin], input=len(body).to_bytes(4, "little") + body,
                                   capture_output=True, check=True, timeout=10)
            assert len(reply.stdout) == 4 + int.from_bytes(reply.stdout[:4], "little")
            result = json.loads(reply.stdout[4:])
            assert set(result) == {"id", "ok", "error", "type"}
            assert result["id"] == "probe" and result["ok"] is False and result["type"] == "Empty"
            assert "Update the JSTorrent extension" in result["error"]
        results["refusalRoutes"] = len(paths)
        if args.trial_installation_id:
            wait_until(lambda: not owned_pids(app), seconds=600)
            migrated.wait(timeout=15)
        else:
            joined(migrated)
        identities = catalog()
        handoff_source = snapshot()
        (root / "source-handoff.json").write_text(json.dumps(handoff_source, indent=2), encoding="utf-8")
        if args.trial_gui:
            assert_gui_source(before, handoff_source, profiles[0])
            results["sourceVerification"] = "GUI logical values and inactive bytes; all bytes across successor restart"
        else:
            assert handoff_source == before
        restarted = launch("restarted")
        time.sleep(2)
        assert restarted.poll() is None
        phase("restarted")
        joined(restarted)
        assert catalog(identities)
        after = snapshot()
        (root / "source-after.json").write_text(json.dumps(after, indent=2), encoding="utf-8")
        assert after == handoff_source
        assert all(digest(Path(path)) == sha for path, sha in payload_hashes.items())
        assert not (root / "missing-root").exists()
        results["checks"] += ["four-record-import-and-paused-intent", "valid-and-corrupt-reverification",
                              "missing-root-not-created", "installed-refusal-routes",
                              "restart-identities-and-single-marker", "source-and-payload-preserved"]
        results.update(imported=4, status="passed")
    except BaseException:
        results.update(status="failed", error=traceback.format_exc())
        (root / "result.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        raise
    finally:
        phase("restoring")
        print("Restoring owned children, files and registry", flush=True)
        if args.trial_installation_id:
            stop_owned(app)
            if platform == "windows":
                stop_owned(local / "JSTorrent")
        for child in reversed(children):
            if child.poll() is None:
                if platform == "linux":
                    os.killpg(child.pid, signal.SIGTERM)
                else:
                    subprocess.run(["taskkill.exe", "/PID", str(child.pid), "/T", "/F"],
                                   capture_output=True, timeout=15)
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    if platform == "linux":
                        os.killpg(child.pid, signal.SIGKILL)
                    else:
                        child.kill()
                    child.wait(timeout=5)
            if child.stdin is not None and not child.stdin.closed:
                child.stdin.close()
        for log in logs:
            log.close()
        for path, backup, existed in reversed(saved):
            remove_scope(path)
            if existed:
                path.parent.mkdir(parents=True, exist_ok=True)
                backup.rename(path)
        if registry:
            print("Restoring registry", flush=True)
            registry.restore()
        for path in reversed(created):
            if path.exists():
                path.rmdir()
        results["restoration"] = "passed"
        (root / "result.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
        phase("finished")
    print(json.dumps(results))


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()

"""Ordinary released-app writers and bounded loopback transfer for upgrade tests."""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

PACKAGE = "com.jstorrent.app"
ACTIVITY = PACKAGE + "/com.jstorrent.app.NativeStandaloneActivity"
FOLDERS = ("JSTorrentWriterA", "JSTorrentWriterB")


class WriterOracle:
    def __init__(self, directory: Path):
        sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tests/interop"))
        import libtorrent as lt
        from first_verified_piece import create_session, wait_for_listener, add_seed
        self.lt = lt
        self.session = create_session()
        self.seed_port = wait_for_listener(self.session, [])
        self.session.apply_settings({"upload_rate_limit": 64 * 1024, "ignore_limits_on_local_network": False, "alert_mask": int(lt.alert.category_t.all_categories), "in_enc_policy": int(lt.enc_policy.disabled), "out_enc_policy": int(lt.enc_policy.disabled)})
        self.cases = []
        self.handles = []
        self.tracker_requests = []
        oracle = self

        class Handler(BaseHTTPRequestHandler):
            # A normal length-delimited HTTP/1.1 response avoids an immediate
            # server EOF racing the released companion's buffered socket data.
            protocol_version = "HTTP/1.1"
            timeout = 5

            def do_GET(self):
                oracle.tracker_requests.append({"path": self.path.split("?", 1)[0], "peer": self.client_address[0], "connection": self.headers.get("Connection")})
                del oracle.tracker_requests[:-32]
                peers = struct.pack("!4BH", 127, 0, 0, 1, oracle.seed_port)
                body = lt.bencode({b"interval": 2, b"complete": 1, b"incomplete": 0, b"peers": peers})
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
                # The released companion batches socket data separately from
                # EOF. Give those bytes a bounded drain window before honoring
                # its Connection: close; this is only the local test fixture.
                time.sleep(0.1)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, name="legacy-writer-tracker")
        self.thread.start()
        try:
            for index, size in enumerate((256 * 1024, 4 * 1024 * 1024)):
                name = f"writer-{index}.bin"
                seed = directory / f"writer-seed-{index}"
                seed.mkdir()
                payload = bytes((part * 17 + index) % 251 for part in range(size))
                (seed / name).write_bytes(payload)
                files = lt.file_storage()
                files.add_file(name, size)
                creator = lt.create_torrent(files, piece_size=16384, flags=lt.create_torrent.v1_only)
                creator.set_priv(True)
                creator.add_tracker(f"http://127.0.0.1:{self.server.server_port}/announce")
                lt.set_piece_hashes(creator, str(seed))
                torrent = directory / f"writer-{index}.torrent"
                torrent.write_bytes(bytes(lt.bencode(creator.generate())))
                info = lt.torrent_info(str(torrent))
                # The seed must not announce to a tracker which returns itself:
                # libtorrent would self-connect and ban the shared loopback IP.
                seed_info = lt.torrent_info({b"info": creator.generate()[b"info"]})
                assert seed_info.info_hashes().v1 == info.info_hashes().v1
                self.handles.append(add_seed(self.session, seed_info, seed, []))
                self.cases.append({"name": name, "hash": str(info.info_hashes().v1), "sha256": hashlib.sha256(payload).hexdigest(), "size": size, "pieces": info.num_pieces(), "folder": FOLDERS[index]})
        except BaseException:
            self.close()
            raise

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            raise RuntimeError("legacy writer tracker did not terminate")
        for handle in self.handles:
            self.session.remove_torrent(handle)
        self.handles.clear()
        self.session.pause()
        self.session = None

    def release_rate_limit(self):
        self.session.apply_settings({"upload_rate_limit": 0})


def click(target, probe, label, *, scroll=False, timeout=30):
    deadline = time.monotonic() + timeout
    last = []
    while time.monotonic() < deadline:
        nodes = probe.ui_nodes(target)
        matched = [n for n in nodes if label in n.attrib.get("text", "").splitlines() or n.attrib.get("text", "").startswith(label + " (") or n.attrib.get("content-desc") == label]
        actual_labels = [n.attrib.get("text") or n.attrib.get("content-desc") for n in matched]
        if probe.click_from_nodes(target, matched, actual_labels):
            time.sleep(0.3)
            return
        last = [n.attrib.get("text") or n.attrib.get("content-desc") for n in nodes]
        if scroll:
            target.shell(["input", "swipe", "500", "400" if scroll == "up" else "1100", "500", "1100" if scroll == "up" else "400", "350"])
        time.sleep(0.3)
    raise RuntimeError(f"legacy UI control {label!r} missing: {last}")


def set_toggle(target, probe, label, desired):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        nodes = probe.ui_nodes(target)
        for row in reversed(nodes):
            if any(label in n.attrib.get("text", "").splitlines() for n in row.iter()):
                controls = [n for n in row.iter() if n.attrib.get("checkable") == "true"]
                if len(controls) == 1:
                    control = controls[0]
                    if (control.attrib.get("checked") == "true") != desired:
                        x, y = probe.parse_bounds(control.attrib["bounds"])
                        target.shell(["input", "tap", str(x), str(y)])
                        time.sleep(0.3)
                    return
        target.shell(["input", "swipe", "500", "1100", "500", "400", "350"])
    raise RuntimeError(f"legacy toggle state unavailable: {label}: " + repr([(n.attrib.get("text"), n.attrib.get("checked"), n.attrib.get("checkable")) for n in nodes]))


def wait_hash(target, remote, expected, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        output = target.shell(["sha256sum", remote], check=False).stdout
        if output.split()[:1] == [expected]:
            return
        time.sleep(0.5)
    raise RuntimeError(f"ordinary legacy download did not complete: {remote}")


def prepare(target, probe, directory, oracle):
    for port in (oracle.seed_port, oracle.server.server_port):
        target.run(["reverse", f"tcp:{port}", f"tcp:{port}"])
    target.shell(["pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS"], check=False)
    for folder in FOLDERS:
        print(f"ordinary_writer phase=grant folder={folder}", flush=True)
        target.shell(["mkdir", "-p", f"/sdcard/Download/JSTorrent/{folder}"])
        target.shell(["logcat", "-c"])
        started = target.shell(["am", "start", "-W", "-n", PACKAGE + "/com.jstorrent.app.AddRootActivity"])
        print("ordinary_writer root_activity=" + started.stdout.strip(), flush=True)
        try:
            probe.automate_tree_grant(target, "internal", folder)
        except BaseException:
            print([(n.attrib.get("text"), n.attrib.get("content-desc"), n.attrib.get("resource-id")) for n in probe.ui_nodes(target) if n.attrib.get("text") or n.attrib.get("content-desc")], flush=True)
            raise
        deadline = time.monotonic() + 30
        while "Added root: key=" not in target.shell(["logcat", "-d", "-s", "AddRootActivity:I"]).stdout:
            if time.monotonic() >= deadline:
                raise RuntimeError("released picker did not commit writer root")
            time.sleep(0.25)
    print("ordinary_writer phase=settings", flush=True)
    target.shell(["am", "start", "-W", "-n", ACTIVITY])
    click(target, probe, "Menu")
    click(target, probe, "Settings")
    click(target, probe, "Network & Privacy")
    for label, desired in (("WiFi only", True), ("DHT", False), ("PEX (Peer Exchange)", False), ("UPnP Port Forwarding", False)):
        set_toggle(target, probe, label, desired)
    click(target, probe, "Allow", scroll="up")
    click(target, probe, "Disabled")
    target.shell(["input", "keyevent", "KEYCODE_BACK"])
    target.shell(["input", "keyevent", "KEYCODE_BACK"])
    for index, case in enumerate(oracle.cases):
        print(f"ordinary_writer phase=intake index={index}", flush=True)
        remote = f"/sdcard/Download/JSTorrent/{FOLDERS[0]}/writer-{index}.torrent"
        target.run(["push", str(directory / f"writer-{index}.torrent"), remote])
        tree = "primary:Download/JSTorrent/" + FOLDERS[0]
        document = tree + f"/writer-{index}.torrent"
        uri = "content://com.android.externalstorage.documents/tree/" + quote(tree, safe="") + "/document/" + quote(document, safe="")
        target.shell(["am", "start", "-W", "-n", ACTIVITY, "-a", "android.intent.action.VIEW", "-d", uri, "-t", "application/x-bittorrent"])
        if index == 1:
            click(target, probe, FOLDERS[0])
            click(target, probe, FOLDERS[1])
        click(target, probe, "Download")
        if index == 0:
            wait_hash(target, f"/sdcard/Download/JSTorrent/{case['folder']}/{case['name']}", case["sha256"])
            click(target, probe, "Menu")
            click(target, probe, "Pause All")
        else:
            # Observe actual peer transfer before replacing the running package.
            deadline = time.monotonic() + 60
            while oracle.handles[index].status().total_upload < 16384:
                if time.monotonic() >= deadline:
                    raise RuntimeError("legacy second torrent did not receive a piece")
                time.sleep(0.25)
    # Let the ordinary session writer persist progress and desired-running state.
    time.sleep(3)
    if oracle.handles[1].status().total_upload >= oracle.cases[1]["size"]:
        raise RuntimeError("second download completed before running replacement")
    pid = target.shell(["pidof", PACKAGE]).stdout.strip()
    if not pid:
        raise RuntimeError("old app is not running at replacement")
    package = target.shell(["pm", "list", "packages", "-U", PACKAGE]).stdout
    uid = re.search(r"uid:(\d+)", package)
    if uid is None:
        raise RuntimeError("could not inspect old package UID")
    return {"uid": int(uid.group(1)), "cases": oracle.cases, "old_process_running": True}

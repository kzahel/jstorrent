"""Pinned independent libtorrent peer for the private update rehearsal."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import time

import libtorrent as lt

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("--bind", required=True)
parser.add_argument("--upload-rate", type=int, default=128 * 1024)
parser.add_argument("--duration", type=int, default=1200)
args = parser.parse_args()
if not 1024 <= args.upload_rate <= 1024 * 1024 or not 120 <= args.duration <= 7200:
    raise ValueError("Use bounded transfer rate and duration")
if lt.version != "2.0.13.0" or not ipaddress.ip_address(args.bind).is_private:
    raise ValueError("Use the pinned peer on the private VM network")
root = args.root.resolve()
root.mkdir(mode=0o700)
seed = root / "source"
seed.mkdir()
settings = {"listen_interfaces": args.bind + ":0", "enable_dht": False, "enable_lsd": False,
            "enable_upnp": False, "enable_natpmp": False, "enable_incoming_utp": False,
            "enable_outgoing_utp": False, "connections_limit": 8, "alert_queue_size": 512,
            "ignore_limits_on_local_network": False, "upload_rate_limit": args.upload_rate}
session = lt.session(settings)
sessions = [session]
items = []
handles = []
try:
    for role, size in (("download", 16 * 1024 * 1024), ("seed", 2 * 1024 * 1024), ("paused", 1024 * 1024)):
        name = "update-" + role + ".bin"
        chunk = hashlib.sha256(role.encode()).digest() * 2048
        payload = (chunk * ((size + len(chunk) - 1) // len(chunk)))[:size]
        (seed / name).write_bytes(payload)
        info = {b"length": size, b"name": name.encode(), b"piece length": 65536,
                b"pieces": b"".join(hashlib.sha1(payload[offset:offset + 65536]).digest() for offset in range(0, size, 65536))}
        metainfo = lt.bencode({b"info": info})
        (root / (role + ".torrent")).write_bytes(metainfo)
        parameters = lt.add_torrent_params()
        parameters.ti = lt.torrent_info(metainfo)
        parameters.save_path = str(seed)
        parameters.flags |= lt.torrent_flags.seed_mode
        parameters.flags &= ~(lt.torrent_flags.paused | lt.torrent_flags.auto_managed)
        handles.append(session.add_torrent(parameters))
        items.append({"role": role, "name": name, "hash": hashlib.sha1(lt.bencode(info)).hexdigest(), "sha256": hashlib.sha256(payload).hexdigest(), "pausedSha256": hashlib.sha256(b"paused fixture content").hexdigest()})
    deadline = time.monotonic() + 10
    while not session.is_listening() or not all(handle.status().is_seeding for handle in handles):
        if time.monotonic() >= deadline: raise TimeoutError("Private seed startup")
        session.pop_alerts()
        time.sleep(.05)
    (root / "ready.json").write_text(json.dumps({"peerHost": args.bind, "peerPort": session.listen_port(), "items": items, "libtorrent": lt.version}))
    leech = None
    unthrottled = False
    deadline = time.monotonic() + args.duration
    while time.monotonic() < deadline and not (root / "stop").exists():
        if not unthrottled and (root / "unthrottle").exists():
            session.apply_settings({"upload_rate_limit": 128 * 1024})
            unthrottled = True
        if leech is None and (root / "leech-request.json").exists():
            request = json.loads((root / "leech-request.json").read_text())
            if not ipaddress.ip_address(request["address"]).is_private: raise ValueError("Non-private guest listener")
            receiver = lt.session(dict(settings, upload_rate_limit=0))
            sessions.append(receiver)
            output = root / "received"
            output.mkdir()
            parameters = lt.add_torrent_params()
            parameters.ti = lt.torrent_info(str(root / "seed.torrent"))
            parameters.save_path = str(output)
            parameters.flags &= ~(lt.torrent_flags.paused | lt.torrent_flags.auto_managed)
            leech = receiver.add_torrent(parameters)
            leech.connect_peer((request["address"], request["port"]))
        if leech is not None and leech.status().is_seeding and not (root / "leech-result.json").exists():
            received = hashlib.sha256((root / "received/update-seed.bin").read_bytes()).hexdigest()
            expected = next(item["sha256"] for item in items if item["role"] == "seed")
            if received != expected: raise ValueError("B uploaded incorrect seed content")
            (root / "leech-result.json").write_text(json.dumps({"hashMatches": True, "downloadedBytes": leech.status().total_payload_download, "sha256": received}))
        for owner in sessions: owner.pop_alerts()
        time.sleep(.05)
finally:
    for owner in sessions: owner.pause()

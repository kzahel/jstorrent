"""Controlled transfer assertions across the actual desktop process gap."""
import hashlib
import json
from pathlib import Path
import socket
import time
import uuid


class Transfers:
    def __init__(self, root, application):
        self.root = root
        self.application = application
        self.config = json.loads((root / "transfers.json").read_text())

    def command(self, command):
        response = self.application.call({"type": "dispatch", "request": {
            "version": 1, "request_id": "transfers-" + uuid.uuid4().hex, "command": command,
        }})["response"]
        if response.get("status") != "success":
            raise ValueError("Controlled transfer command failed: " + str(response))
        return response["snapshot"]

    def rows(self):
        snapshot = self.command({"type": "snapshot"})
        rows = {row["torrent_id"]: row for row in snapshot["torrents"]}
        if set(rows) != {item["id"] for item in self.config["items"]} | set(self.config.get("existingIds", [])):
            raise ValueError("The update lost or duplicated a controlled torrent")
        return rows

    def start(self):
        if (self.root / "transfer-before.json").exists():
            return
        # No public discovery is enabled. Only the explicit private test peer
        # and a private listener participate in this fixture.
        self.command({"type": "update_client_settings", "patch": {
            "listener": {"type": "fixed_local_network", "port": self.config["listenPort"]},
            "dht_enabled": False, "peer_exchange_enabled": False, "ipv6_enabled": False,
        }})
        for item in self.config["items"]:
            if item["role"] != "paused":
                self.command({"type": "resume", "torrent_id": item["id"]})
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            rows = self.rows()
            seed = next(rows[item["id"]] for item in self.config["items"] if item["role"] == "seed")
            download = next(rows[item["id"]] for item in self.config["items"] if item["role"] == "download")
            if seed["state"] == "complete" and 0 < download["verified_piece_count"] < download["piece_count"]:
                (self.root / "transfer-before.json").write_text(json.dumps(rows))
                return
            time.sleep(.25)
        raise TimeoutError("Controlled seed/partial download did not become ready")

    def finish(self):
        rows = self.rows()
        for item in self.config["items"]:
            if rows[item["id"]]["desired_running"] != (item["role"] != "paused"):
                raise ValueError("Saved transfer intent changed during update")
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
            route.connect((self.config["peerHost"], self.config["peerPort"]))
            address = route.getsockname()[0]
        (self.root / "transfer-b.json").write_text(json.dumps({"address": address, "port": self.config["listenPort"]}))
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            rows = self.rows()
            if all(rows[item["id"]]["state"] == "complete" for item in self.config["items"] if item["role"] != "paused"):
                break
            time.sleep(.25)
        else:
            raise TimeoutError("Download did not resume and finish after B started")
        for item in self.config["items"]:
            payload = self.root / "downloads" / item["name"]
            expected = item["pausedSha256"] if item["role"] == "paused" else item["sha256"]
            if hashlib.sha256(payload.read_bytes()).hexdigest() != expected:
                raise ValueError("Retained/downloaded content changed: " + item["role"])
        (self.root / "transfer-result.json").write_text(json.dumps({"intentPreserved": True, "allHashesMatch": True, "rows": rows}))

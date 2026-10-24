"""Prepare and assert private transfers through the installed product API."""
import argparse
import json
from pathlib import Path
import socket

import guest
from transfers_guest import Transfers

guest.IDENTIFIER = "com.jstorrent.desktop"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "start", "finish"])
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / ".jstorrent-update-test").is_file():
        raise ValueError("An owned test root is required")
    application = guest.Application()
    try:
        transfers = Transfers(root, application)
        if args.action == "prepare":
            if any("id" in item for item in transfers.config["items"]):
                raise ValueError("Refusing to duplicate prepared torrents")
            snapshot = transfers.command({"type": "snapshot"})
            known = {row["torrent_id"] for row in snapshot["torrents"]}
            transfers.config["existingIds"] = sorted(known)
            with socket.socket() as listener:
                listener.bind(("0.0.0.0", 0))
                transfers.config["listenPort"] = listener.getsockname()[1]
            for item in transfers.config["items"]:
                snapshot = transfers.command({"type": "add_magnet", "magnet":
                    "magnet:?xt=urn:btih:" + item["hash"] + "&x.pe=" +
                    transfers.config["peerHost"] + ":" + str(transfers.config["peerPort"]),
                    "storage_root": "qualification-377", "start_content": False,
                    "await_file_selection": False})
                added = {row["torrent_id"] for row in snapshot["torrents"]} - known
                if len(added) != 1:
                    raise ValueError("The private transfer was not added exactly once")
                item["id"] = added.pop()
                known.add(item["id"])
            (root / "transfers.json").write_text(json.dumps(transfers.config, indent=2))
        elif args.action == "start":
            transfers.start()
        else:
            transfers.finish()
        print(json.dumps({"action": args.action, "passed": True}))
    finally:
        application.close()


if __name__ == "__main__":
    main()

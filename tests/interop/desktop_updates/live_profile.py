#!/usr/bin/env python3
"""Prepare an owned populated production-identity VM profile, never user data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import urllib.request
import uuid
import guest

guest.IDENTIFIER = "com.jstorrent.desktop"


def prepare(root, preserve_existing=False):
    config = guest.config_root()
    data = (Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / guest.IDENTIFIER
            if sys.platform.startswith("linux") else config)
    paths = [("config", config)] + ([] if data == config else [("data", data)])
    if any(path.is_symlink() for _, path in paths):
        raise ValueError("Refusing to replace a profile symlink")
    existing = [(name, path) for name, path in paths if path.exists()]
    if existing and not preserve_existing:
        raise ValueError("Production profile already exists; preserve it")
    backup = root / "original-profiles"
    if backup.exists():
        raise ValueError("A preserved profile already belongs to this run")
    if existing:
        backup.mkdir()
        # The caller must first confirm the production app is stopped.
        receipt = [{"original": str(path), "backup": str(backup / name)} for name, path in existing]
        (root / "preserved-profiles.json").write_text(json.dumps(receipt, indent=2))
        for row in receipt:
            shutil.move(row["original"], row["backup"])
    for path in {config, data}:
        path.mkdir(parents=True)
        (path / ".jstorrent-377-owned-profile").write_text(str(root))
    (data / "profile").mkdir()
    shutil.copyfile(root / "session-v26.sqlite", data / "profile/session.db")
    shutil.copyfile(root / "product-v2.sqlite", config / "product.db")
    with sqlite3.connect(data / "profile/session.db") as connection:
        connection.execute("DELETE FROM removal_jobs")
        connection.execute("UPDATE torrents SET desired_state='paused', awaiting_file_selection=0")
        connection.execute("UPDATE client_settings SET dht_enabled=0, peer_exchange_enabled=0, ipv6_enabled=0")
    installation = str(uuid.uuid4())
    with sqlite3.connect(config / "product.db") as connection:
        connection.execute("UPDATE product_state SET installation_id=?, statistics_enabled=1 WHERE singleton=1", (installation,))
    (root / "cohort-installation-id").write_text(installation)
    if os.name != "nt":
        (root / "cohort-installation-id").chmod(0o600)
    receipt = {"ownedProfile": True, "config": str(config), "data": str(data),
               "installationDigest": hashlib.sha256(installation.encode()).hexdigest()}
    (root / "profile-prepared.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


def download(root, url, expected, name):
    if not url.startswith("https://") or "/" in name or "\\" in name or name in (".", ".."):
        raise ValueError("An exact HTTPS asset and plain filename are required")
    destination = root / name
    temporary = root / (name + ".part")
    if destination.exists() or temporary.exists():
        raise ValueError("Refusing to overwrite a qualification input")
    digest = hashlib.sha256()
    size = 0
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open("xb") as output:
            while chunk := response.read(65536):
                size += len(chunk)
                if size > 512 * 1024 * 1024:
                    raise ValueError("Qualification asset exceeds limit")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("Qualification asset differs from its independent digest")
        temporary.rename(destination)
        print(json.dumps({"file": name, "sha256": expected, "size": size}))
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--prepare-owned-profile", action="store_true")
    parser.add_argument("--preserve-existing-profile", action="store_true")
    parser.add_argument("--download", nargs=3, metavar=("HTTPS_URL", "SHA256", "FILENAME"))
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / ".jstorrent-update-test").is_file():
        raise ValueError("An explicit owned test root is required")
    if args.prepare_owned_profile:
        prepare(root, args.preserve_existing_profile)
    if args.download:
        download(root, *args.download)


if __name__ == "__main__":
    main()

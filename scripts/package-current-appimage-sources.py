#!/usr/bin/env python3
"""Bind current locked application sources to exact signed AppImages.

Reuse the hash-bound prior carrier only for unchanged web/native/runtime inputs.
New source identities require explicit reviewed integrity pins. Never publishes.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("source_carrier", ROOT / "scripts/package-appimage-sources.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
MAXIMUM = 2 * 1024 ** 3


def fetched(url, destination, maximum, expected=None, integrity=None):
    if expected is None and integrity is None:
        raise ValueError("Source inputs require exact integrity")
    if not url.startswith("https://"):
        raise ValueError("Source inputs require HTTPS")
    if destination.exists():
        if not destination.is_file() or destination.is_symlink() or destination.stat().st_size > maximum:
            raise ValueError("Invalid source cache input")
        if expected and common.digest(destination) == expected:
            return
        if integrity:
            digest = hashlib.sha512()
            with destination.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            if "sha512-" + base64.b64encode(digest.digest()).decode() == integrity:
                return
        raise ValueError("Source cache input already exists or changed")
    partial = destination.with_suffix(destination.suffix + ".partial")
    digest = hashlib.sha256()
    integrity_hash = hashlib.sha512() if integrity else None
    size = 0
    try:
        with urllib.request.urlopen(url, timeout=120) as response, partial.open("xb") as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > maximum:
                    raise ValueError("Oversized source input")
                digest.update(chunk)
                if integrity_hash:
                    integrity_hash.update(chunk)
                output.write(chunk)
        if expected and digest.hexdigest() != expected:
            raise ValueError("Source input digest differs from reviewed pin")
        if integrity and "sha512-" + base64.b64encode(integrity_hash.digest()).decode() != integrity:
            raise ValueError("Distribution input differs from package-lock integrity")
        partial.rename(destination)
    finally:
        partial.unlink(missing_ok=True)


def web_identity(row):
    resolved = row.get("resolved", "")
    # npm's equivalent spellings of the already reviewed exact public source.
    if resolved.startswith("git+ssh://git@github.com/kzahel/mediabunny.git#"):
        resolved = resolved.replace("git+ssh://git@github.com/", "git+https://github.com/", 1)
    return row.get("version"), resolved, row.get("integrity")


def required_web_inputs(current, prior, pins):
    required = []
    for location, row in current["packages"].items():
        if not location.startswith("node_modules/"):
            continue
        if location in prior["packages"] and web_identity(row) == web_identity(prior["packages"][location]):
            continue
        name = location.rsplit("node_modules/", 1)[1]
        key = name + "@" + row["version"]
        pin = pins.get(key)
        if not pin or (row.get("resolved"), row.get("integrity"), row.get("license")) != (pin["distribution"], pin["integrity"], pin["license"]):
            raise ValueError("Missing reviewed web source input: " + key)
        required.append((key, pin))
    return required


def runtime_binding(image, prior):
    binding = prior["runtime"]
    size, offset = binding["runtimeBytes"], binding["payloadDigestFieldOffset"]
    if not 0 <= offset <= size - 16 or not 0 < size <= 4 * 1024 * 1024:
        raise ValueError("Invalid reviewed runtime bound")
    with image.open("rb") as stream:
        runtime = bytearray(stream.read(size))
    if len(runtime) != size:
        raise ValueError("Truncated outer runtime")
    runtime[offset:offset + 16] = b"\0" * 16
    if hashlib.sha256(runtime).hexdigest() != binding["normalizedRuntimeSha256"]:
        raise ValueError("Outer runtime changed; review original sources before publication")
    return binding


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.source_sha) or args.output.exists():
        raise ValueError("Use an immutable source SHA and fresh output")
    extractor = common.squashfs_extractor()
    pins = json.loads((ROOT / "distribution/appimage-source-inputs.json").read_text())
    if pins["schemaVersion"] != 1:
        raise ValueError("Unknown source input schema")
    release = json.loads((args.release_dir / "release.json").read_text())
    latest = json.loads((args.release_dir / "assets/latest.json").read_text())
    version = latest["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Numeric package version required")
    if (args.release_dir / "private-qualification-source.json").exists():
        raise ValueError("Private synthetic migrations are not shipping source history")
    cohort = args.release_dir / "cohort-candidate.json"
    if cohort.exists():
        identity = json.loads(cohort.read_text())
        if identity["sourceSha"] != args.source_sha or identity["version"] != version:
            raise ValueError("Source does not match the collected native candidate")
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    prior_file = args.cache / "prior-sources.tar.gz"
    fetched(pins["prior"]["url"], prior_file, MAXIMUM, pins["prior"]["sha256"])
    if prior_file.stat().st_size != pins["prior"]["bytes"]:
        raise ValueError("Prior source carrier size changed")
    common.verify_archive(prior_file)
    assets = {row["name"]: row for row in release["assets"]}
    receipt = {"schemaVersion": 2, "sourceSha": args.source_sha, "version": version, "prior": pins["prior"],
               "packagerSha256": common.digest(Path(__file__)), "inputPinsSha256": common.digest(ROOT / "distribution/appimage-source-inputs.json"), "artifacts": [], "newWebSources": [], "nativeSourcePairs": []}
    with tempfile.TemporaryDirectory(prefix="jstorrent-current-sources-") as temporary:
        work = Path(temporary).resolve()
        prior_application = work / "prior-application.tar"
        prior_index = None
        prior_version = re.search(r"/JSTorrent_(\d+\.\d+\.\d+)_AppImage-sources-final\.tar\.gz$", pins["prior"]["url"])
        if not prior_version:
            raise ValueError("Prior carrier requires a versioned source identity")
        prior_root = "JSTorrent-" + prior_version[1] + "-AppImage-sources/"
        with tarfile.open(prior_file, "r|gz") as archive:
            for member in archive:
                if member.name == prior_root + "application.tar":
                    with prior_application.open("xb") as output:
                        shutil.copyfileobj(archive.extractfile(member), output, 1024 * 1024)
                elif member.name == prior_root + "source-index.json":
                    data = archive.extractfile(member).read(4 * 1024 * 1024 + 1)
                    if len(data) > 4 * 1024 * 1024:
                        raise ValueError("Oversized prior source index")
                    prior_index = json.loads(data)
        if not prior_index or not prior_application.exists():
            raise ValueError("Prior carrier is incomplete")
        with tarfile.open(prior_application) as archive:
            old_lock = json.load(archive.extractfile("clients/web/package-lock.json"))
        app = work / "application"
        app.mkdir()
        snapshot = work / "application-original.tar"
        subprocess.run(["git", "archive", "--format=tar", "--output", str(snapshot), args.source_sha], cwd=ROOT, check=True)
        with tarfile.open(snapshot) as archive:
            total = 0
            for member in archive:
                common.safe_name(member.name.rstrip("/"))
                total += member.size
                if not (member.isfile() or member.isdir()) or member.size > 64 * 1024 ** 2 or total > 512 * 1024 ** 2:
                    raise ValueError("Unexpected application source snapshot member")
            archive.extractall(app, filter="data")
        subprocess.run(["node", str(app / "scripts/apply-desktop-nightly-version.mjs"), version], cwd=app, check=True)
        if json.loads((app / "clients/desktop/src-tauri/tauri.conf.json").read_text())["version"] != version:
            raise ValueError("Version overlay did not execute")
        current_lock = json.loads((app / "clients/web/package-lock.json").read_text())
        additions = required_web_inputs(current_lock, old_lock, pins["additionalWebSources"])
        extra_files = []
        for key, pin in additions:
            name = key.replace("/", "__")
            distribution = args.cache / (name + ".tgz")
            fetched(pin["distribution"], distribution, 64 * 1024 ** 2, integrity=pin["integrity"])
            preferred = args.cache / (name + "-preferred.tar.gz")
            fetched(pin["preferred"]["url"], preferred, 64 * 1024 ** 2, pin["preferred"]["sha256"])
            extra_files += [("web-distribution/" + distribution.name, distribution), ("web-preferred/" + preferred.name, preferred)]
            receipt["newWebSources"].append({"package": key, **pin, "distributionSha256": common.digest(distribution)})
        vendor = work / "cargo-vendor"
        config = subprocess.check_output(["cargo", "vendor", "--locked", "--manifest-path", str(app / "Cargo.toml"), str(vendor)], cwd=app, text=True)
        config = config.replace(str(vendor), "../cargo-vendor")
        (app / ".cargo").mkdir(exist_ok=True)
        (app / ".cargo/config.toml").write_text(config)
        empty_home = work / "empty-cargo-home"
        empty_home.mkdir()
        for target in ("x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"):
            subprocess.run(["cargo", "metadata", "--offline", "--locked", "--filter-platform", target, "--format-version", "1"],
                           cwd=app, env={**os.environ, "CARGO_HOME": str(empty_home)}, stdout=subprocess.DEVNULL, check=True)
        receipt["cargoPackages"] = len(list(vendor.iterdir()))
        receipt["offlineMetadataTargets"] = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"]
        prior_pairs = {(row["source_package"], row["source_version"]) for row in prior_index["nativePackages"]}
        pairs = set()
        supplied_pairs = set(prior_pairs)
        receipt["newNativeSources"] = []
        for arch in ("amd64", "aarch64"):
            name = f"JSTorrent_{version}_{arch}.AppImage"
            image = args.release_dir / "assets" / name
            if image.stat().st_size != assets[name]["size"] or "sha256:" + common.digest(image) != assets[name]["digest"]:
                raise ValueError("AppImage differs from collected signed bytes")
            prior = next(row for row in prior_index["artifacts"] if row["name"].endswith("_" + arch + ".AppImage"))
            binding = runtime_binding(image, prior)
            extracted = work / ("native-" + arch)
            common.extract_native_notices(image, extracted, binding["runtimeBytes"], extractor)
            notices = extracted / "usr/share/rstorrent/native-notices"
            manifest = json.loads((notices / "manifest.json").read_text())
            for row in manifest["notices"]:
                if common.digest(extracted / row["path"]) != row["sha256"]:
                    raise ValueError("Packaged native notice changed")
            current_pairs = {(row["source_package"], row["source_version"]) for row in manifest["packages"]}
            missing = current_pairs - supplied_pairs
            for pair in sorted(missing):
                pin = pins.get("additionalNativeSources", {}).get(pair[0] + "@" + pair[1])
                if not pin or (pin["sourcePackage"], pin["sourceVersion"]) != pair or not any(row["filename"].endswith(".dsc") for row in pin["files"]):
                    raise ValueError("Review and supply new exact native source pairs: " + repr(pair))
                folder = pair[0] + "_" + pair[1]
                cache = args.cache / folder
                cache.mkdir(exist_ok=True)
                for row in pin["files"]:
                    common.safe_name(row["filename"])
                    path = cache / row["filename"]
                    fetched(row["url"], path, 512 * 1024 ** 2, row["sha256"])
                    if path.stat().st_size != row["bytes"]:
                        raise ValueError("Pinned native source size changed")
                    extra_files.append(("ubuntu/" + folder + "/" + row["filename"], path))
                receipt["newNativeSources"].append(pin)
                supplied_pairs.add(pair)
            pairs |= current_pairs
            for path in sorted(notices.rglob("*")):
                if path.is_file():
                    extra_files.append(("native/" + arch + "/" + path.relative_to(notices).as_posix(), path))
            receipt["artifacts"].append({"name": name, "sha256": common.digest(image), "bytes": image.stat().st_size, "runtime": binding})
        receipt["nativeSourcePairs"] = [list(pair) for pair in sorted(pairs)]
        snapshot = work / "application.tar"
        with tarfile.open(snapshot, "w", format=tarfile.PAX_FORMAT) as archive:
            for path in sorted(app.rglob("*")):
                if path.is_file():
                    archive.add(path, arcname=path.relative_to(app).as_posix(), recursive=False)
        receipt["applicationArchiveSha256"] = common.digest(snapshot)
        guide = f'''# JSTorrent {version} corresponding sources

Application commit: {args.source_sha}. The ordinary desktop version-stamping
script sets {version}; no synthetic migration is included. Extract application.tar
into a new application directory. cargo-vendor is adjacent to it; its supplied
.cargo/config.toml works offline. Empty-Cargo-home locked metadata passed for
both Linux architectures. This does not claim sealed offline compilation.

reviewed-prior-sources.tar.gz preserves the exact previous public source carrier,
all original terms, preferred web sources, Ubuntu source packages, native patches,
outer-runtime originals and separate rebuild/relink instructions. Extract it
separately and follow its README for native libraries/runtime relinking. The new
source-index.json binds the current exact AppImages to those same source/version
pairs and outer-runtime identities. Current native notices are also supplied.
Current application.tar, cargo-vendor and new web inputs supersede the previous
application/dependency versions; previous material is retained for provenance.

First-party JSTorrent remains MIT. Third-party sources retain their original
licenses, notices and terms. See the original source files and packaged notices.
No original signing key is needed for rebuilding. No binary reproducibility,
comprehensive legal clearance or comprehensive security clearance is claimed.
'''
        files = [("application.tar", snapshot), ("reviewed-prior-sources.tar.gz", prior_file), *extra_files]
        files += [("cargo-vendor/" + p.relative_to(vendor).as_posix(), p) for p in sorted(vendor.rglob("*")) if p.is_file()]
        partial = args.output.with_suffix(args.output.suffix + ".partial")
        checks = {}
        total = 0
        try:
            with tarfile.open(partial, "w:gz", compresslevel=1, format=tarfile.PAX_FORMAT) as archive:
                def add(name, stream, size, mode=0o644):
                    nonlocal total
                    common.safe_name(name)
                    total += size
                    if name in checks or len(checks) >= 200000 or total > 8 * 1024 ** 3:
                        raise ValueError("Source carrier exceeds bounds or contains duplicate members")
                    temporary_member = work / "member"
                    digest = hashlib.sha256()
                    with temporary_member.open("wb") as output:
                        while chunk := stream.read(1024 * 1024):
                            digest.update(chunk)
                            output.write(chunk)
                    if temporary_member.stat().st_size != size:
                        raise ValueError("Source input changed during packaging")
                    info = tarfile.TarInfo(name)
                    info.size, info.mode = size, mode
                    with temporary_member.open("rb") as data:
                        archive.addfile(info, data)
                    checks[name] = digest.hexdigest()
                    if partial.stat().st_size > MAXIMUM:
                        raise ValueError("Compressed source carrier exceeds two GiB")
                for name, path in files:
                    if not path.is_file() or path.is_symlink():
                        raise ValueError("Source input must remain a regular file")
                    with path.open("rb") as data:
                        add(name, data, path.stat().st_size, 0o755 if path.stat().st_mode & 0o111 else 0o644)
                for name, value in (("README.md", guide), ("source-index.json", json.dumps(receipt, indent=2) + "\n")):
                    data = value.encode()
                    add(name, io.BytesIO(data), len(data))
                inventory = "".join(sha + "  " + name + "\n" for name, sha in sorted(checks.items())).encode()
                info = tarfile.TarInfo("SHA256SUMS")
                info.size, info.mode = len(inventory), 0o644
                archive.addfile(info, io.BytesIO(inventory))
            if partial.stat().st_size > MAXIMUM:
                raise ValueError("Compressed source carrier exceeds two GiB")
            receipt["verifiedMembers"] = common.verify_archive(partial)
            partial.rename(args.output)
        finally:
            partial.unlink(missing_ok=True)
    receipt.update(archive=args.output.name, bytes=args.output.stat().st_size, sha256=common.digest(args.output))
    args.output.with_suffix(".json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({key: value for key, value in receipt.items() if key not in ("nativeSourcePairs", "newWebSources")}, indent=2))


if __name__ == "__main__":
    main()

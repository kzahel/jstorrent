#!/usr/bin/env python3
"""Package reviewed source inputs against exact, unmodified AppImages.

This offline tool does not fetch sources, sign binaries or publish releases.
Its inputs must already have undergone the release source review.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or str(path) != name or "\n" in name:
        raise ValueError(f"Unsafe archive path: {name!r}")
    return name


def candidate_version(candidate: dict, source_sha: str, tauri_source: str) -> str:
    version = candidate.get("version")
    if (candidate.get("sourceSha") != source_sha
            or not isinstance(version, str)
            or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version)
            or json.loads(tauri_source).get("version") != version):
        raise ValueError("Candidate source/version mismatch")
    return version


def verify_archive(path: Path) -> int:
    actual = {}
    checks = None
    with tarfile.open(path, "r|*") as archive:
        for member in archive:
            safe_name(member.name)
            if not member.isfile() or member.name in actual:
                raise ValueError("Source carrier must contain unique regular files")
            stream = archive.extractfile(member)
            result = hashlib.sha256()
            if member.name.endswith("/SHA256SUMS") or member.name == "SHA256SUMS":
                data = stream.read()
                checks = (str(PurePosixPath(member.name).parent), data.decode().splitlines())
                result.update(data)
            else:
                while chunk := stream.read(1024 * 1024):
                    result.update(chunk)
            actual[member.name] = result.hexdigest()
    if checks is None:
        raise ValueError("Missing checksum inventory")
    root, lines = checks
    expected = {}
    for line in lines:
        sha, relative = line.split("  ", 1)
        name = safe_name(relative if root == "." else root + "/" + relative)
        if not re.fullmatch(r"[a-f0-9]{64}", sha) or name in expected:
            raise ValueError("Invalid or duplicate checksum entry")
        expected[name] = sha
    checksum_name = "SHA256SUMS" if root == "." else root + "/SHA256SUMS"
    if actual != {**expected, checksum_name: actual[checksum_name]}:
        raise ValueError("Source carrier checksum or member mismatch")
    return len(actual)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--assets", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--source-index", required=True, type=Path)
    parser.add_argument("--source-cache", required=True, type=Path)
    parser.add_argument("--dependency-inputs", required=True, type=Path)
    parser.add_argument("--dependency-sha256", required=True)
    parser.add_argument("--dependency-source-sha", required=True)
    parser.add_argument("--runtime-inputs", required=True, type=Path)
    parser.add_argument("--runtime-sha256", required=True)
    parser.add_argument("--runtime-binding", required=True, type=Path)
    parser.add_argument("--apprun-source", required=True, type=Path)
    parser.add_argument("--apprun-sha256", required=True)
    parser.add_argument("--runtime-relink-script", required=True, type=Path)
    parser.add_argument("--guide", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    for revision in (args.source_sha, args.dependency_source_sha):
        if not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise ValueError("Use full immutable source commits")
    if args.output.exists() or args.output.with_suffix(".partial").exists():
        raise ValueError("Output already exists")
    candidate = json.loads(args.candidate.read_text())
    version = candidate_version(candidate, args.source_sha, subprocess.check_output(
        ["git", "show", f"{args.source_sha}:clients/desktop/src-tauri/tauri.conf.json"],
        text=True))
    if candidate["result"] != "pass_exact_five_target_nonpublishing_collector":
        raise ValueError("Candidate lacks exact artifact verification")
    assets = {asset["name"]: asset for asset in candidate["assets"]}
    for file, sha in ((args.dependency_inputs, args.dependency_sha256),
                      (args.runtime_inputs, args.runtime_sha256)):
        if digest(file) != sha:
            raise ValueError(f"Reviewed input changed: {file.name}")
        verify_archive(file)
    if digest(args.apprun_source) != args.apprun_sha256:
        raise ValueError("Reviewed AppRun source changed")
    for lock in ("Cargo.lock", "clients/web/package-lock.json"):
        current = subprocess.check_output(["git", "show", f"{args.source_sha}:{lock}"])
        prior = subprocess.check_output(["git", "show", f"{args.dependency_source_sha}:{lock}"])
        if current != prior:
            raise ValueError(f"Reused dependency sources do not match {lock}")
    cached = {(r["sourcePackage"], r["sourceVersion"]): r
              for r in json.loads(args.source_index.read_text())["rows"]}
    runtime_bindings = {r["artifact"]: r for r in
                        json.loads(args.runtime_binding.read_text())["artifacts"]}
    root = f"JSTorrent-{version}-AppImage-sources"
    checks = {}
    receipt = {"sourceSha": args.source_sha, "artifacts": [], "nativePackages": [],
               "dependencyLocksIdentical": True, "publiclyDelivered": False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    partial = args.output.with_suffix(".partial")
    with tempfile.TemporaryDirectory(prefix="jstorrent-source-carrier-") as temporary:
        work = Path(temporary)
        with tarfile.open(partial, "w:gz", compresslevel=3) as archive:
            def add_stream(name, stream, size, mode=0o644):
                safe_name(name)
                if name in checks:
                    raise ValueError(f"Duplicate source member: {name}")
                info = tarfile.TarInfo(root + "/" + name)
                info.size, info.mode = size, mode
                # Stage only one member for hashing; never extract untrusted trees.
                staged = work / "member"
                result = hashlib.sha256()
                with staged.open("wb") as output:
                    while chunk := stream.read(1024 * 1024):
                        output.write(chunk)
                        result.update(chunk)
                if staged.stat().st_size != size:
                    raise ValueError("Truncated source member")
                with staged.open("rb") as input_:
                    archive.addfile(info, input_)
                checks[name] = result.hexdigest()

            def add_bytes(name, data):
                add_stream(name, io.BytesIO(data), len(data))

            def add_file(name, file):
                if not file.is_file() or file.is_symlink():
                    raise ValueError(f"Expected regular source file: {file}")
                with file.open("rb") as stream:
                    add_stream(name, stream, file.stat().st_size,
                               0o755 if file.stat().st_mode & 0o111 else 0o644)

            snapshot = work / "application.tar"
            subprocess.run(["git", "archive", "--format=tar", "--output", str(snapshot),
                            args.source_sha], check=True)
            add_file("application.tar", snapshot)
            # Only reviewed reusable dependency inputs; omit the old first-party
            # snapshot and dated execution/provenance documents from that carrier.
            with tarfile.open(args.dependency_inputs, "r|gz") as dependencies:
                for member in dependencies:
                    relative = member.name.split("/", 1)[1]
                    if (relative.startswith(("cargo-vendor/", "web-distribution/", "web-preferred/"))
                            or relative == "cargo-vendor-config.toml"):
                        add_stream(relative, dependencies.extractfile(member), member.size, member.mode)
            pairs = set()
            for arch, name in (("x64", f"JSTorrent_{version}_amd64.AppImage"),
                               ("arm64", f"JSTorrent_{version}_aarch64.AppImage")):
                image = args.assets / name
                asset = assets[name]
                if image.stat().st_size != asset["size"] or "sha256:" + digest(image) != asset["digest"]:
                    raise ValueError("AppImage differs from qualified candidate")
                binding = runtime_bindings[name]
                with image.open("rb") as stream:
                    runtime = bytearray(stream.read(binding["runtimeBytes"]))
                offset = binding["payloadDigestFieldOffset"]
                runtime[offset:offset + 16] = b"\0" * 16
                if hashlib.sha256(runtime).hexdigest() != binding["normalizedRuntimeSha256"]:
                    raise ValueError("Outer runtime differs from reviewed source binding")
                extracted = work / arch
                subprocess.run(["7zz", "x", "-y", "-o" + str(extracted), str(image),
                                "usr/share/rstorrent/native-notices/*"],
                               check=True, capture_output=True, timeout=120)
                notice_root = extracted / "usr/share/rstorrent/native-notices"
                manifest = json.loads((notice_root / "manifest.json").read_text())
                for notice in manifest["notices"]:
                    if digest(extracted / notice["path"]) != notice["sha256"]:
                        raise ValueError("Native notice changed")
                for file in sorted(notice_root.rglob("*")):
                    if file.is_file():
                        add_file("native/" + arch + "/" + file.relative_to(notice_root).as_posix(), file)
                receipt["artifacts"].append({"name": name, "sha256": digest(image),
                                             "bytes": image.stat().st_size,
                                             "runtime": binding,
                                             "nativeComponents": len(manifest["components"])})
                for package in manifest["packages"]:
                    key = package["source_package"], package["source_version"]
                    pairs.add(key)
                    row = cached[key]
                    copyright_text = (extracted / package["copyright"]).read_text()
                    receipt["nativePackages"].append({**package, "architecture": arch,
                        "sourceDirectory": "ubuntu/" + row["folderName"],
                        "notice": "native/" + arch + "/" + str(PurePosixPath(package["copyright"]).relative_to("usr/share/rstorrent/native-notices")),
                        "components": [c["path"] for c in manifest["components"]
                                       if c.get("package") == package["package"]],
                        "sourceFileLicenseLabels": sorted(set(re.findall(r"^License: (.+)$", copyright_text, re.M))),
                        "delivery": "Exact original source, Debian changes and notice supplied; original component terms apply"})
            for pair in sorted(pairs):
                row = cached[pair]
                for entry in [row["descriptor"], *row["files"]]:
                    name = safe_name(entry["filename"])
                    file = args.source_cache / row["folderName"] / name
                    if file.stat().st_size != entry["bytes"] or digest(file) != entry["sha256"]:
                        raise ValueError("Native source differs from reviewed descriptor")
                    add_file("ubuntu/" + row["folderName"] + "/" + name, file)
            with tarfile.open(args.runtime_inputs, "r|gz") as sources:
                for member in sources:
                    if member.name == "sources/type2-runtime-8f39b89.tar.gz":
                        # Keep the patch next to the original recipes too, so
                        # the separately supplied relink script is executable.
                        source = work / "runtime-source.tar.gz"
                        with source.open("wb") as output:
                            stream = sources.extractfile(member)
                            while chunk := stream.read(1024 * 1024):
                                output.write(chunk)
                        add_file("runtime/" + member.name, source)
                        with tarfile.open(source) as runtime_source:
                            patch = runtime_source.getmember("type2-runtime-8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa/patches/libfuse/mount.c.diff")
                            add_stream("runtime/recipes/libfuse/libfuse_mount.c.diff",
                                       runtime_source.extractfile(patch), patch.size)
                    elif member.name.startswith(("sources/", "recipes/", "notices/")):
                        add_stream("runtime/" + member.name, sources.extractfile(member), member.size, member.mode)
            add_file("apprun/AppImageKit-5735cc5.tar.gz", args.apprun_source)
            add_file("runtime/relink.sh", args.runtime_relink_script)
            add_file("README.md", args.guide)
            receipt["nativeSourcePairs"] = len(pairs)
            add_bytes("candidate.json", (json.dumps(candidate, indent=2) + "\n").encode())
            add_bytes("source-index.json", (json.dumps(receipt, indent=2) + "\n").encode())
            inventory = "".join(sha + "  " + name + "\n" for name, sha in sorted(checks.items()))
            info = tarfile.TarInfo(root + "/SHA256SUMS")
            info.size = len(inventory.encode())
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(inventory.encode()))
        verified = verify_archive(partial)
        partial.rename(args.output)
    receipt.update(archive=args.output.name, sha256=digest(args.output),
                   bytes=args.output.stat().st_size, verifiedMembers=verified,
                   temporaryExtractionRemoved=not work.exists())
    args.output.with_suffix(".json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({k: v for k, v in receipt.items() if k != "nativePackages"}, indent=2))


if __name__ == "__main__":
    main()

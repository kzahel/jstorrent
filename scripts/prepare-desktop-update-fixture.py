#!/usr/bin/env python3
"""Build an isolated signed A/B fixture; no upload, production key or feed edits.

Run on the target build OS. Output contains a disposable signing key and is
private task data; never commit it. The fixture endpoint is loopback HTTPS in
the test guest, which trusts only the public CA compiled into its test binary.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def run(command, *, cwd=None, env=None, capture=False):
    result = subprocess.run(command, cwd=cwd, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    return result.stdout if capture else None


def prepare(args):
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    cli = ROOT / "clients/web/node_modules/@tauri-apps/cli/tauri.js"
    key = output / "qualification.key"
    # Key generation prints the key. Capture it instead of copying secrets
    # into console logs or the evidence report.
    run(["node", str(cli), "signer", "generate", "--ci", "--password", "", "--write-keys", str(key)], capture=True)
    public_key = key.with_suffix(".key.pub").read_text().strip()
    # The fixture CA is compiled only into this feature-gated test binary.
    # No guest system/user trust settings need to be changed or restored.
    tls_config = output / "openssl.cnf"
    tls_config.write_text("\n".join(["[req]", "prompt=no", "distinguished_name=dn", "x509_extensions=v3", "[dn]", "CN=JSTorrent update fixture", "[v3]", "subjectAltName=DNS:localhost", "basicConstraints=critical,CA:TRUE", "keyUsage=digitalSignature,keyCertSign,cRLSign", "extendedKeyUsage=serverAuth", ""]))
    if args.tls_prefix:
        shutil.copy2(args.tls_prefix.with_suffix(".pem"), output / "server.pem")
        shutil.copy2(args.tls_prefix.with_suffix(".key"), output / "server.key")
    else:
        run(["openssl", "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-config", str(tls_config), "-keyout", str(output / "server.key"), "-out", str(output / "server.pem")], capture=True)
    source = args.source_workspace.resolve() if args.source_workspace else output / "source"
    if source == ROOT or source in ROOT.parents:
        raise ValueError("The reusable source workspace must be an owned qualification copy")
    source.mkdir(parents=True, exist_ok=args.source_workspace is not None)
    if args.input_manifest:
        inputs = json.loads(args.input_manifest.read_text())
        files = list(inputs["files"])
        source_commit = inputs["sourceCommit"]
        for name, expected in inputs["files"].items():
            if Path(name).is_absolute() or ".." in Path(name).parts or hashlib.sha256((ROOT/name).read_bytes()).hexdigest() != expected:
                raise ValueError("Qualification source receipt mismatch: " + name)
    else:
        if sys.platform == "win32": raise ValueError("Windows builds require a source manifest prepared using Git through WSL or on the controller")
        files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
        source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    source_digest = hashlib.sha256()
    for name in sorted(files):
        if not name or name.startswith(("reference/", ".git/")):
            continue
        original = ROOT / name
        if not original.is_file():
            continue
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(original.read_bytes()).digest()
        if not target.is_file() or hashlib.sha256(target.read_bytes()).digest() != digest:
            shutil.copy2(original, target)
        source_digest.update(name.encode() + b"\0" + digest)
    # Node dependencies are build inputs only and never enter a package.
    if args.frontend_dist:
        if (source / "clients/web/dist").exists(): shutil.rmtree(source / "clients/web/dist")
        shutil.copytree(args.frontend_dist, source / "clients/web/dist")
    else:
        (source / "clients/web/node_modules").symlink_to(ROOT / "clients/web/node_modules", target_is_directory=True)
    environment = dict(os.environ, CARGO_TARGET_DIR=str(args.cargo_target.resolve() if args.cargo_target else output / "target"),
                       JSTORRENT_QUALIFICATION_CA_PEM=(output / "server.pem").read_text(),
                       TAURI_SIGNING_PRIVATE_KEY=str(key), TAURI_SIGNING_PRIVATE_KEY_PASSWORD="",
                       JSTORRENT_QUALIFICATION_UPDATE_ROOT=args.endpoint.rstrip("/"),
                       JSTORRENT_QUALIFICATION_UPDATE_ENDPOINT=args.endpoint.rstrip("/") + "/tauri/{{target}}/{{arch}}/{{current_version}}")
    if args.quiet_seconds != 900:
        environment["JSTORRENT_QUALIFICATION_QUIET_SECONDS"] = str(args.quiet_seconds)
    manifest = source / "clients/desktop/src-tauri/Cargo.toml"
    original_manifest = manifest.read_text()
    packages = []
    bundle = {"darwin": "app", "win32": "nsis", "linux": "appimage"}[sys.platform]
    for version in ("100.0.1", "100.0.2"):
        manifest.write_text(re.sub(r'^version = "[^"]+"', f'version = "{version}"', original_manifest, count=1, flags=re.M))
        config = {
            "version": version, "productName": "JSTorrent Update Qualification",
            "identifier": "com.jstorrent.qualification.update",
            "build": {"beforeBuildCommand": None if args.frontend_dist else "npm --prefix ../web run build"},
            "bundle": {"createUpdaterArtifacts": True, "targets": [bundle], "fileAssociations": [], "windows": {"nsis": {"installerHooks": None}}},
            "plugins": {"deep-link": {"desktop": {"schemes": []}}, "updater": {"pubkey": public_key, "endpoints": [args.endpoint.rstrip("/") + "/tauri/{{target}}/{{arch}}/{{current_version}}"]}},
        }
        config_path = output / "qualification.conf.json"
        config_path.write_text(json.dumps(config))
        run(["node", str(cli), "build", "--debug", "--features", "update-qualification", "--config", str(config_path), "--bundles", bundle], cwd=source / "clients/desktop", env=environment)
        if sys.platform == "darwin":
            app = next((Path(environment["CARGO_TARGET_DIR"]) / "debug/bundle/macos").glob("*.app"))
            # Debug bundles otherwise carry only the linker's executable
            # signature, not a valid sealed app-bundle signature.
            run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", str(app)])
            payload = app.with_name(app.name + ".tar.gz")
            with tarfile.open(payload, "w:gz") as archive:
                archive.add(app, arcname=app.name)
            sign_environment = dict(os.environ)
            sign_environment.pop("TAURI_SIGNING_PRIVATE_KEY", None)
            sign_environment.pop("TAURI_SIGNING_PRIVATE_KEY_PATH", None)
            run(["node", str(cli), "signer", "sign", "--private-key-path", str(key), "--password", "", str(payload)], env=sign_environment, capture=True)
        destination = output / version
        destination.mkdir()
        build_root = Path(environment["CARGO_TARGET_DIR"]) / "debug/bundle"
        for path in build_root.rglob("*"):
            if path.is_file() and path.name.endswith((".tar.gz", ".AppImage", "-setup.exe", ".sig")) and (sys.platform == "darwin" or f"_{version}_" in path.name):
                shutil.copy2(path, destination / path.name)
        if sys.platform == "darwin":
            apps = list((build_root / "macos").glob("*.app"))
            if len(apps) != 1:
                raise RuntimeError("Expected one qualification app bundle")
            shutil.copytree(apps[0], destination / apps[0].name, symlinks=True)
        packages.append({"version": version, "files": [{"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": path.stat().st_size} for path in destination.iterdir() if path.is_file()]})
    (output / "fixture.json").write_text(json.dumps({"schema": "jstorrent-update-fixture/v1", "sourceCommit": source_commit, "sourceDirty": True, "sourceTreeSha256": source_digest.hexdigest(), "platform": sys.platform, "fixtureTrust": "build-scoped", "quietSeconds": args.quiet_seconds, "noticeSeconds": 60 if args.quiet_seconds == 900 else 5, "packages": packages}, indent=2) + "\n")
    # The updater key has served its purpose. Only public signatures are needed
    # by the guest; do not transfer the private build key.
    key.unlink()
    print(f"Prepared signed qualification fixture: {output / 'fixture.json'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cargo-target", type=Path, help="Owned qualification build cache to reuse")
    parser.add_argument("--source-workspace", type=Path, help="Owned mutable qualification source copy to reuse")
    parser.add_argument("--frontend-dist", type=Path, help="Prebuilt platform-independent web assets from this source revision")
    parser.add_argument("--input-manifest", type=Path, help="Verified source inventory from a controller/WSL checkout")
    parser.add_argument("--tls-prefix", type=Path, help="Existing disposable TLS .pem/.key pair for native Windows builds")
    parser.add_argument("--endpoint", default="https://localhost:18443")
    parser.add_argument("--quiet-seconds", type=int, default=900)
    args = parser.parse_args()
    if not 1 <= args.quiet_seconds <= 900 or not args.endpoint.startswith("https://localhost:"):
        parser.error("Use loopback HTTPS and a quiet period from 1 to 900 seconds")
    existed = args.output.exists()
    try:
        prepare(args)
    finally:
        if not existed:
            (args.output / "qualification.key").unlink(missing_ok=True)


if __name__ == "__main__":
    main()

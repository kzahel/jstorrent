#!/usr/bin/env python3
"""Inspect an extracted/installed desktop package without launching it."""
import argparse
import hashlib
import json

import os
from pathlib import Path
import re

import glib_backport
from native_notices import verify as verify_native_notices

ROOT = glib_backport.ROOT

FORBIDDEN_NAMES = {'.git', 'node_modules', '.env', '.env.local', 'id_rsa', 'id_ed25519',
                   'Cargo.lock', 'package-lock.json', 'test-results', 'playwright-report'}
FORBIDDEN_SUFFIXES = {'.p12', '.pfx', '.p8', '.key', '.map', '.log', '.sqlite', '.db'}
TEXT_SUFFIXES = {'.js', '.json', '.html', '.css', '.txt', '.xml', '.desktop', '.sh', '.pem'}
PRIVATE_KEY = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')
DEVELOPMENT = re.compile(rb'(?:https?://(?:localhost|127\.0\.0\.1):5173|/@vite/client)')


def bounded_paths(root):
    pending, count = [root], 0
    while pending:
        with os.scandir(pending.pop()) as entries:
            for entry in entries:
                count += 1
                if count > 50000:
                    raise ValueError('distribution exceeds entry bound')
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                yield Path(entry.path)


def inspect(root, require_notices=True, require_native=False, require_mit_native=False):
    root = root.resolve(strict=True)
    native_expected = require_native or (require_notices and (root / 'AppRun').exists())
    files, notice_manifests = [], []
    total = 0
    for entry in bounded_paths(root):
        name = entry.relative_to(root).as_posix()
        parts = entry.relative_to(root).parts
        if any(p in FORBIDDEN_NAMES or p.startswith('.env.') for p in parts):
            raise ValueError(f'development/private file in distribution: {name}')
        if entry.suffix.lower() in FORBIDDEN_SUFFIXES:
            raise ValueError(f'unreviewed file type in distribution: {name}')
        if entry.is_symlink():
            if not entry.resolve(strict=True).is_relative_to(root):
                raise ValueError(f'package symlink escapes distribution: {name}')
            files.append({'path': name, 'symlink': entry.readlink().as_posix()})
            continue
        if entry.is_dir():
            continue
        if not entry.is_file():
            raise ValueError(f'special file in distribution: {name}')
        size = entry.stat().st_size
        total += size
        if len(files) >= 50000 or total > 4 * 1024**3:
            raise ValueError('distribution exceeds inventory bounds')
        digest = hashlib.sha256()
        tail = b''
        with entry.open('rb') as source:
            while chunk := source.read(65536):
                digest.update(chunk)
                if entry.suffix.lower() in TEXT_SUFFIXES:
                    window = tail + chunk
                    if PRIVATE_KEY.search(window) or DEVELOPMENT.search(window):
                        raise ValueError(f'private key or development endpoint in text resource: {name}')
                    tail = window[-128:]
        files.append({'path': name, 'bytes': size, 'sha256': digest.hexdigest()})
        if entry.name == 'dependency-manifest.json':
            if size > 2 * 1024**2:
                raise ValueError('dependency manifest exceeds bound')
            manifest = json.loads(entry.read_text(encoding='utf-8'))
            notices = entry.with_name('THIRD_PARTY_NOTICES.txt')
            if not notices.is_file() or notices.stat().st_size > 16 * 1024**2:
                raise ValueError('missing or oversized notices')
            if hashlib.sha256(notices.read_bytes()).hexdigest() != manifest['notices_sha256']:
                raise ValueError('notice content differs from dependency manifest')
            linux_target = manifest.get('target') in {
                'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu'}
            if native_expected and not linux_target:
                raise ValueError('Linux package must identify its reviewed Linux target')
            if linux_target:
                glib = [p for p in manifest.get('rust', []) if p.get('name') == 'glib']
                proof = glib_backport.verify(ROOT)
                if (len(glib) != 1 or glib[0].get('backport') != proof
                        or glib[0].get('version') != proof['version']
                        or glib[0].get('license') != proof['license']
                        or glib[0].get('source') != proof['upstream_archive']):
                    raise ValueError('Linux package must attribute the exact verified GLib backport')
            if manifest.get('schema') != 1 or not manifest.get('rust') or not manifest.get('npm'):
                raise ValueError('incomplete dependency manifest')
            notice_manifests.append({'path': name, 'target': manifest['target'],
                                     'cargo_lock_sha256': manifest['cargo_lock_sha256'],
                                     'npm_lock_sha256': manifest['npm_lock_sha256']})
    if require_notices and len(notice_manifests) != 1:
        raise ValueError('distribution must contain exactly one dependency notice bundle')
    native = verify_native_notices(root) if native_expected else None
    if require_mit_native:
        from linux_native import load_build, verify_known_gpl_absent
        if not native or not json.loads((root / 'usr/share/rstorrent/native-notices/manifest.json').read_text()).get('custom_source_build'):
            raise ValueError('MIT-compatible Linux package lacks custom source-build provenance')
        load_build(root / 'usr/share/rstorrent/native-notices/custom-source', appdir=root)
        native['known_gpl_gate'] = verify_known_gpl_absent(root)
    return {'schema': 1, 'native_notices': native, 'files': sorted(files, key=lambda f: f['path']), 'total_bytes': total,
            'notice_manifests': notice_manifests,
            'scope': 'file inventory, bounded text signatures and Rust/npm notice integrity; '
                     'not a complete secret scanner or native-library license clearance'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--require-native-notices', action='store_true',
                        help='require the AppImage native manifest even if its launcher is missing')
    parser.add_argument('--require-mit-native', action='store_true',
                        help='require new Linux source-build provenance and exclude reviewed GPL-only library chains')
    parser.add_argument('--historical-without-notices', action='store_true',
                        help='inventory old public packages; never use for a new release gate')
    args = parser.parse_args()
    result = inspect(args.root, not args.historical_without_notices, args.require_native_notices, args.require_mit_native)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Inspected {len(result['files'])} package entries; {len(result['notice_manifests'])} notice bundles")


if __name__ == '__main__':
    main()

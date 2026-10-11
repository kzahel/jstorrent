#!/usr/bin/env python3
"""Generate bounded, attributable Rust/npm desktop dependency notices."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

import glib_backport

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 512 * 1024
TARGETS = {'aarch64-apple-darwin', 'x86_64-apple-darwin',
           'x86_64-pc-windows-msvc', 'aarch64-unknown-linux-gnu',
           'x86_64-unknown-linux-gnu'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_text(path):
    data = path.read_bytes()
    if not data or len(data) > LIMIT:
        raise ValueError(f'invalid license text size: {path.name}')
    return data.decode('utf-8-sig')


def branding_notice():
    return ('# JSTorrent branding assets\n\n'
            'Original first-party icons from kzahel/jstorrent-typescript, revision\n'
            '25e4b701433fd815398ba89526546f5e4f072e3f, used without modification.\n\n'
            + read_text(ROOT / 'distribution/branding/JSTorrent-LICENSE.txt'))


def license_files(root):
    files = []
    for entry in sorted(root.iterdir()):
        if entry.name.lower().startswith(('license', 'licence', 'copying', 'notice', 'copyright')):
            if entry.is_symlink():
                raise ValueError('license symlink requires explicit review')
            if entry.is_file():
                files.append(entry)
            elif entry.is_dir():
                files.extend(p for p in sorted(entry.rglob('*')) if p.is_file())
    if len(files) > 100:
        raise ValueError('too many license files')
    for path in files:
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError('license file escapes package')
    return files


def supplemental(package, root, catalog):
    key = f"{package['name']}@{package['version']}"
    entry = catalog.get(key)
    if entry is None:
        raise ValueError(f'missing reviewed license evidence for {key}')
    if (entry['license'].replace('/', ' OR ') != package['license'] or
            entry['manifest_sha256'] != digest((root / 'Cargo.toml').read_bytes())):
        raise ValueError(f'license declaration drift for {key}')
    sections = []
    for source in entry['files']:
        path = ROOT / 'distribution/licenses' / source['file']
        if path.parent != ROOT / 'distribution/licenses' or digest(path.read_bytes()) != source['sha256']:
            raise ValueError(f'license source drift for {key}')
        sections.append(f"Source: {source['source']}\nSHA-256: {source['sha256']}\n\n{read_text(path)}")
    if not sections and not entry.get('declaration_only'):
        raise ValueError(f'empty license evidence for {key}')
    if entry.get('declaration_only'):
        sections.append('Provenance: exact published manifest declaration; standard license text\n'
                        'is provided below. Upstream supplied no standalone license file.\n')
    return sections


def rust_notices(data, catalog):
    sections, inventory = [], []
    for item in sorted(data['crates'], key=lambda p: (p['package']['name'], p['package']['version'])):
        package = item['package']
        root = Path(package['manifest_path']).parent
        backport = None
        if not package['source']:
            if package['name'] == 'glib':
                backport = glib_backport.verify(ROOT)
                if (root.resolve() != (ROOT / 'vendor/glib-0.18.5').resolve()
                        or package['version'] != backport['version']
                        or package['license'] != backport['license']):
                    raise ValueError('unreviewed local GLib notice source')
            elif (package['name'].startswith('rstorrent-') and
                  any(root.resolve().is_relative_to(ROOT / folder) for folder in ('crates', 'clients'))):
                continue
            else:
                raise ValueError('unreviewed local third-party notice source')
        key = f"{package['name']}@{package['version']}"
        files = license_files(root)
        texts = [f"Published file: {p.relative_to(root).as_posix()}\n\n{read_text(p)}" for p in files]
        if not files:
            texts = supplemental(package, root, catalog)
        # This crate preserves additional Zlib attribution in a source header.
        # Copy only that notice, never its implementation.
        if package['name'] == 'crc32c':
            header = (root / 'src/combine.rs').read_text(encoding='utf-8').split('\n\nconst GF2_DIM:', 1)[0]
            if 'Copyright (C) 1995-2006' not in header or len(header) > 4096:
                raise ValueError('CRC32C supplementary attribution changed')
            texts.append('Additional Zlib-derived component notice (upstream src/combine.rs):\n' + header)
        source = f"https://crates.io/api/v1/crates/{package['name']}/{package['version']}/download"
        entry = {'name': package['name'], 'version': package['version'],
                 'license': package['license'], 'source': source}
        if backport:
            source = backport['upstream_archive']
            entry['source'] = source
            entry['backport'] = backport
            texts.append('Local modification: approved RUSTSEC-2024-0429 backport.\n'
                         f"Published archive SHA-256: {backport['upstream_archive_sha256']}\n"
                         f"Patch SHA-256: {backport['patch_sha256']}\n\n"
                         + read_text(ROOT / backport['patch']))
        inventory.append(entry)
        sections.append(f"## {key}\nDeclared license: {package['license']}\n"
                        f"Source package: {source}\n\n" + '\n\n'.join(texts))
    for license in data['licenses']:
        names = sorted(f"{p['crate']['name']}@{p['crate']['version']}" for p in license['used_by'])
        provenance = 'upstream text' if license.get('source_path') else 'standard text; see each package grant above'
        sections.append(f"## {license['id']} ({provenance})\nApplies to: {', '.join(names)}\n\n{license['text']}")
    return sections, inventory


def npm_notices():
    web = ROOT / 'clients/web'
    lock = json.loads((web / 'package-lock.json').read_text(encoding='utf-8'))['packages']
    # Ajv produces shipped standalone validators even though it is a build tool.
    keys = {k for k, p in lock.items() if k and not p.get('dev')}
    keys.add('node_modules/ajv')
    sections, inventory = [], []
    for key in sorted(keys):
        if not key.startswith('node_modules/') or '..' in Path(key).parts:
            raise ValueError('unexpected npm package location')
        locked = lock[key]
        root = web / key
        package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
        if package['version'] != locked['version'] or not locked.get('integrity'):
            raise ValueError('npm installation differs from lockfile')
        files = license_files(root)
        texts = [f"Published file: {p.relative_to(root).as_posix()}\n\n{read_text(p)}" for p in files]
        if not files:
            if (package['name'], package['version'], package.get('license')) != ('client-only', '0.0.1', 'MIT'):
                raise ValueError(f"missing npm license evidence for {package['name']}")
            if (root / 'index.js').read_bytes().strip():
                raise ValueError('reviewed empty client-only marker changed')
            texts = ['The published manifest declares MIT; the browser entry is empty.\n'
                     'The standard MIT text appears in the Rust license section.']
        inventory.append({'name': package['name'], 'version': package['version'],
                          'license': package.get('license'), 'integrity': locked['integrity']})
        sections.append(f"## npm {package['name']}@{package['version']}\n"
                        f"Declared license: {package.get('license')}\n\n" + '\n\n'.join(texts))
    return sections, inventory


def generate_rust_notices(targets, manifest_path):
    version = subprocess.check_output(['cargo-about', '--version'], text=True).strip()
    if version != 'cargo-about 0.9.2':
        raise ValueError('install pinned cargo-about 0.9.2 with --locked --features cli')
    with tempfile.TemporaryDirectory(prefix='rstorrent-notices-') as temporary:
        temp = Path(temporary)
        config = temp / 'about.toml'
        config.write_text((ROOT / 'distribution/about.toml').read_text(encoding='utf-8') + 'targets = ' + json.dumps(targets) + '\n')
        output = temp / 'licenses.json'
        subprocess.run(['cargo-about', 'generate', '--locked', '--fail', '--manifest-path',
                        str(manifest_path), '--config', str(config),
                        '--format', 'json', '--output-file', str(output)], cwd=ROOT, check=True, timeout=600)
        data = json.loads(output.read_text(encoding='utf-8'))
    catalog = json.loads((ROOT / 'distribution/licenses/cargo-sources.json').read_text(encoding='utf-8'))
    rust, rust_inventory = rust_notices(data, catalog)
    if (manifest_path.resolve() == (ROOT / 'clients/desktop/src-tauri/Cargo.toml').resolve()
            and any(t.endswith('-unknown-linux-gnu') for t in targets)
            and len([p for p in rust_inventory if p['name'] == 'glib' and p.get('backport')]) != 1):
        raise ValueError('Linux desktop notices must include the verified GLib backport')
    return rust, rust_inventory, version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', default=os.environ.get('TAURI_ENV_TARGET_TRIPLE'))
    parser.add_argument('--output', type=Path, default=ROOT / 'clients/desktop/src-tauri/binaries/notices')
    args = parser.parse_args()
    target = args.target
    if not target:
        target = next(line[6:] for line in subprocess.check_output(['rustc', '-vV'], text=True).splitlines()
                      if line.startswith('host: '))
    if target not in TARGETS:
        raise ValueError('unreviewed desktop target')
    rust, rust_inventory, version = generate_rust_notices([target], ROOT / 'clients/desktop/src-tauri/Cargo.toml')
    npm, npm_inventory = npm_notices()
    text = ('# JSTorrent third-party Rust and web notices\n\n'
            f'Target: {target}\nGenerator: {version}\n'
            'Scope: locked default-feature desktop Cargo graph, including build dependencies;\n'
            'web production dependencies and Ajv standalone code generation.\n'
            'Native system libraries require the platform package inventory separately.\n\n'
            'MPL-covered source is available from the exact source-package URLs below.\n'
            'Dependencies are unmodified except where a package explicitly records a backport.\n\n'
            + branding_notice() + '\n\n' + '\n\n'.join(rust + npm) + '\n')
    if len(text.encode()) > 16 * 1024 * 1024:
        raise ValueError('notice bundle exceeds 16 MiB')
    manifest = {'schema': 1, 'target': target, 'generator': version,
                'cargo_lock_sha256': digest((ROOT / 'Cargo.lock').read_bytes()),
                'npm_lock_sha256': digest((ROOT / 'clients/web/package-lock.json').read_bytes()),
                'notices_sha256': digest(text.encode()), 'rust': rust_inventory, 'npm': npm_inventory}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'THIRD_PARTY_NOTICES.txt').write_text(text, encoding='utf-8', newline='\n')
    (args.output / 'dependency-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'Prepared {len(rust_inventory)} Rust and {len(npm_inventory)} npm dependency notices for {target}')


if __name__ == '__main__':
    main()

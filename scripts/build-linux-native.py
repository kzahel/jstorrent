#!/usr/bin/env python3
"""Build reviewed AppImage libraries without the two GPL-only dependencies.

Runs in an owned Ubuntu 24.04 build directory; never installs into /usr.
Source pins include Ubuntu's changes, not just the upstream releases.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / 'distribution/linux-native'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(args, cwd, timeout=600):
    print('Running:', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, check=True, timeout=timeout,
                   env={**os.environ, 'LC_ALL': 'C'})


def obtain(item, directory, download):
    path = directory / item['name']
    if not path.exists() and download:
        temporary = path.with_suffix(path.suffix + '.partial')
        try:
            with urllib.request.urlopen(item['url'], timeout=60) as response, temporary.open('xb') as stream:
                total = 0
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > item['bytes']:
                        raise ValueError('native source exceeds pinned size')
                    stream.write(chunk)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    if not path.is_file() or path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
        raise ValueError('native source does not match reviewed pin: ' + item['name'])
    return path


def build(sources, output, download=False):
    if platform.system() != 'Linux' or platform.machine() not in {'x86_64', 'aarch64'}:
        raise ValueError('native source recipe requires Linux x64 or ARM64')
    release = platform.freedesktop_os_release()
    if release.get('ID') != 'ubuntu' or release.get('VERSION_ID') != '24.04':
        raise ValueError('native source recipe requires reviewed Ubuntu 24.04')
    pins = json.loads((RECIPE / 'sources.json').read_text())
    sources.mkdir(parents=True, exist_ok=True)
    # Refuse a reused build/output root; retain it for inspection on failure.
    output.mkdir(parents=True, exist_ok=False)
    material = output / 'source-materials'
    material.mkdir()
    for package in pins['packages']:
        for item in package['files']:
            shutil.copyfile(obtain(item, sources, download), material / item['name'])
    for name in ['sources.json', 'appindicator-no-desktop-shortcuts.patch', 'README.md', 'tray-probe.c']:
        shutil.copyfile(RECIPE / name, material / name)
    shutil.copyfile(Path(__file__), material / 'build-linux-native.py')
    shutil.copyfile(ROOT / 'scripts/verify-linux-native.py', material / 'verify-linux-native.py')
    prefix = output / 'prefix'
    (prefix / 'lib').mkdir(parents=True)
    builds = []
    for package in pins['packages']:
        name = package['source_package']
        source = output / name
        run(['dpkg-source', '--no-check', '-x', material / package['descriptor'], source], output)
        if name == 'libayatana-appindicator':
            run(['patch', '--batch', '--fuzz=0', '-p1', '-i', material / 'appindicator-no-desktop-shortcuts.patch'], source)
            flags = ['-DENABLE_DESKTOP_SHORTCUTS=OFF', '-DENABLE_BINDINGS_MONO=OFF',
                     '-DENABLE_BINDINGS_VALA=OFF', '-DENABLE_GTKDOC=OFF', '-DENABLE_TESTS=OFF',
                     '-DFLAVOUR_GTK3=ON', '-DFLAVOUR_GTK2=OFF']
            target = ['--target', 'ayatana-appindicator3']
            library = 'libayatana-appindicator3.so.1.0.0'
            soname = 'libayatana-appindicator3.so.1'
            binary = output / (name + '-build') / 'src' / library
        else:
            flags = ['-Djbig=OFF', '-Dld-version-script=ON', '-DBUILD_SHARED_LIBS=ON',
                     '-Dtiff-docs=OFF', '-Dtiff-contrib=OFF', '-Dtiff-tests=ON', '-Dtiff-tools=ON',
                     '-Dtiff-opengl=OFF', '-Dcxx=OFF', '-Dzlib=ON', '-Djpeg=ON',
                     '-Dlibdeflate=ON', '-Dlzma=ON', '-Dzstd=ON', '-Dwebp=ON', '-Dlerc=ON']
            target = []
            library = 'libtiff.so.6.0.1'
            soname = 'libtiff.so.6'
            binary = output / (name + '-build') / 'libtiff' / library
        directory = output / (name + '-build')
        common_flags = ['-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=-O2 -fPIC -fstack-protector-strong -D_FORTIFY_SOURCE=2',
                        '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,relro,-z,now,--as-needed']
        run(['cmake', '-S', source, '-B', directory, *common_flags, *flags], output)
        run(['cmake', '--build', directory, '-j', '2', *target], output)
        if name == 'tiff':
            run(['ctest', '--test-dir', directory, '--output-on-failure', '--timeout', '30'], output)
        destination = prefix / 'lib' / library
        shutil.copyfile(binary, destination)
        (prefix / 'lib' / soname).symlink_to(library)
        (prefix / 'lib' / soname.split('.so')[0]).with_suffix('.so').symlink_to(library)
        shutil.copyfile(source / 'debian/copyright', material / (name + '-copyright'))
        patches = source / 'debian/patches/series'
        builds.append({**package, 'library': library, 'soname': soname,
                       'sha256': sha(destination), 'bytes': destination.stat().st_size,
                       'cmake_flags': common_flags + flags,
                       'debian_patch_series': patches.read_text().splitlines() if patches.exists() else [],
                       'copyright': name + '-copyright'})
    toolchain = {tool: subprocess.check_output([tool, '--version'], text=True, timeout=30).splitlines()[0]
                 for tool in ['gcc', 'cmake', 'dpkg-source', 'patch']}
    manifest = {'schema': 1, 'architecture': platform.machine(), 'ubuntu': '24.04',
                'kind': 'custom-source-build', 'builds': builds,
                'toolchain': toolchain,
                'recipe_files': {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size}
                                 for p in sorted(material.iterdir())},
                'scope': 'Reviewed native libraries; source archives include original Debian security patches. Not a signed package or a complete public source offer.'}
    (output / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    result = build(args.sources_dir.resolve(), args.output.resolve(), args.download)
    print(json.dumps({'result': 'built', 'architecture': result['architecture'],
                      'libraries': [b['soname'] for b in result['builds']]}))


if __name__ == '__main__':
    main()

"""Bounded Linux source-build replacement and known GPL dependency gate."""
import json
from pathlib import Path
import shutil
import struct

from native_notices import NOTICE_ROOT, safe_file, selected_files, sha

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / 'distribution/linux-native'
FORBIDDEN = ('libjbig.so', 'libayatana-indicator', 'libindicator3.so')


def needed(path):
    """Read ELF64 little-endian DT_NEEDED for our two supported Linux targets."""
    with path.open('rb') as stream:
        data = stream.read(128 * 1024**2 + 1)
    if data[:4] != b'\x7fELF':
        return []
    if len(data) > 128 * 1024**2 or len(data) < 64 or data[4:6] != b'\x02\x01':
        raise ValueError('unreviewed native ELF encoding or size')
    offset = struct.unpack_from('<Q', data, 32)[0]
    size, count = struct.unpack_from('<HH', data, 54)
    if size != 56 or count > 1024 or offset + count * size > len(data):
        raise ValueError('invalid native ELF program headers')
    loads, tags = [], []
    for at in range(offset, offset + count * size, size):
        kind, _, file, address, _, extent, _, _ = struct.unpack_from('<IIQQQQQQ', data, at)
        if file + extent > len(data):
            raise ValueError('native ELF segment exceeds file')
        if kind == 1:
            loads.append((file, address, extent))
        if kind == 2:
            if extent % 16:
                raise ValueError('invalid native dynamic segment')
            for pos in range(file, file + extent, 16):
                key, value = struct.unpack_from('<QQ', data, pos)
                if key == 0:
                    break
                tags.append((key, value))
    names = [value for key, value in tags if key == 1]
    if not names:
        return []
    addresses = [value for key, value in tags if key == 5]
    lengths = [value for key, value in tags if key == 10]
    if len(addresses) != 1 or len(lengths) != 1 or lengths[0] > 8 * 1024**2:
        raise ValueError('invalid native string table')
    tables = [file + addresses[0] - address for file, address, extent in loads
              if address <= addresses[0] and addresses[0] + lengths[0] <= address + extent]
    if len(tables) != 1:
        raise ValueError('native string table does not map uniquely')
    start, length = tables[0], lengths[0]
    result = []
    for name in names:
        if name >= length:
            raise ValueError('native dependency exceeds string table')
        end = data.find(b'\0', start + name, start + length)
        if end < 0:
            raise ValueError('unterminated native dependency')
        result.append(data[start + name:end].decode('ascii'))
    return result


def verify_known_gpl_absent(root):
    """Refuse these proven library chains, including unused bundled copies.

    This is deliberately not a blanket GPL copyright-text scanner or complete
    license clearance. Historical packages can still use the ordinary inspector.
    """
    selected = selected_files(root.resolve(strict=True))
    for name in selected:
        if Path(name).name.startswith(FORBIDDEN):
            raise ValueError('GPL-only native library bundled: ' + name)
        for dependency in needed(root / name):
            if dependency.startswith(FORBIDDEN):
                raise ValueError('GPL-only native dependency: ' + name + ' -> ' + dependency)
    return {'selected_components': len(selected), 'excluded_library_families': list(FORBIDDEN),
            'scope': 'Two reviewed GPL-only library chains; not comprehensive license clearance'}


def load_build(directory, appdir=None):
    manifest = safe_file(directory, 'provenance.json')
    if manifest.stat().st_size > 128 * 1024:
        raise ValueError('custom native provenance exceeds bound')
    data = json.loads(manifest.read_text())
    pins = json.loads((RECIPE / 'sources.json').read_text())
    if (data.get('schema') != 1 or data.get('kind') != 'custom-source-build'
            or data.get('architecture') not in {'x86_64', 'aarch64'} or data.get('ubuntu') != '24.04'
            or len(data.get('builds', [])) != 2):
        raise ValueError('unreviewed custom native build')
    expected = {p['source_package']: p for p in pins['packages']}
    observed = set()
    for item in data['builds']:
        name = item['source_package']
        if name not in expected or name in observed or any(item.get(k) != v for k, v in expected[name].items()):
            raise ValueError('custom native source pins differ')
        observed.add(name)
        library = {'tiff': ('libtiff.so.6.0.1', 'libtiff.so.6', '-Djbig=OFF'),
                   'libayatana-appindicator': ('libayatana-appindicator3.so.1.0.0',
                                             'libayatana-appindicator3.so.1', '-DENABLE_DESKTOP_SHORTCUTS=OFF')}[name]
        if (item.get('library'), item.get('soname')) != library[:2] or library[2] not in item.get('cmake_flags', []):
            raise ValueError('custom native configuration differs')
        binary = (safe_file(appdir, 'usr/lib/' + item['soname']) if appdir is not None
                  else safe_file(directory, 'prefix/lib/' + item['library']))
        if binary.stat().st_size != item['bytes'] or sha(binary) != item['sha256']:
            raise ValueError('custom native binary differs')
        with binary.open('rb') as stream:
            header = stream.read(20)
        if len(header) != 20 or struct.unpack_from('<H', header, 18)[0] != {'x86_64': 62, 'aarch64': 183}[data['architecture']]:
            raise ValueError('custom native ELF architecture differs')
        if any(n.startswith(FORBIDDEN) for n in needed(binary)):
            raise ValueError('custom build still needs GPL-only library')
    files = data.get('recipe_files', {})
    if len(files) > 32 or not files:
        raise ValueError('custom native recipe inventory exceeds bound')
    for name, item in files.items():
        if Path(name).name != name:
            raise ValueError('unsafe custom native recipe name')
        path = safe_file(directory, name if appdir is not None else 'source-materials/' + name)
        if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
            raise ValueError('custom native source material differs')
    for source in [RECIPE / 'sources.json', RECIPE / 'appindicator-no-desktop-shortcuts.patch',
                   ROOT / 'scripts/build-linux-native.py']:
        if files.get(source.name, {}).get('sha256') != sha(source):
            raise ValueError('custom native build recipe differs')
    for package in pins['packages']:
        for item in package['files']:
            if files.get(item['name'], {}).get('sha256') != item['sha256']:
                raise ValueError('custom native source archive missing')
        if package['source_package'] + '-copyright' not in files:
            raise ValueError('custom native original copyright missing')
    return data


def install(root, directory):
    """Replace before notice collection; remove only now-unused known GPL libs."""
    root = root.resolve(strict=True)
    data = load_build(directory.resolve(strict=True))
    with safe_file(root, 'usr/bin/jstorrent-client').open('rb') as stream:
        header = stream.read(20)
    if len(header) != 20 or struct.unpack_from('<H', header, 18)[0] != {'x86_64': 62, 'aarch64': 183}[data['architecture']]:
        raise ValueError('custom build and desktop ELF architectures differ')
    for item in data['builds']:
        name = 'usr/lib/' + item['soname']
        destination = safe_file(root, name)
        if destination.is_symlink():
            raise ValueError('custom native destination must be the bundled regular SONAME file')
        shutil.copyfile(directory / 'prefix/lib' / item['library'], destination)
    inventory = selected_files(root)
    removals = [name for name in inventory if Path(name).name.startswith(FORBIDDEN)]
    # First prove no remaining library needs these copies, then remove them.
    for name in inventory:
        if name not in removals and any(n.startswith(FORBIDDEN) for n in needed(root / name)):
            raise ValueError('another bundled consumer still requires GPL-only library: ' + name)
    for name in removals:
        (root / name).unlink()
    verify_known_gpl_absent(root)
    return data

#!/usr/bin/env python3
"""Check rebuilt library ABI, dependencies and ordinary TIFF codecs."""
import argparse
import ctypes
import hashlib
import json
from pathlib import Path
import re
import subprocess

FORBIDDEN = ('libjbig.so', 'libayatana-indicator', 'libindicator3.so')


def command(args):
    return subprocess.check_output(args, text=True, timeout=60)


def exports(path):
    return {line.split()[-1] for line in command(['nm', '-D', '--defined-only', str(path)]).splitlines()}


def verify(root, original):
    data = json.loads((root / 'provenance.json').read_text())
    libraries = []
    for item in data['builds']:
        path = root / 'prefix/lib' / item['library']
        if hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('rebuilt library digest differs')
        dynamic = command(['readelf', '-d', str(path)])
        needed = re.findall(r'\(NEEDED\).*\[(.*?)\]', dynamic)
        if any(name.startswith(FORBIDDEN) for name in needed):
            raise ValueError('GPL-only native dependency remains')
        symbols = command(['nm', '-D', str(path)])
        if re.search(r'\b(jbg_|indicator_desktop_shortcuts_)', symbols):
            raise ValueError('GPL-only library symbol remains')
        old = exports(original / item['soname'])
        new = exports(path)
        if old - new:
            raise ValueError('required exported ABI lost: ' + str(sorted(old - new)))
        relocations = command(['ldd', '-r', str(path)])
        if 'not found' in relocations or 'undefined symbol:' in relocations:
            raise ValueError('native library has unresolved dependencies')
        libraries.append({'soname': item['soname'], 'sha256': item['sha256'],
                          'needed': needed, 'preserved_exports': len(old),
                          'additional_exports': sorted(new - old), 'relocations_resolve': True})
    tiff = ctypes.CDLL(str(root / 'prefix/lib/libtiff.so.6'))
    tiff.TIFFIsCODECConfigured.argtypes = [ctypes.c_uint16]
    tiff.TIFFIsCODECConfigured.restype = ctypes.c_int
    codecs = {name: bool(tiff.TIFFIsCODECConfigured(code)) for name, code in
              [('none', 1), ('lzw', 5), ('jpeg', 7), ('deflate', 32946), ('packbits', 32773), ('jbig', 34661)]}
    if codecs != {'none': True, 'lzw': True, 'jpeg': True, 'deflate': True, 'packbits': True, 'jbig': False}:
        raise ValueError('TIFF codec configuration differs: ' + str(codecs))
    loader = original / 'gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-tiff.so'
    ctypes.CDLL(str(loader))
    return {'result': 'pass_abi_dependencies_codecs', 'libraries': libraries,
            'tiff_codecs': codecs, 'original_pixbuf_tiff_loader_dlopen': True,
            'scope': 'Native source prototype; exported ABI, relocation, codec and loader checks. Not signed AppImage or complete desktop qualification.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-root', type=Path, required=True)
    parser.add_argument('--original-libs-dir', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.build_root.resolve(), args.original_libs_dir.resolve())
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()

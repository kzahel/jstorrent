#!/usr/bin/env python3
"""linuxdeploy output-plugin API 0: attribute the AppDir, then package it."""
import argparse
import importlib.util
import os
from pathlib import Path
import platform
import sys

from native_notices import collect, sha
from linux_native import install, verify_known_gpl_absent


def main():
    # linuxdeploy can probe an AppImage-named script with this runtime flag.
    args = [a for a in sys.argv[1:] if a != '--appimage-extract-and-run']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--delegate', type=Path, required=True)
    parser.add_argument('--plugin-api-version', action='store_true')
    parser.add_argument('--plugin-type', action='store_true')
    parser.add_argument('--appdir', type=Path)
    options = parser.parse_args(args)
    if options.plugin_api_version:
        print('0')
        return
    if options.plugin_type:
        print('output')
        return
    if not options.appdir:
        parser.error('--appdir is required')
    spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-appimage-notices.py'))
    prepare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare)
    if options.delegate.stat().st_size > 128 * 1024**2 or sha(options.delegate) != prepare.PLUGINS[platform.machine()]:
        raise ValueError('AppImage output plugin digest differs from reviewed asset')
    build = os.environ.get('JSTORRENT_LINUX_NATIVE_BUILD')
    if not build:
        raise ValueError('AppImage requires the reviewed MIT-compatible native source build')
    install(options.appdir, Path(build))
    report = collect(options.appdir, custom_build=Path(build))
    verify_known_gpl_absent(options.appdir)
    print(f"Embedded native notices for {len(report['packages'])} distro packages", flush=True)
    # Replace this process so linuxdeploy remains the one owner of completion,
    # cancellation and errors. Tauri signs only once this output step returns.
    os.execv(str(options.delegate), [str(options.delegate), '--appimage-extract-and-run',
                                   '--appdir', str(options.appdir)])


if __name__ == '__main__':
    main()

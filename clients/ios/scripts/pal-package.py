#!/usr/bin/env python3
"""Prepare an AltStore-hosted ADP as immutable GitHub release assets."""

import argparse
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


API = 'https://api.altstore.io/adps'
REPOSITORY = 'kzahel/jstorrent'
BUNDLE = 'com.jstorrent.ios'
APPLE_ID = '6760584856'
MAX_DOWNLOAD = 256 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILE = 256 * 1024 * 1024
MAX_FILES = 150
SOURCE_NAME = 'altstore-source.json'
RECEIPT_NAME = 'ios-pal-receipt.json'
ICON_NAME = 'jstorrent-ios-icon.png'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def asset_url(version, asset):
    return f'https://github.com/{REPOSITORY}/releases/download/{release_tag(version)}/{asset}'


def release_tag(version):
    if version == '1.0.7':
        return 'ios-pal-baseline-v1.0.7'
    return f'ios-v{version}'


def package_api(url, payload=None, allow_missing=False):
    request = urllib.request.Request(url, headers={'User-Agent': 'JSTorrent-PAL-release'})
    if payload:
        request.add_header('Content-Type', 'application/json')
        request.data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read(128 * 1024)
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        if allow_missing and error.code == 404:
            return None
        raise ValueError(f'AltStore API returned HTTP {error.code}') from None


def download(url, destination, maximum):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username, 'invalid HTTPS download URL')
    digest = hashlib.sha256()
    length = 0
    request = urllib.request.Request(url, headers={'User-Agent': 'JSTorrent-PAL-release'})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            require(urllib.parse.urlsplit(response.url).scheme == 'https', 'download redirected away from HTTPS')
            with destination.open('wb') as output:
                while block := response.read(1024 * 256):
                    length += len(block)
                    require(length <= maximum, 'download is larger than expected')
                    output.write(block)
                    digest.update(block)
    except urllib.error.HTTPError as error:
        raise ValueError(f'Package download returned HTTP {error.code}') from None
    return length, digest.hexdigest()


def fetch_package(package_id, output):
    require(re.fullmatch(r'[\da-fA-F-]{36}', package_id), 'invalid Apple package ID')
    endpoint = f'{API}/{package_id}'
    status = package_api(endpoint, allow_missing=True)
    if status is None or status.get('status') in {'failed', 'FAILED'} or status.get('downloadExpired'):
        print('Requesting AltStore processing for the notarized package.', flush=True)
        package_api(API, {'adpID': package_id})
    for attempt in range(13):
        status = package_api(endpoint, allow_missing=True) or {}
        if url := status.get('downloadURL'):
            download(url, output, MAX_DOWNLOAD)
            return
        if attempt != 12:
            time.sleep(10)
    raise ValueError(f'AltStore package still unavailable (status: {status.get("status", "pending")}). Retry staging later.')


def extract_package(archive, directory):
    remaining = MAX_TOTAL
    names = set()

    def save(name, size, opener):
        nonlocal remaining
        path = PurePosixPath(name)
        require(not path.is_absolute() and '..' not in path.parts and '\\' not in name,
                'invalid package asset path')
        require(path not in names and len(names) < MAX_FILES, 'duplicate or excessive package files')
        require(0 < size <= min(MAX_FILE, remaining), 'invalid package asset size')
        names.add(path)
        target = directory.joinpath(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with opener() as source, target.open('xb') as output:
            shutil.copyfileobj(source, output, 1024 * 256)
        require(target.stat().st_size == size, 'package asset size differs from archive')
        remaining -= size

    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                if item.is_dir() or item.filename.startswith('__MACOSX/'):
                    continue
                require((item.external_attr >> 28) != 0o12, 'package contains a symbolic link')
                save(item.filename, item.file_size, lambda: package.open(item))
    else:
        with tarfile.open(archive) as package:
            for item in package:
                if item.isdir():
                    continue
                require(item.isfile(), 'package contains a non-regular file')
                save(item.name, item.size, lambda: package.extractfile(item))


def package_paths(manifest_path, version, build):
    manifest = json.loads(manifest_path.read_bytes())
    require(manifest['bundleId'] == BUNDLE and str(manifest['appleItemId']) == APPLE_ID,
            'package belongs to another app')
    require(manifest['shortVersionString'] == version and str(manifest['bundleVersion']) == build,
            'package version or build does not match')
    require(not manifest.get('isLaunchProhibited'), 'package prohibits launch')
    require(manifest.get('variants'), 'package has no installable variants')

    paths = [PurePosixPath('manifest.json'), PurePosixPath('signature')]
    for entry in manifest['variants'] + manifest.get('deltas', []):
        asset = PurePosixPath(entry['assetPath'])
        require(len(asset.parts) == 2 and asset.parts[0] in {'variant', 'delta'} and
                re.fullmatch(r'[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+', asset.name), 'unexpected ADP asset path')
        paths.append(asset)
    require(len({path.stem for path in paths}) == len(paths), 'ambiguous ADP asset names')
    return paths


def collect_assets(directory, output, version, build):
    manifests = list(directory.rglob('manifest.json'))
    require(len(manifests) == 1, 'expected one AltStore distribution manifest')
    manifest_path = manifests[0]
    paths = [manifest_path.parent / path for path in package_paths(manifest_path, version, build)]
    assets = {}
    for path in paths:
        require(path.is_file() and path.stat().st_size, f'missing package asset {path.name}')
        shutil.copyfile(path, output / path.name)
        assets[path.stem] = asset_url(version, path.name)
    return assets, paths[2].stat().st_size


def source_for_candidate(version, build, assets, size, date):
    legacy = version == '1.0.7'
    return {
        'name': 'JSTorrent',
        'subtitle': 'BitTorrent client for iOS',
        'description': 'Download and manage torrents directly on your iPhone or iPad.',
        'iconURL': asset_url(version, ICON_NAME),
        'website': 'https://jstorrent.com',
        'tintColor': '#4A90D9',
        'apps': [{
            'name': 'JSTorrent', 'bundleIdentifier': BUNDLE, 'marketplaceID': APPLE_ID,
            'developerName': 'Kyle Graehl', 'subtitle': 'BitTorrent downloads on iOS',
            'iconURL': asset_url(version, ICON_NAME), 'category': 'utilities',
            'localizedDescription': 'Add magnet links and torrent files, pick what to download, and open completed files on your device.',
            'versions': [{
                'version': version, 'buildVersion': build,
                'date': date,
                'localizedDescription': ('Original TypeScript release for upgrade testing.' if legacy else
                                         'JSTorrent’s native iOS app now uses the Rust engine.'),
                'downloadURL': assets['manifest'], 'size': size, 'minOSVersion': '16.0', 'assetURLs': assets,
            }],
            'appPermissions': {'entitlements': [], 'privacy': {} if legacy else {
                'NSLocalNetworkUsageDescription': 'JSTorrent connects directly to peers on your local network.',
            }},
        }],
        'news': [],
    }


def describe(path):
    with path.open('rb') as content:
        return {'size': path.stat().st_size, 'sha256': hashlib.file_digest(content, 'sha256').hexdigest()}


def inventory(directory):
    return {path.name: describe(path) for path in sorted(directory.iterdir()) if path.name != RECEIPT_NAME}


def prepare(version, build, commit, archive, output, icon, published_date):
    output.mkdir()
    with tempfile.TemporaryDirectory() as temporary:
        package_root = Path(temporary)
        extract_package(archive, package_root)
        assets, size = collect_assets(package_root, output, version, build)
    shutil.copyfile(icon, output / ICON_NAME)
    write_json(output / SOURCE_NAME, source_for_candidate(version, build, assets, size, published_date))
    write_json(output / RECEIPT_NAME, {
        'version': version, 'build': build, 'commit': commit, 'files': inventory(output),
    })


def verify_public(version, build, commit, output):
    output.mkdir()
    receipt_path = output / RECEIPT_NAME
    download(asset_url(version, RECEIPT_NAME), receipt_path, 64 * 1024)
    receipt = json.loads(receipt_path.read_bytes())
    require((receipt['version'], receipt['build'], receipt['commit']) == (version, build, commit),
            'published package is for another version, build or commit')
    files = receipt['files']
    require(4 <= len(files) <= MAX_FILES and {SOURCE_NAME, ICON_NAME, 'manifest.json', 'signature'} <= files.keys(),
            'unexpected package inventory')
    total = 0
    for name, expected in files.items():
        require(re.fullmatch(r'[a-zA-Z0-9_.-]+', name) and name not in {'.', '..', RECEIPT_NAME}, 'invalid asset filename')
        require(0 < expected['size'] <= MAX_FILE, 'invalid expected asset size')
        total += expected['size']
        require(total <= MAX_TOTAL, 'published package exceeds the size limit')
        size, digest = download(asset_url(version, name), output / name, expected['size'])
        require(size == expected['size'] and digest == expected['sha256'], f'published bytes differ for {name}')
    source = json.loads((output / SOURCE_NAME).read_bytes())
    app, = source['apps']
    release, = app['versions']
    require(app['bundleIdentifier'] == BUNDLE and app['marketplaceID'] == APPLE_ID and
            release['version'] == version and release['buildVersion'] == build, 'published source identity differs')
    paths = package_paths(output / 'manifest.json', version, build)
    require({path.name for path in paths} == files.keys() - {SOURCE_NAME, ICON_NAME}, 'published package does not match the manifest')
    require(release['downloadURL'] == asset_url(version, 'manifest.json') and
            release['assetURLs'] == {path.stem: asset_url(version, path.name) for path in paths}, 'published source asset URLs differ')


def promote_source(verified, production):
    candidate = json.loads(verified.read_bytes())
    current = json.loads(production.read_bytes())
    app, = candidate['apps']
    current_app, = current['apps']
    require(app['bundleIdentifier'] == current_app['bundleIdentifier'] == BUNDLE and
            app['marketplaceID'] == current_app['marketplaceID'] == APPLE_ID, 'unexpected production app identity')
    new = app['versions'][0]
    version_tuple = lambda item: tuple(map(int, item['version'].split('.')))
    prior = current_app['versions']
    if prior[0]['version'] == new['version']:
        require(prior[0] == new, 'production already advertises different bytes for this version')
        return
    require(all(version_tuple(new) > version_tuple(item) for item in prior), 'production source version would go backwards')
    app['versions'].extend(item for item in prior if item.get('assetURLs', {}).get('manifest') == item['downloadURL'])
    if 'fediUsername' in current:
        candidate['fediUsername'] = current['fediUsername']
    candidate['news'] = current['news']
    write_json(production, candidate)


def stage_release(version, directory, commit):
    tag = release_tag(version)

    def gh(*arguments):
        return subprocess.run(['gh', *arguments, '--repo', REPOSITORY], check=True, text=True, stdout=subprocess.PIPE).stdout

    existing = subprocess.run(['gh', 'release', 'view', tag, '--repo', REPOSITORY,
                               '--json', 'isDraft,isPrerelease,assets'], capture_output=True, text=True)
    if existing.returncode:
        require('release not found' in existing.stderr.lower(), 'GitHub could not look up the staged release')
        require_tag = [] if version == '1.0.7' else ['--verify-tag']
        notes = ('Archived TypeScript build 9 for physical upgrade testing.' if version == '1.0.7' else
                 f'Staged AltStore PAL build from `{commit}`.')
        gh('release', 'create', tag, *require_tag, '--target', commit, '--draft', '--prerelease', '--latest=false',
           '--title', f'JSTorrent iOS {version} PAL test', '--notes', notes)
        assets = []
        draft = True
    else:
        release = json.loads(existing.stdout)
        require(release['isPrerelease'], 'refusing to change a production release')
        assets = release['assets']
        draft = release['isDraft']

    local_files = inventory(directory)
    local_files[RECEIPT_NAME] = describe(directory / RECEIPT_NAME)
    for asset in assets:
        name = asset['name']
        expected = local_files.pop(name, None)
        require(expected and asset['size'] == expected['size'] and
                asset.get('digest') == f'sha256:{expected["sha256"]}', f'staged asset differs: {name}')
    if not draft:
        require(not local_files, 'public staging release is missing assets')
        return
    if local_files:
        gh('release', 'upload', tag, *(str(directory / name) for name in local_files))
    gh('release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['stage', 'verify', 'promote'])
    parser.add_argument('version')
    parser.add_argument('build')
    parser.add_argument('commit')
    parser.add_argument('output', type=Path)
    parser.add_argument('--package-id')
    parser.add_argument('--production-source', type=Path)
    args = parser.parse_args()
    require(re.fullmatch(r'\d+\.\d+\.\d+', args.version) and re.fullmatch(r'[1-9]\d*', args.build) and
            re.fullmatch(r'[0-9a-f]{40}', args.commit), 'expected a release version, build number and source commit')
    release = (args.version, args.build, args.commit)
    if args.operation == 'stage':
        require(args.package_id, 'an Apple package ID is required')
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'package'
            fetch_package(args.package_id, archive)
            icon = Path(__file__).resolve().parents[1] / 'App/Assets.xcassets/AppIcon.appiconset/AppIcon.png'
            date = subprocess.check_output(['git', 'show', '-s', '--format=%cI', args.commit], text=True).strip()
            published_date = ('2026-04-01T11:30:07Z' if args.version == '1.0.7' else
                              datetime.datetime.fromisoformat(date).astimezone(datetime.timezone.utc).isoformat())
            prepare(*release, archive, args.output, icon, published_date)
        stage_release(args.version, args.output, args.commit)
        print(f'Staged source: {asset_url(args.version, SOURCE_NAME)}')
    else:
        verify_public(*release, args.output)
        if args.operation == 'promote':
            require(args.version != '1.0.7', 'the legacy test source is for upgrade qualification')
            require(args.production_source, 'a production source file is required')
            promote_source(args.output / SOURCE_NAME, args.production_source)


if __name__ == '__main__':
    try:
        main()
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError, zipfile.BadZipFile) as error:
        raise SystemExit(f'PAL release: {error}') from None

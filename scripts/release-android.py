#!/usr/bin/env python3
"""Prepare/tag/push an Android release, or validate the tagged source in CI."""
import argparse
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GRADLE = Path('clients/android/app/build.gradle.kts')
CHANGELOG = Path('clients/android/CHANGELOG.md')
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')


def version_tuple(value):
    if not VERSION.fullmatch(value):
        raise ValueError('Use a version such as 0.1.1 (three integers, no v prefix)')
    return tuple(map(int, value.split('.')))


def read_version(text):
    names = re.findall(r'^\s*versionName = "([^"]+)"\s*$', text, re.M)
    codes = re.findall(r'^\s*versionCode = ([0-9]+)\s*$', text, re.M)
    if len(names) != 1 or len(codes) != 1:
        raise ValueError('Expected exactly one versionName and versionCode')
    version_tuple(names[0])
    code = int(codes[0])
    if not 1 <= code <= 2100000000:
        raise ValueError('versionCode is outside the Play range')
    return names[0], code


def release_notes(changelog, version):
    heading = re.compile(r'^## \[' + re.escape(version) + r'\](?:\s.*)?$', re.M)
    matches = list(heading.finditer(changelog))
    if len(matches) != 1:
        raise ValueError(f'Changelog needs exactly one ## [{version}] section')
    text = changelog[matches[0].end():]
    text = re.split(r'^## ', text, maxsplit=1, flags=re.M)[0].strip()
    if not text:
        raise ValueError('Release notes must not be empty')
    return text


def bump(text, version):
    current, code = read_version(text)
    if version_tuple(version) <= version_tuple(current):
        raise ValueError(f'New version must be greater than {current}')
    if code == 2100000000:
        raise ValueError('versionCode exhausted')
    text = re.sub(r'(versionName = ")[^"]+("\s*$)', lambda m: m[1] + version + m[2], text, flags=re.M)
    return re.sub(r'(versionCode = )[0-9]+', lambda m: m[1] + str(code + 1), text), code + 1


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version', nargs='?')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--tag')
    args = parser.parse_args()
    text = (ROOT / GRADLE).read_text()
    current, code = read_version(text)
    if args.check:
        if args.version or args.dry_run:
            parser.error('--check cannot be combined with version or --dry-run')
        if args.tag is not None and args.tag != f'android-v{current}':
            raise ValueError('Tag does not match Gradle versionName')
        notes = release_notes((ROOT / CHANGELOG).read_text(), current)
        print(notes)
        return
    if not args.version or args.tag:
        parser.error('Provide a version; --tag is only for --check')
    updated, code = bump(text, args.version)
    release_notes((ROOT / CHANGELOG).read_text(), args.version)
    if git('status', '--porcelain'):
        raise ValueError('Working tree must be clean, including untracked files; commit the changelog first')
    if git('branch', '--show-current') != 'main':
        raise ValueError('Release from main')
    for field in ('name', 'email'):
        identity = git('config', f'user.{field}')
        if not identity or re.search(r'bot|automation|example\.|noreply', identity, re.I):
            raise ValueError(f'Configure a maintainer git user.{field}')
    tag = f'android-v{args.version}'
    if git('tag', '--list', tag):
        raise ValueError(f'Tag already exists: {tag}')
    print(f'{current} -> {args.version}, versionCode {code}; commit, tag {tag}, atomic push to origin/main')
    if args.dry_run:
        return
    remote = subprocess.run(['git', 'ls-remote', '--exit-code', '--tags', 'origin', f'refs/tags/{tag}'], cwd=ROOT, capture_output=True)
    if remote.returncode != 2:
        raise ValueError('Remote tag exists or remote lookup failed; no files changed')
    (ROOT / GRADLE).write_text(updated)
    subprocess.run(['git', 'add', str(GRADLE)], cwd=ROOT, check=True)
    subprocess.run(['git', 'commit', '-m', f'Release Android v{args.version}', '-m', 'Topic: beta-release-readiness'], cwd=ROOT, check=True)
    subprocess.run(['git', 'tag', '-a', tag, '-m', f'JSTorrent Android {args.version}'], cwd=ROOT, check=True)
    subprocess.run(['git', 'push', '--atomic', 'origin', 'HEAD:refs/heads/main', f'refs/tags/{tag}'], cwd=ROOT, check=True)
    print(f'Release requested: {tag}. Download APK/AAB from its GitHub prerelease after CI passes.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error

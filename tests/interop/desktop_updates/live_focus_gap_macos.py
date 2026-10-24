"""Open an independent editor during a real private macOS update's startup.

The host driver then types untargeted input. This observer never activates the
product or changes update timing. Its editor activates exactly once at setup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time

from live_files import publish_text
from live_migration_crash import uncommitted_wal_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--previous-pid', type=int, required=True)
    parser.add_argument('--executable-sha256', required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    profile = Path.home() / 'Library/Application Support/com.jstorrent.desktop'
    if (sys.platform != 'darwin' or args.previous_pid <= 0
            or not re.fullmatch('[0-9a-f]{64}', args.executable_sha256)
            or not (root / '.jstorrent-update-test').is_file()
            or (profile / '.jstorrent-377-owned-profile').read_text() != str(root)):
        raise ValueError('An owned macOS qualification profile is required')
    executable = root / 'baseline/JSTorrent.app/Contents/MacOS/jstorrent-client'
    database = profile / 'profile/session.db'
    wal = database.with_name(database.name + '-wal')
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline and not (root / 'stop').exists():
        try:
            os.kill(args.previous_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(.05)
    else:
        raise TimeoutError('Owned previous process did not exit')
    while time.monotonic() < deadline and not (root / 'stop').exists():
        rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True).splitlines()
        matches = []
        for row in rows:
            parts = row.strip().split(None, 1)
            if len(parts) == 2 and parts[1].startswith(str(executable) + ' --update-presentation=foreground '):
                matches.append(int(parts[0]))
        if len(matches) == 1 and wal.exists():
            with executable.open('rb') as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            if actual != args.executable_sha256:
                raise ValueError('Installed executable differs from signed candidate')
            pending = uncommitted_wal_bytes(wal)
            if pending > 2 * 1024 * 1024:
                with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=1) as connection:
                    version = connection.execute('PRAGMA user_version').fetchone()[0]
                    if version != 29 or connection.execute("SELECT count(*) FROM sqlite_master WHERE name='qualification_update_probe'").fetchone()[0]:
                        raise ValueError('The private migration already committed')
                if (root / 'editor.pid').exists():
                    raise ValueError('An editor already exists for this interval')
                log = (root / 'editor.log').open('w')
                editor = subprocess.Popen([str(root / 'editor-macos'), str(root)],
                                          stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                log.close()
                ready_deadline = time.monotonic() + 3
                while time.monotonic() < ready_deadline:
                    state = root / 'editor-state.json'
                    if state.exists() and json.loads(state.read_text()).get('active'):
                        publish_text(root / 'focus-gap-ready.json', json.dumps({
                            'at': time.monotonic(), 'oldPid': args.previous_pid,
                            'newPid': matches[0], 'editorPid': editor.pid,
                            'visibleSchema': version, 'uncommittedWalBytes': pending,
                            'installedExecutableMatches': True,
                        }))
                        return
                    time.sleep(.025)
                raise TimeoutError('Independent editor did not activate at setup')
        time.sleep(.05)
    raise TimeoutError('No owned uncommitted startup gap')


if __name__ == '__main__':
    main()

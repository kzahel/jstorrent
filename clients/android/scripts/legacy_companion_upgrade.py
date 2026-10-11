"""Released extension engine/session writers through an owned Android companion."""
from __future__ import annotations
import hashlib
import json
import os
import re
import select
import signal
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path
from legacy_writer_upgrade import FOLDERS, PACKAGE, click, wait_hash

ROOT = Path(__file__).resolve().parents[3]
EXTENSION_URL = 'https://github.com/kzahel/jstorrent-typescript/releases/download/extension-v1.1.1/jstorrent-extension.zip'
EXTENSION_SHA256 = '9366af2f2443d2e50b9ebf5c6b8f3097c8e96c51e386a2779e6896ee149812b6'

class CompanionBrowser:
    def __init__(self, target, directory, evidence_dir=None):
        self.process = None
        old = directory / 'old-extension.zip'
        urllib.request.urlretrieve(EXTENSION_URL, old)
        if hashlib.sha256(old.read_bytes()).hexdigest() != EXTENSION_SHA256:
            raise RuntimeError('legacy extension artifact pin mismatch')
        old_root = directory / 'old-extension'
        new_root = directory / 'new-extension'
        version = json.loads((ROOT / 'clients/extension/manifest.json').read_text())['version']
        for archive, dest in [(old, old_root), (ROOT / f'target/extension/jstorrent-beta-{version}.zip', new_root)]:
            with zipfile.ZipFile(archive) as source:
                for entry in source.infolist():
                    if entry.filename.startswith('/') or '..' in Path(entry.filename).parts: raise RuntimeError('unsafe extension archive')
                source.extractall(dest)
        manifest_path = new_root / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['host_permissions'] += manifest['optional_host_permissions']
        manifest['optional_host_permissions'] = []
        manifest_path.write_text(json.dumps(manifest))
        # Harness grants the exact optional ARC permission before connection.
        # Shipping permission request and CSP remain separately validated.
        # Published CWS archive omits its key; Chromium derives the unpacked ID.
        # Grant only the fixed ARC optional permission as an explicit test action.
        old_port = self.forward(target, 7800)
        new_port = self.forward(target, 3030)
        io_port = self.forward(target, 7801)
        streaming_port = self.forward(target, 7802)
        self.process = subprocess.Popen(['node', str(Path(__file__).with_name('legacy_companion_browser.mjs')), str(directory / 'browser-profile'), str(old_root), str(new_root), str(old_port), str(new_port), str(io_port), str(streaming_port), str(evidence_dir.resolve()) if evidence_dir else '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, start_new_session=True)

    @staticmethod
    def forward(target, port):
        output = target.run(['forward', 'tcp:0', f'tcp:{port}']).stdout.strip()
        return int(output)

    def command(self, op, **values):
        self.process.stdin.write(json.dumps({'op': op, **values}) + '\n'); self.process.stdin.flush()
        if not select.select([self.process.stdout], [], [], 125)[0]: raise RuntimeError(f'browser phase timed out: {op}')
        line = self.process.stdout.readline()
        if not line: raise RuntimeError(f'browser exited: {self.process.poll()}')
        value = json.loads(line)
        if not value['ok']: raise RuntimeError(f'browser {op}: {value}')
        print(json.dumps({'browser_phase': op, 'result': value['result']}), flush=True)
        return value['result']

    def close(self):
        if self.process is None: return
        if self.process.poll() is None:
            try: self.command('close'); self.process.wait(timeout=15)
            except BaseException:
                os.killpg(self.process.pid, signal.SIGTERM)
                try: self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait(timeout=5)
        self.process.stdin.close(); self.process.stdout.close()


def prepare(target, probe, directory, oracle, browser):
    for port in (oracle.seed_port, oracle.server.server_port): target.run(['reverse', f'tcp:{port}', f'tcp:{port}'])
    result = target.shell([f"(printf 'GET /fixture-probe HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n'; sleep 1) | toybox nc -W 3 -w 3 127.0.0.1 {oracle.server.server_port} | head -n 1"])
    response = result.stdout.strip()
    if response != 'HTTP/1.1 200 OK':
        raise RuntimeError('owned emulator tracker is unreachable: ' + response + ' ' + result.stderr)
    print(json.dumps({'tracker_probe': response}), flush=True)
    target.shell(['pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS'], check=False)
    for folder in FOLDERS:
        target.shell(['mkdir', '-p', f'/sdcard/Download/JSTorrent/{folder}'])
        target.shell(['logcat', '-c'])
        target.shell(['am', 'start', '-W', '-n', PACKAGE + '/com.jstorrent.app.AddRootActivity'])
        probe.automate_tree_grant(target, 'internal', folder)
        deadline = time.monotonic() + 30
        while 'Added root: key=' not in target.shell(['logcat', '-d', '-s', 'AddRootActivity:I']).stdout:
            if time.monotonic() >= deadline: raise RuntimeError('legacy picker did not commit root')
            time.sleep(.25)
    target.shell(['am', 'start', '-W', '-n', PACKAGE + '/com.jstorrent.app.MainActivity', '--es', 'force_companion', 'true'])
    browser.command('open-old')
    # Actual released pairing dialog, never injected legacy credentials.
    try: click(target, probe, 'Allow', timeout=45)
    except BaseException:
        browser.command('diagnose')
        raise
    browser.command('old-ready')
    browser.command('mismatch')
    for index, case in enumerate(oracle.cases):
        browser.command('add', torrent=list((directory / f'writer-{index}.torrent').read_bytes()), folder=case['folder'], pause=index == 0)
        if index == 0:
            wait_hash(target, f"/sdcard/Download/JSTorrent/{case['folder']}/{case['name']}", case['sha256'])
        else:
            deadline = time.monotonic() + 60
            while oracle.handles[index].status().total_upload < 16384:
                if time.monotonic() >= deadline: raise RuntimeError('legacy extension did not receive a piece')
                time.sleep(.25)
    time.sleep(3)
    browser.command('save')
    if oracle.handles[1].status().total_upload >= oracle.cases[1]['size']: raise RuntimeError('extension source no longer partial')
    if not target.shell(['pidof', PACKAGE], check=False).stdout.strip(): raise RuntimeError('legacy companion not running')
    uid = re.search(r'uid:(\d+)', target.shell(['pm', 'list', 'packages', '-U', PACKAGE]).stdout)
    if uid is None: raise RuntimeError('old UID unavailable')
    return {'uid': int(uid.group(1)), 'cases': oracle.cases, 'old_process_running': True, 'wifi_only_enabled': False, 'companion_writer': True}


def verify_successor(target, browser, directory):
    log = directory / 'companion-instrumentation.log'
    with log.open('w') as output:
        process = subprocess.Popen([*target.prefix, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'legacyUpgrade', 'true', '-e', 'class', 'org.rstorrent.bootstrap.LegacyAndroidUpgradeTest#serveMigratedCompanion', PACKAGE + '.test/androidx.test.runner.AndroidJUnitRunner'], stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 60
            while target.shell(['run-as', PACKAGE, 'cat', 'cache/t248-companion-ready'], check=False).stdout.strip() != 'ready':
                if process.poll() is not None or time.monotonic() >= deadline: raise RuntimeError('successor companion did not start: ' + log.read_text())
                time.sleep(.25)
            browser.command('open-new')
            browser.command('new-ready')
            browser.command('pause-new')
            target.shell(['run-as', PACKAGE, 'touch', 'cache/t248-companion-finished'])
            process.wait(timeout=45)
            text = log.read_text()
            print(text, flush=True)
            if process.returncode != 0 or 'OK (1 test)' not in text: raise RuntimeError('successor companion assertions failed')
        finally:
            if process.poll() is None: process.terminate(); process.wait(timeout=10)

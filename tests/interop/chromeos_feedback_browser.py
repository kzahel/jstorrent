"""Owned beta-extension view of the feedback386 Android library after removal.

The caller installs this fresh debug package and candidate beta extension.
Setup enables only that owned package's gateway preference. Pairing still uses
real Android approval. This does not qualify production installation/setup.
"""
import subprocess


def run_browser_regression(command):
    source = TARGET_PROGRAM
    result = subprocess.run([*command, 'testbed', '--', 'shell'],
                            input="export PATH=/bin:/usr/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH\npython3 - <<'JSTORRENT386'\n" + source + '\nJSTORRENT386\n',
                            text=True, capture_output=True, timeout=240)
    print(result.stdout, flush=True)
    if result.returncode:
        raise RuntimeError('owned browser restart regression failed: ' + result.stderr[-1500:])


TARGET_PROGRAM = r'''
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import shlex
import subprocess

sys.path.insert(0, '/mnt/stateful_partition/c2')
from cdp import CDP, list_targets, desktop_find, desktop_action

PACKAGE = 'org.jstorrent.feedback386'
EXTENSION = 'gcgoepclopkgijmclmlheafaglmbjlcc'
ACTIVITY = PACKAGE + '/org.rstorrent.bootstrap.MainActivity'


def adb(*args):
    result = subprocess.run(['adb', '-s', '127.0.0.1:5555', *args], stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=25)
    result.check_returncode()
    return result.stdout


def restart():
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    pid = adb('shell', 'pidof', PACKAGE).strip()
    assert re.fullmatch(r'\d+', pid)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        log = adb('logcat', '-d', '--pid', pid, '-s', 'RSTorrentProduct:I')
        found = re.search(r'chromeos_companion_ready port=(303[0-4])', log)
        if found:
            return int(found[1])
        time.sleep(1)
    raise RuntimeError('owned Android gateway not observed')


# No production app preference, credential or catalog is read or written.
adb('shell', 'am', 'force-stop', PACKAGE)
xml = '<map><boolean name="enabled" value="true" /></map>'
adb('shell', 'run-as', PACKAGE, 'sh', '-c', shlex.quote('printf %s ' + shlex.quote(xml) + ' > shared_prefs/chromeos_companion.xml'))
port = restart()
info = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=5))
browser = CDP(info['webSocketDebuggerUrl'])
owned = []


def evaluate(page, expression, *, await_promise=True, gesture=False):
    result = page.call('Runtime.evaluate', expression=expression, returnByValue=True,
                       awaitPromise=await_promise, userGesture=gesture)
    if result.get('exceptionDetails'):
        raise RuntimeError('owned browser expression failed')
    return result.get('result', {}).get('value')


def open_page(path):
    target = browser.call('Target.createTarget', url='about:blank')['targetId']
    owned.append(target)
    entry = next(x for x in list_targets() if x['id'] == target)
    page = CDP(entry['webSocketDebuggerUrl'])
    # Prevent discovery of another app's gateway. Only the port observed from
    # this owned package's process log may be contacted; no network is proxied.
    page.call('Network.enable')
    page.call('Network.setBlockedURLs', urls=[f'http://100.115.92.2:{p}/*' for p in range(3030, 3035) if p != port])
    page.call('Page.navigate', url=f'chrome-extension://{EXTENSION}/{path}')
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if evaluate(page, 'document.readyState') == 'complete':
            return page
        time.sleep(.2)
    page.close()
    raise RuntimeError('owned extension page did not load')


def approve_pairing():
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/jstorrent386-pairing.xml')
    tree = ET.fromstring(adb('shell', 'cat', '/data/local/tmp/jstorrent386-pairing.xml'))
    labels = [n for n in tree.iter() if n.get('text') == 'Approve' and n.get('package') == PACKAGE]
    if len(labels) == 1:
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', labels[0].get('bounds')))
        adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
        return True
    return False


def empty_library(page):
    deadline = time.monotonic() + 65
    approved = False
    while time.monotonic() < deadline:
        state = evaluate(page, '({visible:!document.querySelector("#app").hidden,text:document.querySelector("#app").innerText,status:document.querySelector("#companion-status").innerText})')
        if state['visible'] and re.search(r'No torrents|No torrents yet', state['text'], re.I):
            return
        if not approved and re.search(r'approve', state['status'], re.I):
            approved = approve_pairing()
        time.sleep(1)
    raise RuntimeError('owned extension did not show the empty live library')


try:
    popup = open_page('popup/popup.html')
    try:
        assert evaluate(popup, 'chrome.runtime.id') == EXTENSION
        evaluate(popup, 'globalThis.__grant = null; chrome.permissions.request({origins:["http://100.115.92.2/*"]}).then(value=>globalThis.__grant=value);', await_promise=False, gesture=True)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            granted = evaluate(popup, 'globalThis.__grant')
            if granted is True:
                break
            if granted is False:
                raise RuntimeError('candidate Android permission denied')
            matches = desktop_find('^Allow$', role='button')
            if matches:
                desktop_action('^Allow$', 'doDefault', role='button')
            time.sleep(.5)
        else:
            raise RuntimeError('candidate Android permission did not resolve')
    finally:
        popup.close()
    page = open_page('companion/companion.html')
    try:
        empty_library(page)
    finally:
        page.close()
    browser.call('Target.closeTarget', targetId=owned.pop())
    print(json.dumps({'case': 'physical_extension_removed_torrent_absent', 'result': 'pass'}), flush=True)
    port = restart()
    # Reload the extension itself, replacing its worker as well as its view,
    # while retaining its normal local pairing storage.
    loaded = browser.call('Extensions.loadUnpacked',
                          path='/home/chronos/user/MyFiles/Downloads/jstorrent-feedback386-extension')
    assert loaded['id'] == EXTENSION
    page = open_page('companion/companion.html')
    try:
        empty_library(page)
    finally:
        page.close()
    print(json.dumps({'case': 'physical_extension_reload_after_app_restart_empty', 'result': 'pass'}), flush=True)
finally:
    remaining = {target['id'] for target in list_targets()}
    for target in reversed(owned):
        if target in remaining:
            browser.call('Target.closeTarget', targetId=target)
    browser.close()
    adb('shell', 'rm', '-f', '/data/local/tmp/jstorrent386-pairing.xml')

'''

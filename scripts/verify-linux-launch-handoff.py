#!/usr/bin/env python3
"""Opt-in claimed Linux guest checkpoint; requires dbus, GLib and AT-SPI.
Run through Machine Control user-exec. --work-dir must be task-owned state.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi, GLib

NAME = 'com.jstorrent.rstorrent.SingleInstance'
PATH = '/com/jstorrent/rstorrent/SingleInstance'
INTERFACE = 'org.SingleInstance.DBus'
RETRY = 'org.SingleInstance.Error.Retry'


def wait_for(predicate, timeout=12):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(.02)
    raise AssertionError('state deadline expired')


def report(case, **fields):
    print(json.dumps(dict(case=case, **fields)), flush=True)


class RetryError(dbus.DBusException):
    _dbus_error_name = RETRY


class BusyOwner(dbus.service.Object):
    def __init__(self, bus):
        self.name = dbus.service.BusName(NAME, bus=bus, do_not_queue=True)
        # dbus-python caches BusName objects even after explicit release.
        assert bus.request_name(NAME, dbus.bus.NAME_FLAG_DO_NOT_QUEUE) in (1, 4)
        self.bus, self.calls = bus, 0
        super().__init__(bus, PATH)

    @dbus.service.method(INTERFACE, in_signature='ass', out_signature='')
    def ExecuteCallback(self, arguments, cwd):
        self.calls += 1
        raise RetryError('controlled stopping owner')

    def close(self):
        self.remove_from_connection()
        self.bus.release_name(NAME)


class Checkpoint:
    def __init__(self, executable, root, bus):
        self.executable, self.root, self.bus = executable, root, bus
        self.children, self.logs = [], []
        self.env = dict(os.environ, HOME=str(root / 'home'),
                        XDG_CONFIG_HOME=str(root / 'home/.config'),
                        XDG_DATA_HOME=str(root / 'home/.local/share'),
                        XDG_CACHE_HOME=str(root / 'home/.cache'))
        (root / 'home').mkdir(parents=True, exist_ok=True)

    def launch(self, arguments=(), association=False):
        log = open(self.root / f'launch-{len(self.logs)}.log', 'w')
        self.logs.append(log)
        command = ["xdg-open" if association else self.executable, *arguments]
        child = subprocess.Popen(command, env=self.env,
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        self.children.append(child)
        return child

    def owner(self):
        try:
            return int(dbus.Interface(self.bus.get_object('org.freedesktop.DBus', '/org/freedesktop/DBus'),
                                      'org.freedesktop.DBus').GetConnectionUnixProcessID(NAME))
        except dbus.DBusException:
            return None

    def tray(self):
        watcher = self.bus.get_object('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher')
        items = dbus.Interface(watcher, 'org.freedesktop.DBus.Properties').Get(
            'org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems')
        for item in items:
            if 'rstorrent_tray' in item:
                name, path = str(item).split('@', 1)
                if self.bus.name_has_owner(name):
                    return dbus.Interface(self.bus.get_object(name, path + '/Menu'),
                                          'com.canonical.dbusmenu')
        return None

    def quit(self):
        menu = self.tray()
        assert menu, 'owned tray missing'
        layout = menu.GetLayout(0, -1, dbus.Array([], signature='s'))
        for item in layout[1][2]:
            if str(item[1].get('label', '')).replace('_', '') == 'Quit RSTorrent':
                menu.Event(item[0], 'clicked', dbus.Int32(0), dbus.UInt32(0))
                return
        raise AssertionError('Quit item missing')

    def windows(self, pid):
        desktop, result = Atspi.get_desktop(0), []
        for index in range(desktop.get_child_count()):
            app = desktop.get_child_at_index(index)
            if app.get_process_id() == pid:
                for child_index in range(app.get_child_count()):
                    child = app.get_child_at_index(child_index)
                    if child.get_state_set().contains(Atspi.StateType.SHOWING):
                        result.append(child.get_name())
        return result

    def background(self):
        child = self.launch(['--extension-background'])
        wait_for(self.tray)
        assert self.owner() == child.pid
        assert not self.windows(child.pid)
        return child

    def stop(self):
        if self.tray():
            self.quit()
        for child in self.children:
            child.wait(timeout=12)
        wait_for(lambda: not self.owner() and not self.tray())

    def cleanup(self):
        try:
            self.stop()
        finally:
            for child in self.children:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=12)
            for log in self.logs:
                log.close()


def run(test, iterations, baseline):
    replies = {}
    for _ in range(iterations):
        primary = test.background()
        proxy = test.bus.get_object(NAME, PATH)
        proxy.Introspect(dbus_interface='org.freedesktop.DBus.Introspectable')
        test.quit()
        try:
            proxy.ExecuteCallback(dbus.Array([test.executable], signature='s'),
                                  str(test.root), dbus_interface=INTERFACE, signature='ass')
            result = 'acknowledged'
        except dbus.DBusException as error:
            result = error.get_dbus_name()
        replies[result] = replies.get(result, 0) + 1
        primary.wait(timeout=12)
        wait_for(lambda: not test.tray())
    report('post-quit-ipc', attempts=iterations, replies=replies)
    if baseline:
        assert replies.get('acknowledged', 0), 'baseline loss not observed'
        return
    assert replies.get(RETRY, 0), 'no shutdown retry observed'

    # Scripted installed transport evidence, separate from real tray Quit.
    fixture = BusyOwner(test.bus)
    try:
        child = test.launch(['--extension-background'])
        wait_for(lambda: fixture.calls >= 3)
        assert child.poll() is None and test.owner() == os.getpid()
    finally:
        fixture.close()
    wait_for(test.tray)
    assert test.owner() == child.pid and not test.windows(child.pid)
    report('installed-launch-retry', replies=fixture.calls, one_owner=True, windowless=True)
    test.stop()

    fixture = BusyOwner(test.bus)
    try:
        start = time.monotonic()
        refused = test.launch()
        assert refused.wait(timeout=12) != 0
        assert test.owner() == os.getpid() and not test.tray()
        report('installed-launch-timeout', seconds=round(time.monotonic() - start, 3),
               replies=fixture.calls, refused=True)
    finally:
        fixture.close()

    torrent = test.root / 'controlled.torrent'
    torrent.write_bytes(b'd4:infod6:lengthi0e4:name10:empty.file12:piece lengthi16384e6:pieces0:ee')
    for arguments, label in [([], 'native'), (['--extension-background'], 'background'),
                             (['magnet:?xt=urn:btih:' + '0' * 40], 'magnet'),
                             ([str(torrent)], 'torrent-file')]:
        primary = test.background()
        test.quit()
        successor = test.launch(arguments)
        primary.wait(timeout=12)
        wait_for(test.tray)
        assert successor.poll() is None and test.owner() == successor.pid
        if label != 'background':
            wait_for(lambda: test.windows(successor.pid))
        else:
            assert not test.windows(successor.pid)
        report('quit-full-launch', intent=label, replacement=True,
               native_windows=len(test.windows(successor.pid)))
        test.stop()

    for value, label in [('magnet:?xt=urn:btih:' + '0' * 40, 'magnet'),
                         (str(torrent), 'torrent-file')]:
        primary = test.background()
        test.quit()
        launcher = test.launch([value], association=True)
        assert launcher.wait(timeout=12) == 0
        primary.wait(timeout=12)
        wait_for(test.tray)
        owner = test.owner()
        assert owner and owner != primary.pid
        wait_for(lambda: test.windows(owner))
        report('quit-xdg-open', intent=label, replacement=True, native_windows=len(test.windows(owner)))
        test.stop()

    contenders = [test.launch(['--extension-background']) for _ in range(12)]
    wait_for(test.tray)
    owner = test.owner()
    assert owner in [child.pid for child in contenders]
    for child in contenders:
        if child.pid != owner:
            assert child.wait(timeout=12) == 0
    assert sum(child.poll() is None for child in contenders) == 1
    assert not test.windows(owner)
    native = test.launch()
    assert native.wait(timeout=12) == 0
    wait_for(lambda: test.windows(owner))
    assert test.owner() == owner
    report('concurrent-and-warm', launches=12, owners=1, native_window=True)
    test.stop()
    time.sleep(35)
    assert not test.owner() and not test.tray()
    report('quit-without-intent', seconds=35, stopped=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable', required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--iterations', type=int, default=12)
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    assert 1 <= args.iterations <= 64
    DBusGMainLoop(set_as_default=True)
    dbus.mainloop.glib.threads_init()
    bus = dbus.SessionBus()
    assert not bus.name_has_owner(NAME), 'preserve inherited runtime; stop test'
    loop = GLib.MainLoop()
    thread = threading.Thread(target=loop.run, daemon=True)
    thread.start()
    test = Checkpoint(args.executable, args.work_dir.resolve(), bus)
    try:
        run(test, args.iterations, args.baseline)
    finally:
        try:
            test.cleanup()
        finally:
            loop.quit()
            thread.join(timeout=5)
            assert not thread.is_alive()


if __name__ == '__main__':
    main()

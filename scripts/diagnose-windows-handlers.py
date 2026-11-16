"""Read Windows launch registration independently of browser web handlers.

--repair-legacy retargets only verified per-user Inno classes, with a receipt.
--restore RECEIPT restores only values still equal to this repair's writes.
Never touches UserChoice, browser profiles, native manifests or user data.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import winreg as w

CLASSES = ('JSTorrent.Magnet', 'JSTorrent.Torrent')
INNO = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}_is1'
VIEWS = (w.KEY_WOW64_64KEY, w.KEY_WOW64_32KEY)


def value(root, path, name='', view=VIEWS[0]):
    try:
        with w.OpenKey(root, path, 0, w.KEY_READ | view) as key:
            return w.QueryValueEx(key, name)[0]
    except FileNotFoundError:
        return None


def effective():
    from ctypes import wintypes as t
    query = ctypes.windll.Shlwapi.AssocQueryStringW
    query.argtypes = [t.DWORD, t.DWORD, t.LPCWSTR, t.LPCWSTR, t.LPWSTR, ctypes.POINTER(t.DWORD)]
    result = {}
    for association in ('.torrent', 'magnet', 'jstorrent'):
        result[association] = {}
        for kind, label in ((1, 'command'), (2, 'executable'), (20, 'progid')):
            size = t.DWORD(32768)
            buffer = ctypes.create_unicode_buffer(size.value)
            status = query(0, kind, association, 'open', buffer, ctypes.byref(size))
            result[association][label] = buffer.value if status == 0 else None
    return result


def inventory():
    rows = []
    classes = (*CLASSES, '.torrent', 'magnet', 'jstorrent', 'com.jstorrent.desktop.torrent', 'com.jstorrent.desktop.magnet')
    entries = [(rf'Software\Classes\{name}{suffix}', '') for name in classes
               for suffix in ('', r'\shell\open\command', r'\DefaultIcon')]
    entries += [(INNO, name) for name in ('DisplayName', 'DisplayVersion', 'InstallLocation')]
    entries += [(r'Software\Microsoft\Windows\CurrentVersion\Uninstall\JSTorrent', name)
                for name in ('DisplayName', 'DisplayVersion', 'InstallLocation')]
    entries += [(r'Software\RegisteredApplications', name) for name in ('JSTorrent', 'JSTorrentDesktop')]
    choices = [r'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.torrent']
    choices += [rf'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\{name}'
                for name in ('magnet', 'jstorrent')]
    entries += [(base + suffix, 'ProgId') for base in choices
                for suffix in (r'\UserChoice', r'\UserChoiceLatest\ProgId')]
    for base in (r'Software\JSTorrent\Capabilities', r'Software\JSTorrent\DesktopCapabilities'):
        entries += [(base, 'ApplicationDescription'), (base + r'\FileAssociations', '.torrent')]
        entries += [(base + r'\UrlAssociations', name) for name in ('magnet', 'jstorrent')]
    for browser in (r'Google\Chrome', 'Chromium', r'Microsoft\Edge', r'BraveSoftware\Brave-Browser'):
        entries += [(rf'Software\{browser}\NativeMessagingHosts\{name}', '')
                    for name in ('com.jstorrent.native', 'com.jstorrent.rstorrent.native')]
    for scope, root in (('HKCU', w.HKEY_CURRENT_USER), ('HKLM', w.HKEY_LOCAL_MACHINE)):
        for view in VIEWS:
            for path, name in entries:
                data = value(root, path, name, view)
                if data is not None:
                    rows.append(dict(scope=scope, view=64 if view == VIEWS[0] else 32, path=path, name=name, value=data))
    return dict(effective=effective(), registry=rows)


def repair(receipt):
    if receipt.exists():
        raise RuntimeError('receipt already exists; refusing to overwrite rollback data')
    executable = Path(os.environ['LOCALAPPDATA']) / 'JSTorrent' / 'jstorrent-client.exe'
    install_key = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\JSTorrent'
    installed = value(w.HKEY_CURRENT_USER, install_key, 'InstallLocation')
    if (not executable.is_file() or not installed
            or Path(installed.strip(chr(34))) != executable.parent
            or value(w.HKEY_CURRENT_USER, install_key, 'DisplayName') != 'JSTorrent'):
        raise RuntimeError('current per-user client missing')
    changes = []
    for view in VIEWS:
        directory = value(w.HKEY_CURRENT_USER, INNO, 'InstallLocation', view)
        if not directory or value(w.HKEY_CURRENT_USER, INNO, 'DisplayName', view) != 'JSTorrent Native Host version 0.1.0':
            continue
        old = f'"{Path(directory) / "JSTorrent Link Handler.exe"}" "%1"'
        for name in CLASSES:
            base = rf'Software\Classes\{name}'
            command = base + r'\shell\open\command'
            if value(w.HKEY_CURRENT_USER, command, view=view) != old:
                continue
            for path, after in ((command, f'"{executable}" "%1"'),
                                (base + r'\DefaultIcon', f'"{executable}",0')):
                changes.append(dict(path=path, view=view, before=value(w.HKEY_CURRENT_USER, path, view=view), after=after))
    # Shared HKCU classes can appear in both views. Snapshot before any write.
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(dict(before=inventory(), changes=changes), indent=2), encoding='utf-8')
    for change in changes:
        with w.CreateKeyEx(w.HKEY_CURRENT_USER, change['path'], 0, w.KEY_WRITE | change['view']) as key:
            w.SetValueEx(key, '', 0, w.REG_SZ, change['after'])
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
    print(json.dumps(dict(changed_values=len(changes), receipt=str(receipt), effective=effective()), indent=2))


def restore(receipt):
    changes = json.loads(receipt.read_text(encoding='utf-8'))['changes']
    allowed = {rf'Software\Classes\{name}{suffix}' for name in CLASSES
               for suffix in (r'\shell\open\command', r'\DefaultIcon')}
    if len(changes) > 8 or any(change['path'] not in allowed or change['view'] not in VIEWS
                               for change in changes):
        raise RuntimeError('receipt contains a value outside the legacy class repair')
    for change in changes:
        current = value(w.HKEY_CURRENT_USER, change['path'], view=change['view'])
        if current not in (change['before'], change['after']):
            raise RuntimeError('registration changed since repair; refusing rollback')
    for change in changes:
        with w.OpenKey(w.HKEY_CURRENT_USER, change['path'], 0, w.KEY_WRITE | change['view']) as key:
            if change['before'] is None:
                w.DeleteValue(key, '')
            else:
                w.SetValueEx(key, '', 0, w.REG_SZ, change['before'])
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--repair-legacy', type=Path, metavar='RECEIPT')
    group.add_argument('--restore', type=Path, metavar='RECEIPT')
    args = parser.parse_args()
    if args.repair_legacy:
        repair(args.repair_legacy)
    elif args.restore:
        restore(args.restore)
    else:
        print(json.dumps(inventory(), indent=2))

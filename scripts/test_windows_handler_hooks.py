"""Execute shipping NSIS hooks in a disposable registry namespace, never HKCR.

Synthetic cohorts only; this does not qualify a released installer upgrade.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid
if sys.platform == 'win32':
    import winreg as w

HOOK = Path(__file__).resolve().parents[1] / 'clients/desktop/src-tauri/nsis/jstorrent-hooks.nsh'


@unittest.skipUnless(sys.platform == 'win32', 'requires Windows registry and NSIS')
class HandlerHooks(unittest.TestCase):
    def test_owned_cohorts_other_client_idempotence_and_uninstall(self):
        prefix = 'Software\\JSTorrentHandlerTest-' + uuid.uuid4().hex
        with tempfile.TemporaryDirectory(prefix='jstorrent-handler-test-') as temporary:
            directory = Path(temporary)
            current = str(directory / 'Current App ☃')
            inno = str(directory / 'Legacy App') + '\\'
            command = f'"{current}\\jstorrent-client.exe" "%1"'
            source = HOOK.read_text(encoding='utf-8').replace('Software\\', prefix + '\\')
            both_hosts = HOOK.with_name('native-host-ownership.nsh').read_text(encoding='utf-8')
            both_hosts = both_hosts.replace('Software\\', prefix + '\\').replace('$APPDATA', str(directory))
            (directory / 'native-host-ownership.nsh').write_text(both_hosts, encoding='utf-8-sig')
            source = source.replace('$APPDATA\\com.jstorrent.desktop\\native-host', str(directory / 'com.jstorrent.desktop' / 'native-host'))
            (directory / 'hooks.nsh').write_text(source, encoding='utf-8-sig')
            preview = HOOK.with_name('hooks.nsh').read_text(encoding='utf-8')
            preview = preview.replace('Software\\', prefix + '\\').replace('$APPDATA', str(directory))
            (directory / 'preview-hooks.nsh').write_text(preview, encoding='utf-8-sig')
            compiler = Path(os.environ['LOCALAPPDATA']) / 'tauri/NSIS/makensis.exe'
            for phase in ('POSTINSTALL', 'POSTUNINSTALL', 'PREVIEW-POSTUNINSTALL'):
                script = directory / (phase + '.nsi')
                hook_source = directory / ('preview-hooks.nsh' if phase.startswith('PREVIEW-') else 'hooks.nsh')
                generated = ''
                if phase == 'POSTINSTALL':
                    generated = f'''!insertmacro NSIS_HOOK_PREINSTALL
WriteRegStr SHCTX "{prefix}\\Classes\\.torrent" "" "com.jstorrent.desktop.torrent"
WriteRegStr SHCTX "{prefix}\\Classes\\magnet" "" "URL:com.jstorrent.desktop protocol"
WriteRegStr SHCTX "{prefix}\\Classes\\magnet" "URL Protocol" ""
WriteRegStr SHCTX "{prefix}\\Classes\\magnet\\DefaultIcon" "" "generated icon"
WriteRegStr SHCTX "{prefix}\\Classes\\magnet\\shell\\open\\command" "" '$\\"$INSTDIR\\jstorrent-client.exe$\\" $\\"%1$\\"'
'''
                script.write_text(f'''Unicode true
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!define MAINBINARYNAME "jstorrent-client"
!include "{hook_source}"
OutFile "{directory / (phase + '.exe')}"
Section
SetShellVarContext current
StrCpy $INSTDIR "{current}"
{generated}
!insertmacro NSIS_HOOK_{phase.removeprefix('PREVIEW-')}
SectionEnd
''', encoding='utf-8-sig')
                subprocess.run([str(compiler), '/V2', str(script)], check=True, capture_output=True)

            def put(path, data, name=''):
                with w.CreateKey(w.HKEY_CURRENT_USER, prefix + '\\' + path) as key:
                    w.SetValueEx(key, name, 0, w.REG_SZ, data)

            def get(path, name=''):
                try:
                    with w.OpenKey(w.HKEY_CURRENT_USER, prefix + '\\' + path) as key:
                        return w.QueryValueEx(key, name)[0]
                except FileNotFoundError:
                    return None

            def remove(path):
                try:
                    with w.OpenKey(w.HKEY_CURRENT_USER, path) as key:
                        names = [w.EnumKey(key, i) for i in range(w.QueryInfoKey(key)[0])]
                    for name in names:
                        remove(path + '\\' + name)
                    w.DeleteKey(w.HKEY_CURRENT_USER, path)
                except FileNotFoundError:
                    pass

            def run(phase):
                subprocess.run([str(directory / (phase + '.exe')), '/S'], check=True, timeout=30)

            try:
                inno_key = r'Microsoft\Windows\CurrentVersion\Uninstall\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}_is1'
                put(inno_key, inno, 'InstallLocation')
                torrent = r'Classes\JSTorrent.Torrent\shell\open\command'
                magnet = r'Classes\JSTorrent.Magnet\shell\open\command'
                foreign = '"C:\\Other Client\\other.exe" "%1"'
                put(torrent, f'"{inno}JSTorrent Link Handler.exe" "%1"')
                put(magnet, foreign)
                put(r'Classes\.torrent', 'OtherClient.Torrent')
                put(r'Classes\magnet\shell\open\command', foreign)
                run('POSTINSTALL')
                self.assertEqual(get(torrent), command)
                self.assertEqual(get(magnet), foreign)
                self.assertEqual(get(r'Classes\.torrent'), 'OtherClient.Torrent')
                self.assertEqual(get(r'Classes\magnet\shell\open\command'), foreign)
                self.assertIsNone(get(r'Classes\magnet', 'URL Protocol'))
                self.assertIsNone(get(r'Classes\magnet\DefaultIcon'))
                self.assertEqual(get(r'JSTorrent\DesktopCapabilities\FileAssociations', '.torrent'), 'com.jstorrent.desktop.torrent')
                self.assertEqual(get(r'Classes\com.jstorrent.desktop.torrent\shell\open\command'), command)
                run('POSTINSTALL')
                self.assertEqual(get(torrent), command)
                self.assertEqual(get(magnet), foreign)
                run('POSTUNINSTALL')
                self.assertIsNone(get(torrent))
                self.assertEqual(get(magnet), foreign)
                self.assertIsNone(get(r'RegisteredApplications', 'JSTorrentDesktop'))
                browsers = (r'Google\Chrome', 'Chromium', r'BraveSoftware\Brave-Browser', r'Microsoft\Edge')
                current_host, legacy_host = 'com.jstorrent.rstorrent.native', 'com.jstorrent.native'
                production, preview = 'com.jstorrent.desktop', 'com.jstorrent.rstorrent'

                def registration(browser, host):
                    return rf'{browser}\NativeMessagingHosts\{host}'

                def manifest(identity, host):
                    return str(directory / identity / 'native-host' / f'{host}.json')

                chrome = registration(browsers[0], current_host)
                chromium = registration(browsers[1], current_host)
                put(chrome, manifest(preview, current_host))
                put(chromium, manifest(production, current_host))
                for browser in browsers:
                    put(registration(browser, legacy_host), manifest(production, legacy_host))
                run('POSTUNINSTALL')
                self.assertEqual(get(chrome), manifest(preview, current_host))
                self.assertIsNone(get(chromium))
                for browser in browsers:
                    self.assertIsNone(get(registration(browser, legacy_host)))
                foreign_legacy = str(directory / 'Other manifest' / f'{legacy_host}.json')
                put(registration(browsers[0], legacy_host), foreign_legacy)
                run('POSTUNINSTALL')
                self.assertEqual(get(registration(browsers[0], legacy_host)), foreign_legacy)
                put(chromium, manifest(production, current_host))
                run('PREVIEW-POSTUNINSTALL')
                self.assertIsNone(get(chrome))
                self.assertEqual(get(chromium), manifest(production, current_host))
                for binary in ('JSTorrent Link Handler.exe', 'jstorrent-desktop.exe'):
                    put(magnet, f'"{current}\\{binary}" "%1"')
                    run('POSTINSTALL')
                    self.assertEqual(get(magnet), command)
                put(r'RegisteredApplications', prefix + r'\JSTorrent\Capabilities', 'JSTorrent')
                put(r'JSTorrent\Capabilities\FileAssociations', 'JSTorrent.Torrent', '.torrent')
                put(r'JSTorrent\Capabilities\UrlAssociations', 'JSTorrent.Magnet', 'magnet')
                put(torrent, command)
                run('POSTINSTALL')
                self.assertIsNone(get(r'RegisteredApplications', 'JSTorrent'))
                put(r'Classes\magnet\shell\open\command', f'"{inno}JSTorrent Link Handler.exe" "%1"')
                run('POSTINSTALL')
                self.assertEqual(get(r'Classes\magnet\shell\open\command'), command)
                put(magnet, foreign)
                put(r'Classes\com.jstorrent.desktop.magnet\shell\open\command', foreign)
                put(r'RegisteredApplications', 'OtherCapabilities', 'JSTorrentDesktop')
                run('POSTUNINSTALL')
                self.assertEqual(get(magnet), foreign)
                self.assertEqual(get(r'RegisteredApplications', 'JSTorrentDesktop'), 'OtherCapabilities')
            finally:
                # The only recursive deletion target is this generated test key.
                assert prefix.startswith('Software\\JSTorrentHandlerTest-')
                remove(prefix)


if __name__ == '__main__':
    unittest.main()

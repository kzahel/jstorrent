"""Scoped installation registry preservation shared by owned Windows rehearsals."""
from pathlib import Path

WIN_BROWSERS = (r"Google\Chrome", "Chromium", r"BraveSoftware\Brave-Browser", r"Microsoft\Edge")


class Registry:
    """Save/restore only installation/association/native-host HKCU scopes."""
    def __init__(self):
        import winreg
        self.api = winreg
        self.saved = []
        self.parents = []
        keys = [r"Software\jstorrent", r"Software\RSTorrent",
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\JSTorrent",
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\RSTorrent"]
        keys += ["Software\\Classes\\" + name for name in (
            "magnet", "jstorrent", ".torrent", "torrent", "torrentfile", "JSTorrent.torrent", "RSTorrent.torrent",
            "com.jstorrent.desktop.torrent", "com.jstorrent.rstorrent.torrent", r"Applications\JSTorrent.exe", r"Applications\jstorrent-desktop.exe",
            r"Applications\rstorrent-desktop.exe", r"Applications\jstorrent-client.exe")]
        for browser in WIN_BROWSERS:
            keys += [rf"Software\{browser}\NativeMessagingHosts\{name}" for name in
                     ("com.jstorrent.native", "com.jstorrent.rstorrent.native")]
        for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
            for key in keys:
                self.saved.append((key, view, self.read(key, view)))
            parents = {"\\".join(key.split("\\")[:depth]) for key in keys
                       for depth in range(1, len(key.split("\\")))}
            for path in sorted(parents, key=lambda path: path.count("\\"), reverse=True):
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ | view):
                        pass
                except FileNotFoundError:
                    self.parents.append((path, view))

    def isolate_installation(self):
        # Never let an NSIS reinstall follow inherited uninstaller paths.
        w = self.api
        for view in (w.KEY_WOW64_32KEY, w.KEY_WOW64_64KEY):
            for path in (r"Software\jstorrent\JSTorrent",
                         r"Software\Microsoft\Windows\CurrentVersion\Uninstall\JSTorrent"):
                try:
                    with w.OpenKey(w.HKEY_LOCAL_MACHINE, path, 0, w.KEY_READ | view):
                        raise RuntimeError("machine-wide legacy installation requires a separate rehearsal")
                except FileNotFoundError:
                    pass
        for view in (w.KEY_WOW64_32KEY, w.KEY_WOW64_64KEY):
            self.delete(r"Software\jstorrent\JSTorrent", view)
            self.delete(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\JSTorrent", view)

    def read(self, path, view):
        w = self.api
        try:
            with w.OpenKey(w.HKEY_CURRENT_USER, path, 0, w.KEY_READ | view) as key:
                subkeys, values, _ = w.QueryInfoKey(key)
                return ([w.EnumValue(key, i) for i in range(values)],
                        {w.EnumKey(key, i): self.read(path + "\\" + w.EnumKey(key, i), view)
                         for i in range(subkeys)})
        except FileNotFoundError:
            return None

    def delete(self, path, view):
        w = self.api
        try:
            with w.OpenKey(w.HKEY_CURRENT_USER, path, 0, w.KEY_READ | view) as key:
                children = [w.EnumKey(key, i) for i in range(w.QueryInfoKey(key)[0])]
            for child in children:
                self.delete(path + "\\" + child, view)
            w.DeleteKeyEx(w.HKEY_CURRENT_USER, path, view)
        except FileNotFoundError:
            pass

    def write(self, path, view, state):
        if state is None:
            return
        w = self.api
        values, children = state
        with w.CreateKeyEx(w.HKEY_CURRENT_USER, path, 0, w.KEY_WRITE | view) as key:
            for name, value, kind in values:
                w.SetValueEx(key, name, 0, kind, value)
        for name, child in children.items():
            self.write(path + "\\" + name, view, child)

    def restore(self):
        # The 32/64 views share some HKCU keys; restore both before comparing.
        for path, view, state in self.saved:
            self.delete(path, view)
            self.write(path, view, state)
        assert all(self.read(path, view) == state for path, view, state in self.saved)
        for path, view in self.parents:
            try:
                with self.api.OpenKey(self.api.HKEY_CURRENT_USER, path, 0,
                                      self.api.KEY_READ | view) as key:
                    subkeys, values, _ = self.api.QueryInfoKey(key)
                    assert subkeys == values == 0, "new registry parent contains unexpected state"
                self.api.DeleteKeyEx(self.api.HKEY_CURRENT_USER, path, view)
            except FileNotFoundError:
                pass

    def manifests(self):
        w = self.api
        for view in (w.KEY_WOW64_32KEY, w.KEY_WOW64_64KEY):
            for browser in WIN_BROWSERS:
                path = rf"Software\{browser}\NativeMessagingHosts\com.jstorrent.native"
                with w.OpenKey(w.HKEY_CURRENT_USER, path, 0, w.KEY_READ | view) as key:
                    yield Path(w.QueryValueEx(key, "")[0])


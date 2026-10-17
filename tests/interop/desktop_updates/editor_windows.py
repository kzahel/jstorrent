"""Disposable independent keyboard oracle; never refocuses during an update."""
import argparse
import os
import ctypes
ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
from pathlib import Path
import tkinter as tk
from live_files import publish_text

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
args = parser.parse_args()
window = tk.Tk()
window.title("JSTorrent update keyboard oracle")
window.geometry("700x420+80+80")
text = tk.Text(window)
text.pack(fill="both", expand=True)


last_published = None


def snapshot():
    global last_published
    value = text.get("1.0", "end-1c")
    if value != last_published and publish_text(args.root / "editor.txt", value):
        last_published = value


def tick():
    snapshot()
    # Setup only: expose the editor for a genuine untargeted click. Release
    # topmost and verify the native style before the critical interval.
    if not (args.root / "offer").exists():
        if (args.root / "raise-editor").exists():
            window.attributes("-topmost", True)
            window.lift()
            (args.root / "raise-editor").unlink()
            (args.root / "editor-raised").write_text("ready")
        if (args.root / "normalize-editor").exists():
            window.attributes("-topmost", False)
            window.update_idletasks()
            from ctypes import wintypes
            user = ctypes.windll.user32
            user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
            user.GetAncestor.restype = wintypes.HWND
            user.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
            user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            hwnd = user.GetAncestor(text.winfo_id(), 2)
            if not user.GetWindowLongPtrW(hwnd, -20) & 8:
                (args.root / "editor-normal").write_text("not-topmost")
                (args.root / "normalize-editor").unlink()
    if (args.root / "stop").exists():
        window.destroy()
    else:
        window.after(100, tick)


(args.root / "editor.txt").write_text("")
(args.root / "editor.pid").write_text(str(os.getpid()))
def ready():
    import json
    from ctypes import wintypes
    if not text.winfo_ismapped():
        window.after(100, ready)
        return
    point = wintypes.POINT(30, 30)
    ctypes.windll.user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    if not ctypes.windll.user32.ClientToScreen(text.winfo_id(), ctypes.byref(point)):
        raise ctypes.WinError()
    (args.root / "editor-ready.json").write_text(json.dumps({"pid": os.getpid(), "x": point.x, "y": point.y, "mapped": True}))
window.after(500, ready)
text.focus_set()
window.after(100, tick)
window.mainloop()

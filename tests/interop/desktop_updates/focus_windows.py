"""Native foreground events and bounded visible-window observations in the guest."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import time
from live_files import publish_text

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
user = c.WinDLL("user32", use_last_error=True)
kernel = c.WinDLL("kernel32", use_last_error=True)
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
kernel.QueryFullProcessImageNameW.restype = w.BOOL
kernel.CloseHandle.argtypes = [w.HANDLE]
user.GetForegroundWindow.restype = w.HWND
user.UnhookWinEvent.argtypes = [w.HANDLE]
user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
user.IsWindowVisible.argtypes = [w.HWND]
user.IsIconic.argtypes = [w.HWND]
user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetWindowLongPtrW.argtypes = [w.HWND, c.c_int]
user.GetWindowLongPtrW.restype = c.c_ssize_t
events = (root / "focus.jsonl").open("w", buffering=1)


def write(value):
    events.write(json.dumps(dict(value, at=time.monotonic())) + "\n")


def identity(hwnd):
    pid = w.DWORD()
    user.GetWindowThreadProcessId(hwnd, c.byref(pid))
    watched = False
    handle = kernel.OpenProcess(0x1000, False, pid.value)
    if handle:
        try:
            path = c.create_unicode_buffer(32768)
            size = w.DWORD(len(path))
            if kernel.QueryFullProcessImageNameW(handle, 0, path, c.byref(size)):
                watched = path.value.lower().startswith(str(root).lower() + "\\")
        finally:
            kernel.CloseHandle(handle)
    title = c.create_unicode_buffer(1024)
    user.GetWindowTextW(hwnd, title, len(title))
    return pid.value, watched or ("JSTorrent" in title.value and title.value != "JSTorrent update keyboard oracle")


EVENT = c.WINFUNCTYPE(None, w.HANDLE, w.DWORD, w.HWND, w.LONG, w.LONG, w.DWORD, w.DWORD)


@EVENT
def foreground(_hook, _event, hwnd, _object, _child, _thread, _timestamp):
    pid, watched = identity(hwnd)
    write({"kind": "focus", "pid": pid, "watched": watched, "critical": (root / "offer").exists()})


user.SetWinEventHook.argtypes = [w.DWORD, w.DWORD, w.HMODULE, EVENT, w.DWORD, w.DWORD, w.DWORD]
user.SetWinEventHook.restype = w.HANDLE
hook = user.SetWinEventHook(3, 3, None, foreground, 0, 0, 0)
if not hook:
    raise c.WinError(c.get_last_error())
ENUM = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
user.EnumWindows.argtypes = [ENUM, w.LPARAM]
previous = []
last_tick = time.monotonic()
max_gap = 0.0
deadline = last_tick + 1200
TIMER = c.WINFUNCTYPE(None, w.HWND, w.UINT, c.c_size_t, w.DWORD)


@TIMER
def tick(_window, _message, _timer, _time):
    global previous, last_tick, max_gap
    now = time.monotonic()
    max_gap = max(max_gap, now - last_tick)
    last_tick = now
    visible = []
    minimized = []

    @ENUM
    def visit(hwnd, _parameter):
        if user.IsWindowVisible(hwnd) or user.IsIconic(hwnd):
            pid, watched = identity(hwnd)
            if watched:
                native_class = c.create_unicode_buffer(1024)
                user.GetClassNameW(hwnd, native_class, len(native_class))
                # Locked Tao 0.35.3 and single-instance 2.4.3 create transparent
                # message targets with WS_VISIBLE only to receive WM_PAINT.
                # Require their exact class AND all four non-presenting styles.
                infrastructure = native_class.value in (
                    "Tao Thread Event Target", "com.jstorrent.qualification.update-sic", "com.jstorrent.desktop-sic")
                utility_styles = 0x08000000 | 0x00080000 | 0x20 | 0x80
                styles = user.GetWindowLongPtrW(hwnd, -20)
                if infrastructure and styles & utility_styles == utility_styles:
                    return True
                rows = minimized if user.IsIconic(hwnd) else visible
                rows.append({"hwnd": int(hwnd), "pid": pid, "nativeClass": native_class.value, "visible": bool(user.IsWindowVisible(hwnd))})
        return True

    user.EnumWindows(visit, 0)
    if visible != previous:
        previous = visible
        write({"kind": "visibility", "windows": visible, "critical": (root / "offer").exists()})
    pid, watched = identity(user.GetForegroundWindow())
    publish_text(root / "foreground.json", json.dumps({"pid": pid, "watched": watched, "maxSampleGap": max_gap, "minimizedWindows": minimized}))
    if (root / "stop").exists() or now >= deadline:
        write({"kind": "finished", "maxSampleGap": max_gap})
        user.PostQuitMessage(0)


user.SetTimer.argtypes = [w.HWND, c.c_size_t, w.UINT, TIMER]
user.SetTimer.restype = c.c_size_t
timer = user.SetTimer(None, 0, 25, tick)
if not timer:
    raise c.WinError(c.get_last_error())
write({"kind": "ready", "visibilitySampleMillis": 25})
message = w.MSG()
while user.GetMessageW(c.byref(message), None, 0, 0) > 0:
    user.TranslateMessage(c.byref(message))
    user.DispatchMessageW(c.byref(message))
user.UnhookWinEvent(hook)
events.close()

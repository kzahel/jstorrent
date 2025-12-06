#!/usr/bin/env python3
"""
ChromeOS Input Control - Keyboard, Mouse, Touchscreen, and Screenshots
Run on ChromeOS VT2 (Ctrl+Alt+F2) as root.

Usage:
    python3 input.py screenshot              # Take screenshot, copy to .c2/latest.png
    python3 input.py key <keycode> [...]     # Press key(s) - e.g., key 125 63 for Search+F5
    python3 input.py type <text>             # Type text (a-z, 0-9, space, enter only)

    # Touchscreen (RECOMMENDED - precise absolute coordinates):
    python3 input.py tap <x> <y>             # Tap at screen coordinates
    python3 input.py tap <x> <y> --browser   # Tap at browser window coordinates (adds chrome offset)
    python3 input.py swipe <x1> <y1> <x2> <y2>         # Swipe (screen coords)
    python3 input.py swipe <x1> <y1> <x2> <y2> --browser  # Swipe (browser coords)
    python3 input.py resolution [W H]        # Show or set screen resolution (default 1600x900)

    # Mouse (relative - less precise due to acceleration):
    python3 input.py move <dx> <dy>          # Move mouse by relative amount
    python3 input.py click [left|right|middle]  # Click mouse button
    python3 input.py drag <dx> <dy>          # Drag (hold left, move, release)

Coordinates: Use screenshot pixel coordinates (e.g., 4K = 3840x2160).
    The tap coordinates map directly to screenshot pixels.

Device-specific settings (in code):
    TOUCHSCREEN_DEV = /dev/input/event6
    TS_MAX_X, TS_MAX_Y = 3492, 1968
    SCREEN = 3840x2160 (auto-detected from screenshots)
"""

import os
import sys
import struct
import time
import glob
import shutil
import fcntl
import array

# === Constants ===
KEYBOARD_DEV = "/dev/input/event2"
UINPUT_DEV = "/dev/uinput"

# Event types
EV_SYN, EV_KEY, EV_REL, EV_ABS, EV_MSC = 0, 1, 2, 3, 4

# Relative axes
REL_X, REL_Y = 0, 1

# Absolute axes
ABS_X, ABS_Y = 0, 1

# Mouse buttons
BTN_LEFT, BTN_RIGHT, BTN_MIDDLE = 272, 273, 274
BTN_TOUCH = 330

# uinput ioctls
UI_SET_EVBIT = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_SET_RELBIT = 0x40045566
UI_SET_ABSBIT = 0x40045567
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502

# Screen resolution - use 4K native resolution (screenshots are 4K)
# The display is 4K but scaled, but screenshots capture at native resolution
SCREEN_WIDTH = 3840
SCREEN_HEIGHT = 2160
RESOLUTION_FILE = "/home/chronos/user/MyFiles/Downloads/WSC/.c2/resolution.txt"

def get_resolution():
    """Get screen resolution from file or auto-detect from latest screenshot."""
    global SCREEN_WIDTH, SCREEN_HEIGHT
    # Try to read from file first
    try:
        with open(RESOLUTION_FILE, 'r') as f:
            parts = f.read().strip().split()
            if len(parts) == 2:
                SCREEN_WIDTH, SCREEN_HEIGHT = int(parts[0]), int(parts[1])
                return SCREEN_WIDTH, SCREEN_HEIGHT
    except:
        pass

    # Try to detect from latest screenshot
    try:
        from PIL import Image
        latest = get_latest_screenshot() if 'get_latest_screenshot' in dir() else None
        if latest:
            img = Image.open(latest)
            SCREEN_WIDTH, SCREEN_HEIGHT = img.size
    except:
        pass

    return SCREEN_WIDTH, SCREEN_HEIGHT

def set_resolution(w, h):
    """Save screen resolution to file."""
    global SCREEN_WIDTH, SCREEN_HEIGHT
    SCREEN_WIDTH, SCREEN_HEIGHT = w, h
    with open(RESOLUTION_FILE, 'w') as f:
        f.write(f"{w} {h}\n")

def detect_resolution_from_screenshot():
    """Detect resolution from the latest screenshot."""
    try:
        from PIL import Image
        screenshot = f"{C2_DIR}/latest.png"
        img = Image.open(screenshot)
        return img.size
    except:
        return SCREEN_WIDTH, SCREEN_HEIGHT

# Key codes for typing (US QWERTY)
KEY_MAP = {
    'a': 30, 'b': 48, 'c': 46, 'd': 32, 'e': 18, 'f': 33, 'g': 34, 'h': 35,
    'i': 23, 'j': 36, 'k': 37, 'l': 38, 'm': 50, 'n': 49, 'o': 24, 'p': 25,
    'q': 16, 'r': 19, 's': 31, 't': 20, 'u': 22, 'v': 47, 'w': 17, 'x': 45,
    'y': 21, 'z': 44,
    '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
    ' ': 57, '\n': 28, '\t': 15,
    '-': 12, '=': 13, '[': 26, ']': 27, '\\': 43, ';': 39, "'": 40, '`': 41,
    ',': 51, '.': 52, '/': 53,
}

# Special keys
KEY_LEFTMETA = 125  # Search key
KEY_LEFTCTRL = 29
KEY_LEFTALT = 56
KEY_LEFTSHIFT = 42
KEY_TAB = 15
KEY_F5 = 63

# === Keyboard Functions ===
def send_key_event(fd, keycode, value):
    """Send a key event. value: 1=press, 0=release"""
    os.write(fd, struct.pack("llHHi", 0, 0, EV_KEY, keycode, value))
    os.write(fd, struct.pack("llHHi", 0, 0, EV_SYN, 0, 0))

def press_keys(keycodes):
    """Press and release a key combination."""
    fd = os.open(KEYBOARD_DEV, os.O_WRONLY)
    try:
        # Press all keys
        for kc in keycodes:
            send_key_event(fd, kc, 1)
            time.sleep(0.02)
        time.sleep(0.1)
        # Release all keys in reverse
        for kc in reversed(keycodes):
            send_key_event(fd, kc, 0)
            time.sleep(0.02)
    finally:
        os.close(fd)

def type_text(text):
    """Type text character by character."""
    fd = os.open(KEYBOARD_DEV, os.O_WRONLY)
    try:
        for char in text:
            shift = False
            c = char.lower()
            if char.isupper() or char in '!@#$%^&*()_+{}|:"<>?~':
                shift = True
                # Map shifted characters
                shift_map = {
                    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
                    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
                    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
                    ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
                    '~': '`'
                }
                c = shift_map.get(char, c)

            if c not in KEY_MAP:
                continue

            keycode = KEY_MAP[c]

            if shift:
                send_key_event(fd, KEY_LEFTSHIFT, 1)
                time.sleep(0.01)

            send_key_event(fd, keycode, 1)
            time.sleep(0.02)
            send_key_event(fd, keycode, 0)

            if shift:
                time.sleep(0.01)
                send_key_event(fd, KEY_LEFTSHIFT, 0)

            time.sleep(0.03)
    finally:
        os.close(fd)

# === Mouse Functions ===
class VirtualMouse:
    def __init__(self):
        self.fd = os.open(UINPUT_DEV, os.O_WRONLY | os.O_NONBLOCK)

        # Enable event types
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_REL)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_SYN)

        # Enable mouse buttons
        for btn in [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE]:
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, btn)

        # Enable relative axes
        fcntl.ioctl(self.fd, UI_SET_RELBIT, REL_X)
        fcntl.ioctl(self.fd, UI_SET_RELBIT, REL_Y)

        # Create uinput_user_dev struct
        name = b"virtual-mouse"
        dev = struct.pack("80sHHHHi64i64i64i64i",
                          name, 0x3, 1, 1, 1, 0,
                          *([0]*64), *([0]*64), *([0]*64), *([0]*64))
        os.write(self.fd, dev)

        fcntl.ioctl(self.fd, UI_DEV_CREATE)
        time.sleep(0.3)

    def _emit(self, ev_type, code, value):
        os.write(self.fd, struct.pack("llHHi", 0, 0, ev_type, code, value))

    def _sync(self):
        self._emit(EV_SYN, 0, 0)

    def move(self, dx, dy, steps=1):
        """Move mouse by (dx, dy) pixels."""
        if steps == 1:
            if dx != 0:
                self._emit(EV_REL, REL_X, dx)
            if dy != 0:
                self._emit(EV_REL, REL_Y, dy)
            self._sync()
        else:
            step_x = dx / steps
            step_y = dy / steps
            for i in range(steps):
                ix = int((i + 1) * step_x) - int(i * step_x)
                iy = int((i + 1) * step_y) - int(i * step_y)
                if ix != 0:
                    self._emit(EV_REL, REL_X, ix)
                if iy != 0:
                    self._emit(EV_REL, REL_Y, iy)
                self._sync()
                time.sleep(0.01)

    def click(self, button=BTN_LEFT):
        """Click a mouse button."""
        self._emit(EV_KEY, button, 1)
        self._sync()
        time.sleep(0.05)
        self._emit(EV_KEY, button, 0)
        self._sync()

    def drag(self, dx, dy, steps=20):
        """Hold left button, move, release."""
        self._emit(EV_KEY, BTN_LEFT, 1)
        self._sync()
        time.sleep(0.05)
        self.move(dx, dy, steps)
        time.sleep(0.05)
        self._emit(EV_KEY, BTN_LEFT, 0)
        self._sync()

    def close(self):
        fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        os.close(self.fd)

# === Touchscreen Functions (writes to physical touchscreen device) ===
# These values are specific to the Chromebook - adjust if needed
TOUCHSCREEN_DEV = "/dev/input/event6"
TS_MAX_X = 3492
TS_MAX_Y = 1968
BROWSER_CHROME_OFFSET = 87  # Pixels from top of screen to browser content

# Multi-touch protocol constants
ABS_MT_SLOT = 0x2f
ABS_MT_TRACKING_ID = 0x39
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36

class Touchscreen:
    """Direct touchscreen input via /dev/input/event6."""

    def __init__(self):
        self.screen_w, self.screen_h = get_resolution()
        self.fd = None

    def _open(self):
        if self.fd is None:
            self.fd = os.open(TOUCHSCREEN_DEV, os.O_WRONLY)

    def _close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def _emit(self, ev_type, code, value):
        os.write(self.fd, struct.pack("llHHi", 0, 0, ev_type, code, value))

    def _sync(self):
        self._emit(EV_SYN, 0, 0)

    def _to_touchscreen_coords(self, screen_x, screen_y):
        """Convert screen coordinates to touchscreen coordinates."""
        ts_x = int(screen_x * TS_MAX_X / self.screen_w)
        ts_y = int(screen_y * TS_MAX_Y / self.screen_h)
        return ts_x, ts_y

    def tap(self, x, y, browser_coords=False):
        """Tap at screen coordinates (x, y).

        If browser_coords=True, adds browser chrome offset to y.
        """
        if browser_coords:
            y = y + BROWSER_CHROME_OFFSET

        ts_x, ts_y = self._to_touchscreen_coords(x, y)

        self._open()
        try:
            # Touch down
            self._emit(EV_ABS, ABS_MT_SLOT, 0)
            self._emit(EV_ABS, ABS_MT_TRACKING_ID, int(time.time() * 1000) % 65535)
            self._emit(EV_ABS, ABS_MT_POSITION_X, ts_x)
            self._emit(EV_ABS, ABS_MT_POSITION_Y, ts_y)
            self._emit(EV_KEY, BTN_TOUCH, 1)
            self._sync()

            time.sleep(0.08)

            # Touch up
            self._emit(EV_ABS, ABS_MT_TRACKING_ID, -1)
            self._emit(EV_KEY, BTN_TOUCH, 0)
            self._sync()
        finally:
            self._close()

    def swipe(self, x1, y1, x2, y2, browser_coords=False, steps=20, duration=0.3):
        """Swipe from (x1,y1) to (x2,y2)."""
        if browser_coords:
            y1 = y1 + BROWSER_CHROME_OFFSET
            y2 = y2 + BROWSER_CHROME_OFFSET

        self._open()
        try:
            ts_x1, ts_y1 = self._to_touchscreen_coords(x1, y1)
            ts_x2, ts_y2 = self._to_touchscreen_coords(x2, y2)

            # Touch down
            self._emit(EV_ABS, ABS_MT_SLOT, 0)
            self._emit(EV_ABS, ABS_MT_TRACKING_ID, int(time.time() * 1000) % 65535)
            self._emit(EV_ABS, ABS_MT_POSITION_X, ts_x1)
            self._emit(EV_ABS, ABS_MT_POSITION_Y, ts_y1)
            self._emit(EV_KEY, BTN_TOUCH, 1)
            self._sync()

            # Move through intermediate points
            delay = duration / steps
            for i in range(1, steps + 1):
                t = i / steps
                ts_x = int(ts_x1 + (ts_x2 - ts_x1) * t)
                ts_y = int(ts_y1 + (ts_y2 - ts_y1) * t)
                self._emit(EV_ABS, ABS_MT_POSITION_X, ts_x)
                self._emit(EV_ABS, ABS_MT_POSITION_Y, ts_y)
                self._sync()
                time.sleep(delay)

            # Touch up
            self._emit(EV_ABS, ABS_MT_TRACKING_ID, -1)
            self._emit(EV_KEY, BTN_TOUCH, 0)
            self._sync()
        finally:
            self._close()

    def close(self):
        self._close()


# Keep old class for compatibility but mark deprecated
class VirtualTouchscreen(Touchscreen):
    """Deprecated: Use Touchscreen instead."""
    pass

# === Screenshot Functions ===
SCREENSHOT_DIR = "/home/chronos/user/MyFiles/Downloads"
C2_DIR = "/home/chronos/user/MyFiles/Downloads/WSC/.c2"

def get_latest_screenshot():
    """Get the most recent screenshot file."""
    files = glob.glob(f"{SCREENSHOT_DIR}/Screenshot*.png")
    return max(files, key=os.path.getmtime) if files else None

def take_screenshot():
    """Take a screenshot using Search+F5 and copy to .c2/latest.png"""
    before = get_latest_screenshot()
    before_time = os.path.getmtime(before) if before else 0

    # Press Search+F5
    press_keys([KEY_LEFTMETA, KEY_F5])

    # Wait for screenshot to be saved
    time.sleep(2)

    after = get_latest_screenshot()
    if after and os.path.getmtime(after) > before_time:
        dest = f"{C2_DIR}/latest.png"
        shutil.copy(after, dest)
        print(f"OK: {after} -> {dest}")
        return True
    else:
        print("No new screenshot detected")
        return False

# === Main ===
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()

    if cmd == "screenshot":
        take_screenshot()

    elif cmd == "key":
        if len(sys.argv) < 3:
            print("Usage: input.py key <keycode> [keycode2] ...")
            print("Examples: key 125 63  (Search+F5)")
            print("          key 56 15   (Alt+Tab)")
            sys.exit(1)
        keycodes = [int(k) for k in sys.argv[2:]]
        press_keys(keycodes)
        print(f"Pressed keys: {keycodes}")

    elif cmd == "type":
        if len(sys.argv) < 3:
            print("Usage: input.py type <text>")
            sys.exit(1)
        text = " ".join(sys.argv[2:])
        type_text(text)
        print(f"Typed: {text}")

    elif cmd == "move":
        if len(sys.argv) < 4:
            print("Usage: input.py move <dx> <dy>")
            sys.exit(1)
        dx, dy = int(sys.argv[2]), int(sys.argv[3])
        mouse = VirtualMouse()
        mouse.move(dx, dy, steps=max(1, abs(dx)//10, abs(dy)//10))
        mouse.close()
        print(f"Moved mouse by ({dx}, {dy})")

    elif cmd == "click":
        btn_name = sys.argv[2] if len(sys.argv) > 2 else "left"
        btn_map = {"left": BTN_LEFT, "right": BTN_RIGHT, "middle": BTN_MIDDLE}
        btn = btn_map.get(btn_name.lower(), BTN_LEFT)
        mouse = VirtualMouse()
        mouse.click(btn)
        mouse.close()
        print(f"Clicked {btn_name}")

    elif cmd == "drag":
        if len(sys.argv) < 4:
            print("Usage: input.py drag <dx> <dy>")
            sys.exit(1)
        dx, dy = int(sys.argv[2]), int(sys.argv[3])
        mouse = VirtualMouse()
        mouse.drag(dx, dy)
        mouse.close()
        print(f"Dragged by ({dx}, {dy})")

    elif cmd == "tap":
        if len(sys.argv) < 4:
            print("Usage: input.py tap <x> <y> [--browser]")
            print("Tap at screen coordinates. Add --browser for browser window coords.")
            sys.exit(1)
        x, y = int(sys.argv[2]), int(sys.argv[3])
        browser_coords = "--browser" in sys.argv or "-b" in sys.argv
        ts = Touchscreen()
        ts.tap(x, y, browser_coords=browser_coords)
        ts.close()
        if browser_coords:
            print(f"Tapped at browser ({x}, {y}) -> screen ({x}, {y + BROWSER_CHROME_OFFSET})")
        else:
            print(f"Tapped at screen ({x}, {y})")

    elif cmd == "swipe":
        if len(sys.argv) < 6:
            print("Usage: input.py swipe <x1> <y1> <x2> <y2> [--browser]")
            print("Swipe from (x1,y1) to (x2,y2). Add --browser for browser window coords.")
            sys.exit(1)
        x1, y1, x2, y2 = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
        browser_coords = "--browser" in sys.argv or "-b" in sys.argv
        ts = Touchscreen()
        ts.swipe(x1, y1, x2, y2, browser_coords=browser_coords)
        ts.close()
        print(f"Swiped from ({x1}, {y1}) to ({x2}, {y2})" + (" [browser coords]" if browser_coords else ""))

    elif cmd == "resolution":
        if len(sys.argv) >= 4:
            w, h = int(sys.argv[2]), int(sys.argv[3])
            set_resolution(w, h)
            print(f"Resolution set to {w}x{h}")
        else:
            w, h = get_resolution()
            print(f"Current resolution: {w}x{h}")
            print("To change: input.py resolution <width> <height>")

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()

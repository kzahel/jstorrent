#!/usr/bin/env python3
"""
ChromeOS C2 Client - Simplified
Raw touchscreen and keyboard input via evdev.

Deploy to: /mnt/stateful_partition/c2/client.py
Run with: LD_LIBRARY_PATH=/usr/local/lib64 python3 /mnt/stateful_partition/c2/client.py

Commands:
    {"cmd": "ping"}                              -> {"pong": true}
    {"cmd": "tap", "x": 500, "y": 300}           -> {"ok": true}  (raw touchscreen coords)
    {"cmd": "swipe", "x1": 100, "y1": 500, "x2": 800, "y2": 500, "duration_ms": 300}
    {"cmd": "key", "keys": [125, 63]}            -> {"ok": true}  (raw keycodes)
    {"cmd": "type", "text": "hello"}             -> {"ok": true}
    {"cmd": "screenshot"}                        -> {"image": "base64..."}
    {"cmd": "info"}                              -> {"touch_max": [x, y], "device": "..."}
"""

import os
import sys
import json
import struct
import time
import glob
import fcntl
import array
import base64

# === Constants ===
KEYBOARD_DEV = "/dev/input/event2"

# Event types
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3

# Touch
BTN_TOUCH = 330
ABS_MT_SLOT = 0x2f
ABS_MT_TRACKING_ID = 0x39
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36

# Keys
KEY_LEFTMETA = 125
KEY_LEFTSHIFT = 42
KEY_F5 = 63

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

# Dvorak: to type character X, press the QWERTY key that's in X's position on Dvorak
DVORAK_TO_QWERTY = {
    "'": 'q', ',': 'w', '.': 'e', 'p': 'r', 'y': 't', 'f': 'y', 'g': 'u', 'c': 'i', 'r': 'o', 'l': 'p',
    '/': '[', '=': ']',
    'a': 'a', 'o': 's', 'e': 'd', 'u': 'f', 'i': 'g', 'd': 'h', 'h': 'j', 't': 'k', 'n': 'l', 's': ';',
    '-': "'",
    ';': 'z', 'q': 'x', 'j': 'c', 'k': 'v', 'x': 'b', 'b': 'n', 'm': 'm', 'w': ',', 'v': '.', 'z': '/',
}

# Modifier key constants
MOD_SEARCH, MOD_CONTROL, MOD_ALT = 0, 1, 2
KEYCODE_SEARCH, KEYCODE_CTRL, KEYCODE_ALT = 125, 29, 56

SCREENSHOT_DIR = "/home/chronos/user/MyFiles/Downloads"
CHROMEOS_PREFS = "/home/chronos/user/Preferences"


def load_keyboard_config():
    """Load keyboard layout and modifier remappings from ChromeOS preferences."""
    layout = 'qwerty'
    modifier_remappings = {}  # physical_mod -> logical_mod

    try:
        with open(CHROMEOS_PREFS, 'r') as f:
            prefs = json.load(f)

        settings = prefs.get('settings', {})

        # Detect layout
        current_im = settings.get('language', {}).get('current_input_method', '')
        if 'dvorak' in current_im.lower():
            layout = 'dvorak'

        # Detect modifier remappings (e.g., Ctrl↔Search swap)
        # Format: {"0": 1, "1": 0} means Search->Ctrl, Ctrl->Search
        remaps = settings.get('keyboard', {}).get('internal', {}).get('modifier_remappings', {})
        for phys_str, logical in remaps.items():
            try:
                modifier_remappings[int(phys_str)] = logical
            except:
                pass
    except:
        pass

    return layout, modifier_remappings


_kb_layout, _kb_remappings = load_keyboard_config()


def get_physical_keycode_for_modifier(logical_mod):
    """Get the physical keycode to press for a logical modifier (handles remapping)."""
    mod_to_keycode = {MOD_SEARCH: KEYCODE_SEARCH, MOD_CONTROL: KEYCODE_CTRL, MOD_ALT: KEYCODE_ALT}

    # Find which physical key is mapped to this logical modifier
    for physical, logical in _kb_remappings.items():
        if logical == logical_mod:
            return mod_to_keycode.get(physical, mod_to_keycode.get(logical_mod))

    return mod_to_keycode.get(logical_mod)


def translate_char_for_layout(char):
    """Translate character for current keyboard layout."""
    if _kb_layout == 'dvorak' and char in DVORAK_TO_QWERTY:
        return DVORAK_TO_QWERTY[char]
    return char


# === evdev helpers ===
def EVIOCGABS(axis):
    return 0x80184540 + axis


def get_abs_info(fd, axis):
    try:
        buf = array.array('i', [0] * 6)
        fcntl.ioctl(fd, EVIOCGABS(axis), buf)
        return {'min': buf[1], 'max': buf[2]}
    except:
        return None


def find_touchscreen():
    """Find touchscreen device and return (device_path, max_x, max_y)."""
    candidates = []
    for i in range(20):
        path = f"/dev/input/event{i}"
        if not os.path.exists(path):
            continue
        try:
            fd = os.open(path, os.O_RDONLY)
            try:
                x_info = get_abs_info(fd, ABS_MT_POSITION_X)
                y_info = get_abs_info(fd, ABS_MT_POSITION_Y)
                if x_info and y_info and x_info['max'] > 1000:
                    candidates.append((path, x_info['max'], y_info['max']))
            finally:
                os.close(fd)
        except:
            pass
    # Pick device with largest max_x (touchscreens > trackpads)
    if candidates:
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0]
    return None, None, None


# Cache touchscreen info
_ts_device, _ts_max_x, _ts_max_y = find_touchscreen()


# === Touchscreen ===
def tap(x, y):
    """Tap at raw touchscreen coordinates."""
    fd = os.open(_ts_device, os.O_WRONLY)
    try:
        def emit(ev_type, code, value):
            os.write(fd, struct.pack("llHHi", 0, 0, ev_type, code, value))

        def sync():
            emit(EV_SYN, 0, 0)

        # Touch down
        emit(EV_ABS, ABS_MT_SLOT, 0)
        emit(EV_ABS, ABS_MT_TRACKING_ID, int(time.time() * 1000) % 65535)
        emit(EV_ABS, ABS_MT_POSITION_X, int(x))
        emit(EV_ABS, ABS_MT_POSITION_Y, int(y))
        emit(EV_KEY, BTN_TOUCH, 1)
        sync()

        time.sleep(0.08)

        # Touch up
        emit(EV_ABS, ABS_MT_TRACKING_ID, -1)
        emit(EV_KEY, BTN_TOUCH, 0)
        sync()
    finally:
        os.close(fd)


def swipe(x1, y1, x2, y2, duration_ms=300):
    """Swipe between raw touchscreen coordinates."""
    fd = os.open(_ts_device, os.O_WRONLY)
    try:
        def emit(ev_type, code, value):
            os.write(fd, struct.pack("llHHi", 0, 0, ev_type, code, value))

        def sync():
            emit(EV_SYN, 0, 0)

        steps = 20
        delay = (duration_ms / 1000) / steps

        # Touch down
        emit(EV_ABS, ABS_MT_SLOT, 0)
        emit(EV_ABS, ABS_MT_TRACKING_ID, int(time.time() * 1000) % 65535)
        emit(EV_ABS, ABS_MT_POSITION_X, int(x1))
        emit(EV_ABS, ABS_MT_POSITION_Y, int(y1))
        emit(EV_KEY, BTN_TOUCH, 1)
        sync()

        # Move
        for i in range(1, steps + 1):
            t = i / steps
            x = int(x1 + (x2 - x1) * t)
            y = int(y1 + (y2 - y1) * t)
            emit(EV_ABS, ABS_MT_POSITION_X, x)
            emit(EV_ABS, ABS_MT_POSITION_Y, y)
            sync()
            time.sleep(delay)

        # Touch up
        emit(EV_ABS, ABS_MT_TRACKING_ID, -1)
        emit(EV_KEY, BTN_TOUCH, 0)
        sync()
    finally:
        os.close(fd)


# === Keyboard ===
def send_key_event(fd, keycode, value):
    os.write(fd, struct.pack("llHHi", 0, 0, EV_KEY, keycode, value))
    os.write(fd, struct.pack("llHHi", 0, 0, EV_SYN, 0, 0))


def press_keys(keycodes):
    """Press and release a key combination."""
    fd = os.open(KEYBOARD_DEV, os.O_WRONLY)
    try:
        for kc in keycodes:
            send_key_event(fd, kc, 1)
            time.sleep(0.02)
        time.sleep(0.1)
        for kc in reversed(keycodes):
            send_key_event(fd, kc, 0)
            time.sleep(0.02)
    finally:
        os.close(fd)


def type_text(text):
    """Type text character by character (layout-aware)."""
    fd = os.open(KEYBOARD_DEV, os.O_WRONLY)
    try:
        for char in text:
            # Translate for keyboard layout (e.g., Dvorak)
            translated = translate_char_for_layout(char)

            shift = False
            c = translated.lower()
            if translated.isupper() or translated in '!@#$%^&*()_+{}|:"<>?~':
                shift = True
                shift_map = {
                    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
                    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
                    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
                    ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
                    '~': '`'
                }
                c = shift_map.get(translated, c)

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


def shortcut(modifiers, key):
    """Execute keyboard shortcut with modifier remapping."""
    keycodes = []

    # Map modifier names to logical constants
    mod_map = {"ctrl": MOD_CONTROL, "control": MOD_CONTROL, "alt": MOD_ALT, "search": MOD_SEARCH, "meta": MOD_SEARCH}

    for mod in modifiers:
        mod_lower = mod.lower()
        if mod_lower == "shift":
            keycodes.append(KEY_LEFTSHIFT)
        elif mod_lower in mod_map:
            keycodes.append(get_physical_keycode_for_modifier(mod_map[mod_lower]))

    # Get keycode for main key (translate through layout for shortcuts too)
    key_lower = key.lower()
    translated = translate_char_for_layout(key_lower)
    if translated in KEY_MAP:
        keycodes.append(KEY_MAP[translated])
    elif key_lower.startswith("f") and key_lower[1:].isdigit():
        fnum = int(key_lower[1:])
        if 1 <= fnum <= 12:
            keycodes.append(58 + fnum)  # F1=59, etc.

    press_keys(keycodes)
    return keycodes


# === Screenshot ===
def take_screenshot():
    """Take screenshot via Search+F5, return base64."""
    files = glob.glob(f"{SCREENSHOT_DIR}/Screenshot*.png")
    before = max(files, key=os.path.getmtime) if files else None
    before_time = os.path.getmtime(before) if before else 0

    press_keys([KEY_LEFTMETA, KEY_F5])
    time.sleep(2)

    files = glob.glob(f"{SCREENSHOT_DIR}/Screenshot*.png")
    after = max(files, key=os.path.getmtime) if files else None

    if after and os.path.getmtime(after) > before_time:
        with open(after, 'rb') as f:
            return base64.b64encode(f.read()).decode('ascii')
    return None


# === Command Handlers ===
def cmd_ping(msg):
    return {"pong": True}


def cmd_tap(msg):
    x, y = msg.get("x"), msg.get("y")
    if x is None or y is None:
        return {"error": "tap requires x and y"}
    tap(x, y)
    return {"ok": True}


def cmd_swipe(msg):
    x1, y1 = msg.get("x1"), msg.get("y1")
    x2, y2 = msg.get("x2"), msg.get("y2")
    duration_ms = msg.get("duration_ms", 300)
    if None in (x1, y1, x2, y2):
        return {"error": "swipe requires x1, y1, x2, y2"}
    swipe(x1, y1, x2, y2, duration_ms)
    return {"ok": True}


def cmd_key(msg):
    keys = msg.get("keys")
    if not keys:
        return {"error": "key requires keys array"}
    press_keys(keys)
    return {"ok": True}


def cmd_type(msg):
    text = msg.get("text")
    if text is None:
        return {"error": "type requires text"}
    type_text(text)
    return {"ok": True}


def cmd_screenshot(msg):
    image_data = take_screenshot()
    if image_data:
        return {"image": image_data}
    return {"error": "Failed to capture screenshot"}


def cmd_shortcut(msg):
    modifiers = msg.get("modifiers", [])
    key = msg.get("key")
    if not key:
        return {"error": "shortcut requires key"}
    keycodes = shortcut(modifiers, key)
    return {"ok": True, "keycodes": keycodes}


def cmd_info(msg):
    return {
        "device": _ts_device,
        "touch_max": [_ts_max_x, _ts_max_y],
        "keyboard": {
            "layout": _kb_layout,
            "modifier_remappings": _kb_remappings,
        }
    }


def cmd_reload_config(msg):
    global _kb_layout, _kb_remappings
    _kb_layout, _kb_remappings = load_keyboard_config()
    return {"ok": True, "keyboard": {"layout": _kb_layout, "modifier_remappings": _kb_remappings}}


COMMANDS = {
    "ping": cmd_ping,
    "tap": cmd_tap,
    "swipe": cmd_swipe,
    "key": cmd_key,
    "type": cmd_type,
    "shortcut": cmd_shortcut,
    "screenshot": cmd_screenshot,
    "info": cmd_info,
    "reload_config": cmd_reload_config,
}


def main():
    sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
            cmd = msg.get("cmd")
            handler = COMMANDS.get(cmd)
            if handler:
                result = handler(msg)
            else:
                result = {"error": f"unknown command: {cmd}"}
        except json.JSONDecodeError as e:
            result = {"error": f"invalid JSON: {e}"}
        except Exception as e:
            result = {"error": str(e)}

        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()

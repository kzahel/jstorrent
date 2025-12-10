#!/usr/bin/env python3
"""
ChromeOS C2 Client
Reads JSON commands from stdin, executes, writes JSON responses to stdout.
Fixed command set only - no arbitrary execution.

Deploy to: /mnt/stateful_partition/c2/client.py
Run with: LD_LIBRARY_PATH=/usr/local/lib64 python3 /mnt/stateful_partition/c2/client.py

Features:
- Auto-detects keyboard layout (QWERTY, Dvorak) from ChromeOS preferences
- Auto-detects modifier key remappings (e.g., Ctrl↔Search swap)
- type_text automatically translates characters for the active layout
- shortcut command handles modifier remapping for keyboard shortcuts

Commands:
    {"cmd": "ping"}                              -> {"pong": true}
    {"cmd": "tap", "x": 500, "y": 300}           -> {"ok": true}
    {"cmd": "swipe", "x1": 100, "y1": 500, "x2": 800, "y2": 500, "duration_ms": 300}
    {"cmd": "key", "keys": [125, 63]}            -> {"ok": true} (raw keycodes)
    {"cmd": "type", "text": "hello"}             -> {"ok": true} (layout-aware)
    {"cmd": "shortcut", "modifiers": ["ctrl"], "key": "t"}  -> {"ok": true} (modifier-aware)
    {"cmd": "screenshot"}                        -> {"image": "base64..."}
    {"cmd": "resolution", "x": 1600, "y": 900}   -> {"ok": true}
    {"cmd": "info"}                              -> {"screen": [...], "keyboard": {...}}
    {"cmd": "reload_config"}                     -> {"ok": true, "keyboard": {...}}
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
import subprocess
import re

# === Constants ===
KEYBOARD_DEV = "/dev/input/event2"

# Event types
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3

# Mouse/touch buttons
BTN_TOUCH = 330

# Multi-touch protocol constants
ABS_MT_SLOT = 0x2f
ABS_MT_TRACKING_ID = 0x39
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36

# Default screen resolution (can be overridden)
SCREEN_WIDTH = 1600
SCREEN_HEIGHT = 900

# Paths
SCREENSHOT_DIR = "/home/chronos/user/MyFiles/Downloads"
CONFIG_DIR = "/mnt/stateful_partition/c2"
CHROMEOS_PREFS = "/home/chronos/user/Preferences"

# Modifier key enum values (from Chromium source)
MOD_SEARCH = 0
MOD_CONTROL = 1
MOD_ALT = 2
MOD_VOID = 3
MOD_CAPSLOCK = 4
MOD_ESCAPE = 5
MOD_BACKSPACE = 6
MOD_ASSISTANT = 7

# Linux keycodes for modifier keys
KEYCODE_SEARCH = 125  # KEY_LEFTMETA
KEYCODE_CTRL = 29     # KEY_LEFTCTRL
KEYCODE_ALT = 56      # KEY_LEFTALT
KEYCODE_CAPSLOCK = 58
KEYCODE_ESC = 1
KEYCODE_BACKSPACE = 14

# Map from ChromeOS modifier enum to Linux keycode
MOD_TO_KEYCODE = {
    MOD_SEARCH: KEYCODE_SEARCH,
    MOD_CONTROL: KEYCODE_CTRL,
    MOD_ALT: KEYCODE_ALT,
    MOD_CAPSLOCK: KEYCODE_CAPSLOCK,
    MOD_ESCAPE: KEYCODE_ESC,
    MOD_BACKSPACE: KEYCODE_BACKSPACE,
}

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
KEY_LEFTSHIFT = 42
KEY_F5 = 63

# Dvorak to QWERTY mapping: what QWERTY key produces this character in Dvorak?
# When Dvorak is active and we want to type 'a', we need to press the QWERTY 'a' key
# because the OS will map it through Dvorak. But we're sending raw keycodes,
# so we need to reverse-map: desired_char -> physical_key_in_dvorak_layout
# Dvorak layout: ',.pyfgcrl/=  aoeuidhtns-  ;qjkxbmwvz
# QWERTY layout: qwertyuiop[]  asdfghjkl;'  zxcvbnm,./
DVORAK_TO_QWERTY = {
    "'": 'q', ',': 'w', '.': 'e', 'p': 'r', 'y': 't', 'f': 'y', 'g': 'u', 'c': 'i', 'r': 'o', 'l': 'p',
    '/': '[', '=': ']',
    'a': 'a', 'o': 's', 'e': 'd', 'u': 'f', 'i': 'g', 'd': 'h', 'h': 'j', 't': 'k', 'n': 'l', 's': ';',
    '-': "'",
    ';': 'z', 'q': 'x', 'j': 'c', 'k': 'v', 'x': 'b', 'b': 'n', 'm': 'm', 'w': ',', 'v': '.', 'z': '/',
}
# Add uppercase mappings
DVORAK_TO_QWERTY.update({k.upper(): v.upper() for k, v in DVORAK_TO_QWERTY.items() if k.isalpha()})
# Shifted symbols for Dvorak
DVORAK_SHIFTED = {
    '"': 'Q', '<': 'W', '>': 'E', 'P': 'R', 'Y': 'T', 'F': 'Y', 'G': 'U', 'C': 'I', 'R': 'O', 'L': 'P',
    '?': '[', '+': ']',
    '_': "'", ':': 'Z',
}
DVORAK_TO_QWERTY.update(DVORAK_SHIFTED)


# === ChromeOS Preferences Reading ===
class KeyboardConfig:
    """Reads and caches ChromeOS keyboard configuration."""

    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.layout = "qwerty"
        self.modifier_remappings = {}  # physical_mod -> logical_mod
        self._load_preferences()

    def _load_preferences(self):
        """Load keyboard settings from ChromeOS Preferences file."""
        try:
            with open(CHROMEOS_PREFS, 'r') as f:
                prefs = json.load(f)

            # Detect keyboard layout
            settings = prefs.get('settings', {})
            lang = settings.get('language', {})
            current_im = lang.get('current_input_method', '')

            # Parse layout from input method string like "_comp_ime_...xkb:us:dvorak:eng"
            if 'xkb:' in current_im:
                xkb_part = current_im.split('xkb:')[-1]  # "us:dvorak:eng"
                parts = xkb_part.split(':')
                if len(parts) >= 2 and parts[1]:
                    self.layout = parts[1].lower()  # "dvorak"
                else:
                    self.layout = "qwerty"

            # Detect modifier remappings (new format)
            keyboard = settings.get('keyboard', {})
            internal = keyboard.get('internal', {})
            remappings = internal.get('modifier_remappings', {})

            # remappings is like {"0": 1, "1": 0} meaning Search->Ctrl, Ctrl->Search
            for physical_str, logical in remappings.items():
                try:
                    physical = int(physical_str)
                    self.modifier_remappings[physical] = logical
                except (ValueError, TypeError):
                    pass

            # Also check legacy format
            if not self.modifier_remappings:
                search_to = lang.get('xkb_remap_search_key_to')
                ctrl_to = lang.get('xkb_remap_control_key_to')
                if search_to is not None:
                    self.modifier_remappings[MOD_SEARCH] = search_to
                if ctrl_to is not None:
                    self.modifier_remappings[MOD_CONTROL] = ctrl_to

        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            # Use defaults if we can't read preferences
            pass

    def reload(self):
        """Reload preferences (call if settings changed)."""
        self._load_preferences()

    def get_physical_keycode_for_modifier(self, logical_mod):
        """
        Get the physical keycode to press for a logical modifier.

        If user has Ctrl↔Search swap, and we want logical Ctrl behavior,
        we need to find which physical key is remapped TO Ctrl.
        """
        # Find which physical key is mapped to this logical modifier
        for physical, logical in self.modifier_remappings.items():
            if logical == logical_mod:
                return MOD_TO_KEYCODE.get(physical, MOD_TO_KEYCODE.get(logical_mod))

        # No remapping, use default
        return MOD_TO_KEYCODE.get(logical_mod)

    def translate_char_for_layout(self, char):
        """
        Translate a character to what we need to type given the current layout.

        If layout is Dvorak and we want to type 'k', we need to send the keycode
        for QWERTY 'v' because that physical position produces 'k' in Dvorak.
        """
        if self.layout == 'dvorak' and char in DVORAK_TO_QWERTY:
            return DVORAK_TO_QWERTY[char]
        return char

    def get_info(self):
        """Return current keyboard configuration."""
        return {
            'layout': self.layout,
            'modifier_remappings': self.modifier_remappings,
            'ctrl_keycode': self.get_physical_keycode_for_modifier(MOD_CONTROL),
            'search_keycode': self.get_physical_keycode_for_modifier(MOD_SEARCH),
        }


# === Display Detection ===
def get_active_display_info():
    """
    Detect active display(s) and their resolution.
    Returns: {
        'internal_enabled': bool,
        'external_enabled': bool,
        'active_resolution': (width, height),
        'displays': [{'name': str, 'enabled': bool, 'resolution': (w,h) or None}]
    }
    """
    drm_path = "/sys/class/drm"
    displays = []
    internal_enabled = False
    external_enabled = False

    # Scan all display connectors
    try:
        for entry in os.listdir(drm_path):
            if not entry.startswith("card0-"):
                continue
            connector_path = os.path.join(drm_path, entry)

            # Check if connected
            status_file = os.path.join(connector_path, "status")
            enabled_file = os.path.join(connector_path, "enabled")

            try:
                with open(status_file) as f:
                    status = f.read().strip()
                with open(enabled_file) as f:
                    enabled = f.read().strip() == "enabled"
            except (IOError, OSError):
                continue

            if status != "connected":
                continue

            # Determine if internal (eDP) or external
            is_internal = "eDP" in entry

            displays.append({
                'name': entry,
                'enabled': enabled,
                'is_internal': is_internal,
            })

            if enabled:
                if is_internal:
                    internal_enabled = True
                else:
                    external_enabled = True
    except (IOError, OSError):
        pass

    # Get active resolution from modetest
    active_resolution = None
    try:
        result = subprocess.run(
            ["modetest", "-p"],
            capture_output=True,
            text=True,
            timeout=5
        )
        # Look for active CRTC with resolution like: "75  172  (0,0)  (1920x1080)"
        for line in result.stdout.split('\n'):
            # Match lines with active resolution: has non-zero fb and resolution
            match = re.search(r'\d+\s+(\d+)\s+\([^)]+\)\s+\((\d+)x(\d+)\)', line)
            if match:
                fb_id = int(match.group(1))
                if fb_id > 0:  # Active framebuffer
                    w, h = int(match.group(2)), int(match.group(3))
                    if w > 0 and h > 0:
                        active_resolution = (w, h)
                        break
    except (subprocess.SubprocessError, OSError):
        pass

    return {
        'internal_enabled': internal_enabled,
        'external_enabled': external_enabled,
        'active_resolution': active_resolution,
        'displays': displays,
    }


# === evdev ioctl helpers ===
def EVIOCGABS(axis):
    """Get absolute axis info ioctl."""
    return 0x80184540 + axis


def get_abs_info(fd, axis):
    """Query absolute axis info from an evdev device."""
    try:
        buf = array.array('i', [0] * 6)
        fcntl.ioctl(fd, EVIOCGABS(axis), buf)
        return {'min': buf[1], 'max': buf[2]}
    except:
        return None


def device_has_abs_axis(device_path, axis):
    """Check if a device has a specific absolute axis capability."""
    try:
        fd = os.open(device_path, os.O_RDONLY)
        try:
            info = get_abs_info(fd, axis)
            return info is not None and info['max'] > 0
        finally:
            os.close(fd)
    except:
        return False


# === Keyboard Functions ===
def send_key_event(fd, keycode, value):
    """Send a key event. value: 1=press, 0=release"""
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
    """Type text character by character, respecting keyboard layout."""
    kb_config = KeyboardConfig.get_instance()
    fd = os.open(KEYBOARD_DEV, os.O_WRONLY)
    try:
        for char in text:
            # Translate character for current keyboard layout
            translated = kb_config.translate_char_for_layout(char)

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


# === Virtual Pointer (uinput) ===
# Additional constants for mouse/tablet input
ABS_X = 0x00
ABS_Y = 0x01
BTN_LEFT = 0x110
BTN_MOUSE = 0x110


class VirtualTouchscreen:
    """
    Virtual absolute pointing device using uinput.
    Creates a tablet-like device with absolute coordinates and mouse buttons.
    Works regardless of physical display/touchscreen configuration.
    """

    # uinput constants
    UI_SET_EVBIT = 0x40045564
    UI_SET_ABSBIT = 0x40045567
    UI_SET_KEYBIT = 0x40045565
    UI_DEV_CREATE = 0x5501
    UI_DEV_DESTROY = 0x5502

    # uinput_user_dev struct size (for older kernels)
    UINPUT_MAX_NAME_SIZE = 80

    _instance = None

    @classmethod
    def get_instance(cls, screen_w=1920, screen_h=1080):
        """Get or create singleton instance."""
        if cls._instance is None:
            cls._instance = cls(screen_w, screen_h)
        return cls._instance

    def __init__(self, screen_w=1920, screen_h=1080):
        self.screen_w = screen_w
        self.screen_h = screen_h
        self.fd = None
        self.device_path = "/dev/uinput"
        self._create_device()

    def _create_device(self):
        """Create virtual tablet/pointer device via uinput."""
        try:
            self.fd = os.open(self.device_path, os.O_WRONLY | os.O_NONBLOCK)
        except OSError as e:
            raise RuntimeError(f"Cannot open {self.device_path}: {e}")

        # Enable EV_KEY for mouse buttons and touch
        fcntl.ioctl(self.fd, self.UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(self.fd, self.UI_SET_KEYBIT, BTN_LEFT)
        fcntl.ioctl(self.fd, self.UI_SET_KEYBIT, BTN_TOUCH)

        # Enable EV_ABS for absolute positioning
        fcntl.ioctl(self.fd, self.UI_SET_EVBIT, EV_ABS)
        # Single-touch absolute axes (tablet-style)
        fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, ABS_X)
        fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, ABS_Y)
        # Also multitouch for touchscreen compatibility
        fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, ABS_MT_SLOT)
        fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, ABS_MT_TRACKING_ID)
        fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, ABS_MT_POSITION_X)
        fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, ABS_MT_POSITION_Y)

        # Build uinput_user_dev structure
        ABS_CNT = 64
        name = b"virtual-pointer"
        name_padded = name + b'\x00' * (self.UINPUT_MAX_NAME_SIZE - len(name))

        # Input ID: bus=0x03 (USB), vendor=0x1234, product=0x5678, version=1
        input_id = struct.pack("HHHH", 0x03, 0x1234, 0x5678, 1)

        ff_effects_max = struct.pack("I", 0)

        absmax = [0] * ABS_CNT
        absmin = [0] * ABS_CNT
        absfuzz = [0] * ABS_CNT
        absflat = [0] * ABS_CNT

        # Single-touch absolute axes (ABS_X=0, ABS_Y=1)
        absmax[ABS_X] = self.screen_w - 1
        absmax[ABS_Y] = self.screen_h - 1

        # Multitouch axes
        absmax[ABS_MT_SLOT] = 9
        absmax[ABS_MT_TRACKING_ID] = 65535
        absmax[ABS_MT_POSITION_X] = self.screen_w - 1
        absmax[ABS_MT_POSITION_Y] = self.screen_h - 1

        absmax_bytes = struct.pack(f"{ABS_CNT}i", *absmax)
        absmin_bytes = struct.pack(f"{ABS_CNT}i", *absmin)
        absfuzz_bytes = struct.pack(f"{ABS_CNT}i", *absfuzz)
        absflat_bytes = struct.pack(f"{ABS_CNT}i", *absflat)

        user_dev = name_padded + input_id + ff_effects_max + absmax_bytes + absmin_bytes + absfuzz_bytes + absflat_bytes

        os.write(self.fd, user_dev)

        # Create the device
        fcntl.ioctl(self.fd, self.UI_DEV_CREATE)
        time.sleep(0.2)  # Give kernel time to set up device

    def set_resolution(self, w, h):
        """Update screen resolution. Requires recreating device."""
        if w != self.screen_w or h != self.screen_h:
            self.screen_w = w
            self.screen_h = h
            self._destroy()
            self._create_device()

    def _destroy(self):
        """Destroy virtual device."""
        if self.fd is not None:
            try:
                fcntl.ioctl(self.fd, self.UI_DEV_DESTROY)
            except:
                pass
            os.close(self.fd)
            self.fd = None

    def _emit(self, ev_type, code, value):
        """Write an input event."""
        data = struct.pack("llHHi", 0, 0, ev_type, code, value)
        written = os.write(self.fd, data)
        if written != len(data):
            import sys
            print(f"DEBUG: write failed, wrote {written}/{len(data)}", file=sys.stderr)

    def _sync(self):
        """Send sync event."""
        self._emit(EV_SYN, 0, 0)

    def tap(self, x, y):
        """Tap at screen coordinates using tablet-style absolute positioning."""
        # Clamp coordinates
        x = max(0, min(int(x), self.screen_w - 1))
        y = max(0, min(int(y), self.screen_h - 1))

        tracking_id = int(time.time() * 1000) % 65535

        # Debug: log fd status
        import sys
        print(f"DEBUG: tap({x}, {y}) fd={self.fd}", file=sys.stderr)

        # Move to position first (tablet style)
        self._emit(EV_ABS, ABS_X, x)
        self._emit(EV_ABS, ABS_Y, y)
        # Also send multitouch events
        self._emit(EV_ABS, ABS_MT_SLOT, 0)
        self._emit(EV_ABS, ABS_MT_TRACKING_ID, tracking_id)
        self._emit(EV_ABS, ABS_MT_POSITION_X, x)
        self._emit(EV_ABS, ABS_MT_POSITION_Y, y)
        self._sync()

        time.sleep(0.02)

        # Press (both mouse button and touch)
        self._emit(EV_KEY, BTN_LEFT, 1)
        self._emit(EV_KEY, BTN_TOUCH, 1)
        self._sync()

        time.sleep(0.08)

        # Release
        self._emit(EV_KEY, BTN_LEFT, 0)
        self._emit(EV_KEY, BTN_TOUCH, 0)
        self._emit(EV_ABS, ABS_MT_TRACKING_ID, -1)
        self._sync()

        print(f"DEBUG: tap complete", file=sys.stderr)

    def swipe(self, x1, y1, x2, y2, duration_ms=300):
        """Swipe from (x1,y1) to (x2,y2)."""
        steps = 20
        delay = (duration_ms / 1000) / steps
        tracking_id = int(time.time() * 1000) % 65535

        x1, y1 = int(x1), int(y1)
        x2, y2 = int(x2), int(y2)

        # Start position
        self._emit(EV_ABS, ABS_X, x1)
        self._emit(EV_ABS, ABS_Y, y1)
        self._emit(EV_ABS, ABS_MT_SLOT, 0)
        self._emit(EV_ABS, ABS_MT_TRACKING_ID, tracking_id)
        self._emit(EV_ABS, ABS_MT_POSITION_X, x1)
        self._emit(EV_ABS, ABS_MT_POSITION_Y, y1)
        self._emit(EV_KEY, BTN_LEFT, 1)
        self._emit(EV_KEY, BTN_TOUCH, 1)
        self._sync()

        # Move through intermediate points
        for i in range(1, steps + 1):
            t = i / steps
            x = int(x1 + (x2 - x1) * t)
            y = int(y1 + (y2 - y1) * t)
            x = max(0, min(x, self.screen_w - 1))
            y = max(0, min(y, self.screen_h - 1))
            self._emit(EV_ABS, ABS_X, x)
            self._emit(EV_ABS, ABS_Y, y)
            self._emit(EV_ABS, ABS_MT_POSITION_X, x)
            self._emit(EV_ABS, ABS_MT_POSITION_Y, y)
            self._sync()
            time.sleep(delay)

        # Release
        self._emit(EV_KEY, BTN_LEFT, 0)
        self._emit(EV_KEY, BTN_TOUCH, 0)
        self._emit(EV_ABS, ABS_MT_TRACKING_ID, -1)
        self._sync()

    def get_info(self):
        """Return virtual pointer info."""
        return {
            'device': 'virtual-uinput',
            'max_x': self.screen_w - 1,
            'max_y': self.screen_h - 1,
            'type': 'virtual',
        }

    def __del__(self):
        self._destroy()


# === Touch Device Selection ===
_touch_device = None
_touch_device_type = None  # 'physical' or 'virtual'


def get_touch_device():
    """
    Get the appropriate touch device based on display configuration.
    Uses physical touchscreen when internal display is enabled,
    virtual touchscreen otherwise.
    """
    global _touch_device, _touch_device_type

    display_info = get_active_display_info()
    internal_enabled = display_info['internal_enabled']
    active_res = display_info['active_resolution']

    # Determine which device type to use
    if internal_enabled:
        needed_type = 'physical'
    else:
        needed_type = 'virtual'

    # If we need to switch device types, clear the cached instance
    if _touch_device_type != needed_type:
        _touch_device = None
        _touch_device_type = needed_type
        # Clear singleton instances
        Touchscreen._instance = None
        VirtualTouchscreen._instance = None

    # Get or create the appropriate device
    if needed_type == 'physical':
        _touch_device = Touchscreen.get_instance()
        # Update resolution if we detected it
        if active_res:
            _touch_device.set_resolution(active_res[0], active_res[1])
    else:
        # Virtual touchscreen - use detected resolution or default
        if active_res:
            _touch_device = VirtualTouchscreen.get_instance(active_res[0], active_res[1])
        else:
            _touch_device = VirtualTouchscreen.get_instance(SCREEN_WIDTH, SCREEN_HEIGHT)

    return _touch_device


def get_touch_device_info():
    """Get info about current touch device and display configuration."""
    display_info = get_active_display_info()
    device = get_touch_device()
    ts_info = device.get_info()

    return {
        'touch': ts_info,
        'display': display_info,
    }


# === Touchscreen Functions ===
class Touchscreen:
    """Direct touchscreen input via auto-detected /dev/input/event* device."""

    _instance = None

    @classmethod
    def get_instance(cls):
        """Get or create singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.screen_w = SCREEN_WIDTH
        self.screen_h = SCREEN_HEIGHT
        self.fd = None
        self.device = None
        self.ts_max_x = None
        self.ts_max_y = None
        self._detect_device()

    def _detect_device(self):
        """Find touchscreen device by scanning /dev/input/event*."""
        candidates = []
        for i in range(20):
            path = f"/dev/input/event{i}"
            if os.path.exists(path) and device_has_abs_axis(path, ABS_MT_POSITION_X):
                try:
                    fd = os.open(path, os.O_RDONLY)
                    try:
                        x_info = get_abs_info(fd, ABS_MT_POSITION_X)
                        if x_info and x_info['max'] > 0:
                            candidates.append((path, x_info['max']))
                    finally:
                        os.close(fd)
                except:
                    pass

        if not candidates:
            raise RuntimeError("No touchscreen device found")

        # Use device with largest max_x (touchscreens > trackpads)
        candidates.sort(key=lambda x: x[1], reverse=True)
        self.device = candidates[0][0]

        # Get coordinate ranges
        fd = os.open(self.device, os.O_RDONLY)
        try:
            x_info = get_abs_info(fd, ABS_MT_POSITION_X)
            y_info = get_abs_info(fd, ABS_MT_POSITION_Y)
            self.ts_max_x = x_info['max']
            self.ts_max_y = y_info['max']
        finally:
            os.close(fd)

    def set_resolution(self, w, h):
        """Set screen resolution for coordinate conversion."""
        self.screen_w = w
        self.screen_h = h

    def _open(self):
        if self.fd is None:
            self.fd = os.open(self.device, os.O_WRONLY)

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
        ts_x = int(screen_x * self.ts_max_x / self.screen_w)
        ts_y = int(screen_y * self.ts_max_y / self.screen_h)
        return ts_x, ts_y

    def tap(self, x, y):
        """Tap at screen coordinates (x, y)."""
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

    def swipe(self, x1, y1, x2, y2, duration_ms=300):
        """Swipe from (x1,y1) to (x2,y2)."""
        self._open()
        try:
            ts_x1, ts_y1 = self._to_touchscreen_coords(x1, y1)
            ts_x2, ts_y2 = self._to_touchscreen_coords(x2, y2)

            steps = 20
            delay = (duration_ms / 1000) / steps

            # Touch down
            self._emit(EV_ABS, ABS_MT_SLOT, 0)
            self._emit(EV_ABS, ABS_MT_TRACKING_ID, int(time.time() * 1000) % 65535)
            self._emit(EV_ABS, ABS_MT_POSITION_X, ts_x1)
            self._emit(EV_ABS, ABS_MT_POSITION_Y, ts_y1)
            self._emit(EV_KEY, BTN_TOUCH, 1)
            self._sync()

            # Move through intermediate points
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

    def get_info(self):
        """Return touchscreen info."""
        return {
            'device': self.device,
            'max_x': self.ts_max_x,
            'max_y': self.ts_max_y,
        }


# === Screenshot Functions ===
def get_latest_screenshot():
    """Get the most recent screenshot file."""
    files = glob.glob(f"{SCREENSHOT_DIR}/Screenshot*.png")
    return max(files, key=os.path.getmtime) if files else None


def take_screenshot():
    """Take a screenshot using Search+F5 and return as base64."""
    before = get_latest_screenshot()
    before_time = os.path.getmtime(before) if before else 0

    # Press Search+F5
    press_keys([KEY_LEFTMETA, KEY_F5])

    # Wait for screenshot to be saved
    time.sleep(2)

    after = get_latest_screenshot()
    if after and os.path.getmtime(after) > before_time:
        with open(after, 'rb') as f:
            return base64.b64encode(f.read()).decode('ascii')
    else:
        return None


# === Command Handlers ===
def cmd_ping(msg):
    return {"pong": True}


def cmd_tap(msg):
    x = msg.get("x")
    y = msg.get("y")
    if x is None or y is None:
        return {"error": "tap requires x and y"}
    ts = get_touch_device()
    ts_info = ts.get_info()
    debug_info = {
        "fd": getattr(ts, 'fd', None),
        "screen_w": getattr(ts, 'screen_w', None),
        "screen_h": getattr(ts, 'screen_h', None),
    }
    ts.tap(x, y)
    return {"ok": True, "device_type": ts_info.get('type', 'physical'), "debug": debug_info}


def cmd_swipe(msg):
    x1 = msg.get("x1")
    y1 = msg.get("y1")
    x2 = msg.get("x2")
    y2 = msg.get("y2")
    duration_ms = msg.get("duration_ms", 300)
    if None in (x1, y1, x2, y2):
        return {"error": "swipe requires x1, y1, x2, y2"}
    ts = get_touch_device()
    ts.swipe(x1, y1, x2, y2, duration_ms)
    ts_info = ts.get_info()
    return {"ok": True, "device_type": ts_info.get('type', 'physical')}


def cmd_key(msg):
    keys = msg.get("keys")
    if not keys or not isinstance(keys, list):
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
    else:
        return {"error": "Failed to capture screenshot"}


def cmd_resolution(msg):
    global SCREEN_WIDTH, SCREEN_HEIGHT
    x = msg.get("x")
    y = msg.get("y")
    if x is not None and y is not None:
        SCREEN_WIDTH = x
        SCREEN_HEIGHT = y
        ts = get_touch_device()
        ts.set_resolution(x, y)
        ts_info = ts.get_info()
        return {"ok": True, "device_type": ts_info.get('type', 'physical')}
    else:
        return {"error": "resolution requires x and y"}


def cmd_info(msg):
    # Get display and touch device info
    display_info = get_active_display_info()
    ts = get_touch_device()
    ts_info = ts.get_info()
    kb_config = KeyboardConfig.get_instance()
    kb_info = kb_config.get_info()

    # Use detected resolution if available, otherwise use configured
    if display_info['active_resolution']:
        screen = list(display_info['active_resolution'])
    else:
        screen = [SCREEN_WIDTH, SCREEN_HEIGHT]

    return {
        "screen": screen,
        "touch_max": [ts_info['max_x'], ts_info['max_y']],
        "device": ts_info['device'],
        "device_type": ts_info.get('type', 'physical'),
        "keyboard": kb_info,
        "display": {
            "internal_enabled": display_info['internal_enabled'],
            "external_enabled": display_info['external_enabled'],
            "active_resolution": display_info['active_resolution'],
        },
    }


def cmd_reload_config(msg):
    """Reload keyboard configuration from ChromeOS preferences."""
    kb_config = KeyboardConfig.get_instance()
    kb_config.reload()
    return {"ok": True, "keyboard": kb_config.get_info()}


def cmd_shortcut(msg):
    """
    Execute a keyboard shortcut with automatic modifier remapping.

    Example: {"cmd": "shortcut", "modifiers": ["ctrl"], "key": "t"}
    Modifiers can be: ctrl, alt, shift, search

    This handles the user's modifier key remappings automatically.
    """
    modifiers = msg.get("modifiers", [])
    key = msg.get("key")

    if not key:
        return {"error": "shortcut requires 'key'"}

    kb_config = KeyboardConfig.get_instance()
    keycodes = []

    # Map modifier names to logical modifier constants and get physical keycodes
    mod_name_map = {
        "ctrl": MOD_CONTROL,
        "control": MOD_CONTROL,
        "alt": MOD_ALT,
        "search": MOD_SEARCH,
        "meta": MOD_SEARCH,
        "shift": None,  # Shift isn't typically remapped
    }

    for mod in modifiers:
        mod_lower = mod.lower()
        if mod_lower == "shift":
            keycodes.append(KEY_LEFTSHIFT)
        elif mod_lower in mod_name_map:
            logical_mod = mod_name_map[mod_lower]
            physical_keycode = kb_config.get_physical_keycode_for_modifier(logical_mod)
            if physical_keycode:
                keycodes.append(physical_keycode)
        else:
            return {"error": f"unknown modifier: {mod}"}

    # Get keycode for the main key
    # For shortcuts, Chrome uses character-based matching, so we need to
    # translate through the keyboard layout (e.g., Ctrl+T in Dvorak requires
    # the physical key that produces 't', which is the 'k' key position)
    key_lower = key.lower()
    translated_key = kb_config.translate_char_for_layout(key_lower)
    if translated_key in KEY_MAP:
        keycodes.append(KEY_MAP[translated_key])
    elif key_lower.startswith("f") and key_lower[1:].isdigit():
        # Function keys F1-F12
        fnum = int(key_lower[1:])
        if 1 <= fnum <= 12:
            keycodes.append(58 + fnum)  # F1=59, F2=60, etc.
        else:
            return {"error": f"invalid function key: {key}"}
    else:
        return {"error": f"unknown key: {key}"}

    press_keys(keycodes)
    return {"ok": True, "keycodes_sent": keycodes}


COMMANDS = {
    "ping": cmd_ping,
    "tap": cmd_tap,
    "swipe": cmd_swipe,
    "key": cmd_key,
    "type": cmd_type,
    "screenshot": cmd_screenshot,
    "resolution": cmd_resolution,
    "info": cmd_info,
    "reload_config": cmd_reload_config,
    "shortcut": cmd_shortcut,
}


def main():
    """Main loop: read JSON lines from stdin, execute commands, write responses to stdout."""
    # Unbuffered output
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

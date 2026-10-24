"""Independent GTK keyboard/focus oracle and native AT-SPI window events."""
import argparse
import json
import os
from pathlib import Path
import time

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, GLib, Gtk

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
GLib.set_prgname("jstorrent-update-keyboard-oracle")
window = Gtk.Window(title="JSTorrent update keyboard oracle")
window.set_default_size(700, 500)
text = Gtk.TextView()
text.get_accessible().set_name("Update keyboard oracle text")
window.add(text)
events = (root / "focus.jsonl").open("w", buffering=1)


def atomic(name, value):
    temporary = root / (name + ".tmp")
    temporary.write_text(value)
    os.replace(temporary, root / name)


def record(value):
    events.write(json.dumps(dict(value, at=time.monotonic(), critical=(root / "offer").exists())) + "\n")


def content(_buffer):
    buffer = text.get_buffer()
    atomic("editor.txt", buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True))


def native_event(event, *_args):
    try:
        source = event.source
        application = source.get_application()
        name = application.get_name().lower()
        pid = application.get_process_id()
        executable = Path("/proc") / str(pid) / "exe"
        owned_app = executable.resolve().name == "jstorrent-client"
        if ("jstorrent" not in name and not owned_app) or "oracle" in name:
            return
        if source.get_role() not in (Atspi.Role.FRAME, Atspi.Role.DIALOG, Atspi.Role.WINDOW):
            return
        states = source.get_state_set()
        record({"kind": "native-window", "event": event.type,
                "pid": pid,
                "showing": states.contains(Atspi.StateType.SHOWING),
                "visible": states.contains(Atspi.StateType.VISIBLE),
                "minimized": states.contains(Atspi.StateType.ICONIFIED)})
    except Exception as error:
        record({"kind": "observer-error", "message": str(error)[:256]})


listener = Atspi.EventListener.new(native_event, None)
for event in ("window:", "object:state-changed:showing"):
    listener.register(event)
text.get_buffer().connect("changed", content)
window.connect("notify::is-active", lambda *_args: record({"kind": "editor-focus", "active": window.is_active()}))
window.connect("destroy", Gtk.main_quit)
window.show_all()
text.grab_focus()
content(None)
atomic("editor.pid", str(os.getpid()))
previous_tick = time.monotonic()
max_gap = 0.0


def tick():
    global previous_tick, max_gap
    now = time.monotonic()
    max_gap = max(max_gap, now - previous_tick)
    previous_tick = now
    atomic("editor-state.json", json.dumps({"active": window.is_active(), "maxSampleGap": max_gap}))
    if (root / "clear-editor").exists():
        text.get_buffer().set_text("")
        (root / "clear-editor").unlink()
    if (root / "stop").exists():
        Gtk.main_quit()
        return False
    return True


GLib.timeout_add(25, tick)
record({"kind": "ready", "sampleMillis": 25})
Gtk.main()
events.close()

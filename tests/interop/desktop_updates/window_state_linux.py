"""Read current native window states for the isolated desktop host only."""
import json
from pathlib import Path

import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

rows = []
desktop = Atspi.get_desktop(0)
for index in range(min(desktop.get_child_count(), 128)):
    application = desktop.get_child_at_index(index)
    pid = application.get_process_id()
    try:
        if (Path("/proc") / str(pid) / "exe").resolve().name != "jstorrent-client":
            continue
        for child in range(min(application.get_child_count(), 32)):
            window = application.get_child_at_index(child)
            states = window.get_state_set()
            rows.append({"pid": pid, "minimized": states.contains(Atspi.StateType.ICONIFIED),
                         "active": states.contains(Atspi.StateType.ACTIVE),
                         "visible": states.contains(Atspi.StateType.VISIBLE),
                         "showing": states.contains(Atspi.StateType.SHOWING)})
    except FileNotFoundError:
        continue
print(json.dumps(rows))

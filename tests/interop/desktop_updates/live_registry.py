#!/usr/bin/env python3
"""Preserve the exact scoped Windows registration before an owned VM install."""
import argparse
import base64
import json
from pathlib import Path
import winreg
from registry_windows import Registry


def pack(state):
    if state is None:
        return None
    values, children = state
    return {"values": [{"name": name, "value": base64.b64encode(value).decode() if isinstance(value, bytes) else value,
                        "binary": isinstance(value, bytes), "kind": kind} for name, value, kind in values],
            "children": {key: pack(value) for key, value in children.items()}}


def unpack(state):
    if state is None:
        return None
    return ([(row["name"], base64.b64decode(row["value"]) if row["binary"] else row["value"], row["kind"])
             for row in state["values"]], {key: unpack(value) for key, value in state["children"].items()})


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("action", choices=["preserve", "restore"])
args = parser.parse_args()
root = args.root.resolve()
if not (root / ".jstorrent-update-test").is_file():
    raise ValueError("An owned test root is required")
path = root / "original-registry.json"
if args.action == "preserve":
    if path.exists():
        raise ValueError("Registration is already preserved")
    registry = Registry()
    path.write_text(json.dumps({"saved": [[key, view, pack(state)] for key, view, state in registry.saved],
                               "parents": registry.parents}, indent=2))
    registry.isolate_installation()
    print(json.dumps({"preserved": True, "scopes": len(registry.saved)}))
else:
    data = json.loads(path.read_text())
    registry = Registry.__new__(Registry)
    registry.api = winreg
    registry.saved = [(key, view, unpack(state)) for key, view, state in data["saved"]]
    registry.parents = data["parents"]
    registry.restore()
    print(json.dumps({"restored": True, "scopes": len(registry.saved)}))

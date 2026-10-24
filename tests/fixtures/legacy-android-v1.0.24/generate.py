#!/usr/bin/env python3
"""Independently authored source-format examples; no device data or credentials."""
import base64
import copy
import hashlib
import json
from pathlib import Path


def encode(value):
    if isinstance(value, bytes):
        return str(len(value)).encode() + b":" + value
    if isinstance(value, int):
        return b"i" + str(value).encode() + b"e"
    return b"d" + b"".join(encode(key) + encode(value[key]) for key in sorted(value)) + b"e"


def generate():
    uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FGeneratedMigration"
    root_key = hashlib.sha256(uri.encode()).hexdigest()[:16]
    root = {"key": root_key, "uri": uri, "display_name": "Generated migration", "last_stat_ok": True}
    payload = bytes([37]) * 16384
    info = encode({b"length": len(payload), b"name": b"generated.bin", b"piece length": 16384, b"pieces": hashlib.sha1(payload).digest(), b"private": 1})
    digest = hashlib.sha1(info).hexdigest()
    pending_digest = "11" * 20
    wrap = lambda data: json.dumps(base64.b64encode(data).decode())
    prefix = f"session:torrent:{digest}"
    base = {
        "roots": {"roots": [root]}, "preferences": {},
        "kv": {
            "session:torrents": json.dumps({"version": 2, "torrents": [{"infoHash": digest, "source": "file", "addedAt": 0}]}),
            f"{prefix}:state": json.dumps({"userState": "stopped", "storageKey": root_key, "bitfield": "80", "pieceCount": 1, "filePriorities": [0], "uploaded": 999, "downloaded": 999, "updatedAt": 0}),
            f"{prefix}:torrentfile": wrap(b"d4:info" + info + b"e"),
            "config:defaultRootKey": json.dumps(root_key),
            "config:dhtEnabled": "false", "config:pexEnabled": "false",
        },
        "expected": {"records": 1, "format_candidates": 1, "metadata_requires_checking": 1, "pending_magnets": 0, "roots_require_runtime_grant_check": 1, "requires_policy_review": False, "verified_pieces": 0},
    }
    cases = []
    for name in ("intact_stopped", "corrupt_active", "revoked_grant", "cached_magnet_whitespace", "pending_stopped", "awaiting_selection", "missing_root", "nullable_state", "invalid_binary", "vpn_and_unmetered", "ambiguous_root", "empty", "private_default"):
        case = copy.deepcopy(base)
        case["name"] = name
        case["runtime_scenario"] = {"grant": "read_write", "payload": "intact"}
        state = json.loads(case["kv"][f"{prefix}:state"])
        if name == "corrupt_active":
            state["userState"] = "active"
            case["runtime_scenario"]["payload"] = "corrupt"
        if name == "revoked_grant":
            # Stored last_stat_ok remains true deliberately; it proves no access.
            case["runtime_scenario"]["grant"] = "revoked"
        if name == "cached_magnet_whitespace":
            case["kv"]["session:torrents"] = json.dumps({"version": 2, "torrents": [{"infoHash": digest, "source": "magnet", "magnetUri": f"magnet:?xt=urn:btih:{digest}", "addedAt": 0}]})
            encoded = base64.b64encode(info).decode()
            case["kv"][f"{prefix}:infodict"] = json.dumps(encoded[:12] + "\n " + encoded[12:])
            del case["kv"][f"{prefix}:torrentfile"]
        if name == "awaiting_selection":
            state.update(userState="awaitingFileSelection", filePriorities=[1])
        if name == "missing_root":
            state["storageKey"] = "22" * 8
        if name == "private_default":
            state["storageKey"] = "default"
            case["roots"] = {"roots": []}
        if name == "ambiguous_root":
            case["roots"]["roots"].append(copy.deepcopy(root))
        if name in ("missing_root", "nullable_state", "invalid_binary", "ambiguous_root", "private_default"):
            case["expected"].update(format_candidates=0, metadata_requires_checking=0, roots_require_runtime_grant_check=0)
        if name == "vpn_and_unmetered":
            state["userState"] = "queued"
            case["preferences"] = {"vpn_only_enabled": True, "wifi_only_enabled": True}
            case["expected"]["requires_policy_review"] = True
        case["kv"][f"{prefix}:state"] = json.dumps(state)
        if name == "nullable_state":
            case["kv"][f"{prefix}:state"] = None
        if name == "invalid_binary":
            case["kv"][f"{prefix}:torrentfile"] = json.dumps("not-base64!")
        if name == "pending_stopped":
            case["kv"] = {
                "session:torrents": json.dumps({"version": 2, "torrents": [{"infoHash": pending_digest, "source": "magnet", "magnetUri": f"magnet:?xt=urn:btih:{pending_digest}", "addedAt": 0}]}),
                f"session:torrent:{pending_digest}:state": json.dumps({"userState": "stopped", "storageKey": root_key, "magnetSelectOnly": [], "uploaded": 0, "downloaded": 0, "updatedAt": 0}),
            }
            case["expected"].update(metadata_requires_checking=0, pending_magnets=1)
        if name == "empty":
            case["kv"] = {"session:torrents": '{"version":2,"torrents":[]}'}
            case["roots"] = {"roots": []}
            case["expected"].update(records=0, format_candidates=0, metadata_requires_checking=0, roots_require_runtime_grant_check=0)
        cases.append(case)
    return {
        "kind": "independently-authored-format-fixtures", "source_commit": "7b454be4410385f9c4f7f135cb6b16194a2b0409",
        "payload_recipe": {"byte": 37, "length": 16384, "sha256": hashlib.sha256(payload).hexdigest(), "corrupt_byte": 38},
        "cases": cases,
    }


if __name__ == "__main__":
    Path(__file__).with_name("cohort.json").write_text(json.dumps(generate(), indent=2) + "\n", encoding="utf-8")

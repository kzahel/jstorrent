#!/usr/bin/env python3
"""Controlled isolated Android/SAF qualification through Machine Control.

This is debug sideload evidence. It never qualifies a Play installation/update,
modifies inherited packages, clears device logs, or runs a public swarm.
"""
from __future__ import annotations
import argparse
import base64
import struct
import xml.etree.ElementTree as ET
import gc
import json
import re
import shlex
import subprocess
import tempfile
import time
import sys
import hashlib
import uuid
from types import SimpleNamespace
from pathlib import Path

import android_reactive_surface as product
from first_verified_piece import add_seed, create_session, wait_for_listener
from magnet_metadata import create_fixture, magnet_uri

PACKAGE = "org.rstorrent.qualification253"
ACTIVITY = f"{PACKAGE}/org.rstorrent.bootstrap.MainActivity"
FOLDER = "RSTorrentQualification253"
ROOT = f"/sdcard/Download/{FOLDER}"
DRIVER_SOURCE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def create_owned_fixture(path, run_id, phase, payload_size):
    # Concurrent devices must not discover and seed each other's deterministic
    # fixture through the normal product discovery paths. Name is in infohash.
    return create_fixture(path, payload_size=payload_size,
                          root_name=f"qualification253-{run_id}-{phase}")


def observation_payload_size(seconds):
    # 28 MiB is almost exactly an hour at 8 KiB/s, with no scheduling margin.
    # Keep transfer active for the requested hour; release the limit afterward.
    return 40 * 1024 * 1024 if seconds == 3600 else 28 * 1024 * 1024


def reset_owned_profile(adb):
    # Clear storage also revokes runtime permissions. Every new repetition
    # must restore the explicitly selected notification-eligible test setup.
    adb.shell("pm", "clear", PACKAGE)
    adb.shell("pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS")


def observation_result(seconds, transferred, verified, sha1):
    return {
        "status": ("pass" if seconds == 3600 else "bounded_short_run") if verified else "fail",
        "seconds": seconds,
        "seed_payload_upload": transferred,
        "completion": "pass" if verified else "fail",
        "sha1": sha1 if verified else None,
    }


class FreshUiCaptureUnavailable(RuntimeError):
    """Explicit idle or missing-fresh-XML failure, never a transport refusal."""


class DeadlineAdb:
    def __init__(self, adb, deadline, expired_message):
        self.adb, self.deadline, self.expired_message = adb, deadline, expired_message

    def shell(self, *arguments, **options):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(self.expired_message)
        options["timeout"] = min(options.get("timeout", 30), remaining)
        return self.adb.shell(*arguments, **options)


class RemoteAdb:
    def __init__(self, command: list[str]):
        self.command = command

    def wake_display(self, *, timeout=30):
        result = subprocess.run([*self.command, "testbed", "--", "wake"],
                                capture_output=True, text=True, timeout=timeout)
        result.check_returncode()
        output = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", result.stdout)
        response = json.loads(output)
        if not isinstance(response, dict) or response.get("ok") is not True or response.get("error"):
            raise RuntimeError("native display wake was not accepted")

    def run(self, *arguments: str, timeout: float = 30, check: bool = True):
        if arguments[:2] == ("logcat", "-c"):
            raise RuntimeError("device-wide log clearing is prohibited")
        capture = arguments[:3] == ("shell", "uiautomator", "dump")
        deadline = time.monotonic() + timeout
        arguments = tuple("/data/local/tmp/rstorrent253-ui.xml" if value == "/sdcard/rstorrent-window.xml" else value for value in arguments)
        if arguments[0] == "shell":
            arguments = ("shell", "-n", shlex.join(arguments[1:]))
        remote = "export PATH=/bin:/usr/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH\n" + shlex.join(["adb", "-s", "127.0.0.1:5555", *arguments]) + " </dev/null\n"
        for attempt in range(3 if capture else 1):
            if capture:
                # Every retry must produce a fresh XML; never reuse a failed
                # dump's predecessor, even when UIAutomator reports exit zero.
                self.shell("rm", "-f", "/sdcard/rstorrent-window.xml",
                           timeout=max(.1, deadline - time.monotonic()))
            result = subprocess.run([*self.command, "testbed", "--", "shell"], input=remote,
                                    capture_output=True, text=True,
                                    timeout=max(.1, deadline - time.monotonic()))
            result.stdout = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", result.stdout).replace("\r", "")
            idle_failure = capture and "could not get idle state" in (result.stdout + result.stderr).lower()
            missing_capture = False
            if capture and not idle_failure and result.returncode == 0:
                fresh = self.shell("test", "-s", "/sdcard/rstorrent-window.xml", check=False,
                                   timeout=max(.1, deadline - time.monotonic()))
                missing_capture = fresh.returncode == 1
                if missing_capture:
                    result.stderr += "\nUIAutomator produced no fresh owned XML"
                elif fresh.returncode != 0:
                    result = fresh
            if not idle_failure and not missing_capture:
                break
            result.returncode = result.returncode or 1
            if attempt == 2 or time.monotonic() >= deadline:
                break
            time.sleep(min(.3, max(0, deadline - time.monotonic())))
        if check and result.returncode:
            error = FreshUiCaptureUnavailable if capture and (idle_failure or missing_capture) else RuntimeError
            raise error(
                f"owned Android command failed ({result.returncode}): "
                f"stdout={result.stdout[-1500:]!r}; stderr={result.stderr[-1500:]!r}"
            )
        return result

    def shell(self, *arguments: str, **options):
        return self.run("shell", *arguments, **options)


def finish_first_use(adb):
    # A cold ARC launch plus several fresh UIAutomator snapshots can exceed
    # twenty seconds even when each observed transition succeeds.
    deadline = time.monotonic()+45
    ready_snapshots = 0
    while time.monotonic() < deadline:
        nodes = list(product.dump_ui(adb).iter())
        save = product.click_labeled(nodes, {"Save and continue"})
        if save is not None:
            ready_snapshots = 0
            enabled = next((node for node in nodes if node.get("checkable") == "true" and node.get("checked") == "true"), None)
            if enabled is not None:
                product.tap_bounds(adb, enabled.get("bounds"))
                # Compose may reflow the dialog after changing consent. A tap
                # must use the next snapshot's button, not the old geometry.
            else:
                product.tap_bounds(adb, save.get("bounds"))
        elif product.click_labeled(nodes, product.STORAGE_SELECTION_LABELS) is not None:
            ready_snapshots += 1
            if ready_snapshots >= 2:
                return
        else:
            ready_snapshots = 0
        time.sleep(0.5)
    raise RuntimeError("first-use disclosure did not resolve within its stage budget")


def unique_observed_control(adb, field, value):
    nodes = [node for node in product.dump_ui(adb).iter() if node.get(field) == value]
    if len(nodes) != 1:
        raise RuntimeError(f"owned control is absent or ambiguous: {value}")
    return nodes[0]


def wait_unique_observed_control(adb, field, value, *, timeout=30):
    deadline = time.monotonic() + timeout
    bounded = DeadlineAdb(adb, deadline, f"owned control was not observed within {timeout}s: {value}")
    while time.monotonic() < deadline:
        try:
            nodes = [node for node in product.dump_ui(bounded).iter() if node.get(field) == value]
        except FreshUiCaptureUnavailable:
            print(json.dumps({"stage": "owned_control", "status": "fresh_capture_unavailable",
                              "field": field, "value": value}), flush=True)
            time.sleep(min(.5, max(0, deadline - time.monotonic())))
            continue
        if len(nodes) > 1:
            raise RuntimeError(f"owned control is ambiguous: {value}")
        if nodes:
            node = nodes[0]
            coordinates = [int(part) for part in re.findall(r"-?\d+", node.get("bounds", ""))]
            if node.get("enabled") != "true" or len(coordinates) != 4 or coordinates[2] <= coordinates[0] or coordinates[3] <= coordinates[1]:
                raise RuntimeError(f"owned control is disabled or clipped: {value}")
            return node
        time.sleep(min(.5, max(0, deadline - time.monotonic())))
    raise RuntimeError(f"owned control was not observed within {timeout}s: {value}")


def configure_background_observation(adb, *, keep_seeding=False):
    """Use the real owned app's switches; do not change device power policy."""
    def selected(field, value):
        return unique_observed_control(adb, field, value)
    for field, value in [("content-desc", "More options"), ("text", "Settings"),
                         ("text", "Power Management")]:
        product.tap_bounds(adb, selected(field, value).get("bounds"))
    description = "Continue downloads in background"
    switch = selected("content-desc", description)
    if switch.get("checked") != "false" or switch.get("enabled") != "true":
        raise RuntimeError("background qualification requires the observed default-off switch")
    product.tap_bounds(adb, switch.get("bounds"))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if selected("content-desc", description).get("checked") == "true":
            break
        time.sleep(.5)
    else:
        raise RuntimeError("background preference did not become enabled")
    preferences = ET.fromstring(adb.shell("run-as", PACKAGE, "cat", "shared_prefs/product_lifecycle.xml").stdout)
    if not any(n.get("name") == "background_downloads_enabled" and n.get("value") == "true" for n in preferences):
        raise RuntimeError("background preference was not persisted")
    listener_port = None
    if keep_seeding:
        switch = selected("content-desc", "Keep seeding in background")
        if switch.get("checked") != "false" or switch.get("enabled") != "true":
            raise RuntimeError("owned seeding policy is not initially default-off and enabled")
        product.tap_bounds(adb, switch.get("bounds"))
        selected("text", "Keep seeding in background?")
        product.tap_bounds(adb, selected("text", "Keep seeding").get("bounds"))
        if selected("content-desc", "Keep seeding in background").get("checked") != "true":
            raise RuntimeError("owned seeding switch did not enable")
        preferences = ET.fromstring(adb.shell("run-as", PACKAGE, "cat", "shared_prefs/product_lifecycle.xml").stdout)
        if not any(n.get("name") == "background_completion_policy" and n.text == "keep_seeding" for n in preferences):
            raise RuntimeError("owned seeding preference did not persist")
        adb.shell("input", "keyevent", "KEYCODE_BACK")
        product.tap_bounds(adb, selected("text", "Network & Privacy").get("bounds"))
        switch = selected("content-desc", "Incoming connections")
        if switch.get("checked") not in ("false", "true") or switch.get("enabled") != "true":
            raise RuntimeError("owned listener control is not observed and eligible")
        if switch.get("checked") == "false":
            product.tap_bounds(adb, switch.get("bounds"))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            nodes = list(product.dump_ui(adb).iter())
            ports = {int(match.group(1)) for node in nodes
                     for match in re.finditer(r"(?:Listening\([^)]*\bport=|Listening on [^\n]*, port )(\d+)", node.get("text", ""))}
            if len(ports) == 1 and all(0 < port < 65536 for port in ports):
                listener_port = ports.pop()
                break
            time.sleep(.5)
        else:
            raise RuntimeError("actual owned listener port was not observed")
    # Detach the actual view. The existing foreground service owns the transfer.
    adb.shell("input", "keyevent", "KEYCODE_HOME")
    return listener_port


def completed_upload_budget(payload_bytes):
    if not isinstance(payload_bytes, int) or isinstance(payload_bytes, bool) or not 0 < payload_bytes <= 40 * 1024 * 1024:
        raise RuntimeError("owned upload fixture must contain 1..40 MiB of payload")
    baseline = 28 * 1024 * 1024
    return max(120, (120 * payload_bytes + baseline - 1) // baseline)


def verify_completed_upload(adb, fixture, registry, target, listener_port):
    """Reuse the existing controlled leecher and its bounded forward cleanup."""
    budget = completed_upload_budget(fixture.payload_path.stat().st_size)
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "clients/android"))
    import run_bootstrap as bootstrap
    host = json.loads(registry.read_text())["targets"][target]["environment"]["CHROMEBOOK_HOST"]
    class ForwardedAdb:
        def __init__(self):
            self.host = host
        def run(self, arguments, **options):
            return adb.run(*arguments, **options)
    root = fixture.payload_path.parent
    upload_fixture = SimpleNamespace(
        torrent_path=fixture.torrent_path,
        name=root.name,
        expected_file_hashes={str(path.relative_to(root)): hashlib.sha1(path.read_bytes()).hexdigest()
                              for path in root.rglob("*") if path.is_file()},
    )
    return bootstrap.verify_product_upload(ForwardedAdb(), upload_fixture, device_port=listener_port, leech_timeout_seconds=budget)


def owned_torrent_id(log, info_hash):
    if not re.fullmatch(r"[0-9a-f]{40}", info_hash):
        raise RuntimeError("owned fixture hash is malformed")
    identities = set(re.findall(r"\btorrent=(\S+) v1=" + info_hash + r"\b", log))
    if len(identities) != 1 or not re.fullmatch(r"t1-[0-9a-f]{32}", next(iter(identities), "")):
        raise RuntimeError("exactly one owned fixture torrent ID must be observed")
    return identities.pop()


def parse_incoming_observation(line, torrent_id):
    match = re.search(r"\bincoming_peer_snapshot torrent=" + re.escape(torrent_id) +
                      r" available=true port=(\d+) registrations=(\d+) pending=(\d+) "
                      r"established=(\d+) payload=(\d+) rejections=([^ ]*) recent=([^ ]*) "
                      r"counts_truncated=(true|false) recent_truncated=(true|false)$", line)
    if match is None:
        raise RuntimeError("fresh owned incoming observation is unavailable or malformed")
    port, registrations, pending, established, payload = map(int, match.groups()[:5])
    if not 0 < port < 65536 or any(value > 2**64 - 1 for value in (registrations, pending, established, payload)):
        raise RuntimeError("owned incoming observation exceeds field bounds")
    return {"port": port, "registrations": registrations, "pending": pending,
            "established": established, "payload_bytes_sent": payload,
            "rejection_counts": match[6], "recent_rejections": match[7]}


class IncomingObservationTimeout(RuntimeError):
    pass


def observe_owned_incoming(adb, uid, torrent_id, deadline):
    def remaining():
        budget = deadline - time.monotonic()
        if budget <= 2:
            raise IncomingObservationTimeout("owned incoming observation deadline expired")
        return min(15, budget)
    def logs():
        try:
            return adb.run("logcat", "-d", "-v", "threadtime", f"--uid={uid}", "-t", "10000",
                           "RSTorrentProduct:I", "*:S", timeout=remaining()).stdout.splitlines()
        except subprocess.TimeoutExpired:
            if time.monotonic() >= deadline:
                raise IncomingObservationTimeout("owned incoming observation deadline expired") from None
            raise
    marker = f"incoming_peer_snapshot torrent={torrent_id} "
    before = {line for line in logs() if marker in line}
    result = adb.shell("am", "broadcast", "-a", "org.rstorrent.bootstrap.PRODUCT_TEST",
                       "-n", f"{PACKAGE}/org.rstorrent.bootstrap.ProductTestReceiver",
                       "--es", "torrent_id", torrent_id, "--es", "torrent_action", "observe_incoming",
                       timeout=remaining())
    if "result=0" not in result.stdout:
        raise RuntimeError("owned incoming observer broadcast was not accepted")
    while True:
        fresh = [line for line in logs() if marker in line and line not in before]
        if fresh:
            return parse_incoming_observation(fresh[-1], torrent_id)
        time.sleep(min(.5, remaining()))


def wait_owned_seed_readiness(adb, info_hash, receipt, *, timeout=180):
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 180:
        raise RuntimeError("owned seed readiness budget must be within 0..180 seconds")
    beginning = time.monotonic()
    deadline = beginning + timeout
    uid = re.search(r"\buserId=(\d+)\b", adb.shell("dumpsys", "package", PACKAGE,
                                                  timeout=min(15, timeout)).stdout)
    if uid is None:
        raise RuntimeError("owned incoming observer package UID is unavailable")
    log = adb.run("logcat", "-d", "-v", "threadtime", f"--uid={uid[1]}", "-t", "10000",
                  "RSTorrentProduct:I", "*:S", timeout=min(15, timeout)).stdout
    torrent_id = owned_torrent_id(log, info_hash)
    receipt.update(status="pending", torrent_id=torrent_id, info_hash=info_hash, samples=[])
    while time.monotonic() < deadline:
        try:
            observation = observe_owned_incoming(adb, uid[1], torrent_id, min(deadline, time.monotonic() + 25))
        except IncomingObservationTimeout:
            # Structural admission can hold the application's service lock.
            # An unavailable bounded sample is not a fabricated zero or ready
            # registry. Its native future has its own cancellation budget.
            observation = {"status": "sample_timeout"}
        observation["elapsed_seconds"] = round(time.monotonic() - beginning, 2)
        receipt["samples"].append(observation)
        if len(receipt["samples"]) > 32:
            del receipt["samples"][1]
        receipt["elapsed_seconds"] = observation["elapsed_seconds"]
        print(json.dumps({"stage": "incoming_seed_readiness", **observation}), flush=True)
        if observation.get("registrations", 0) > 1:
            receipt["status"] = "refused"
            raise RuntimeError("isolated single-fixture seed registry is ambiguous")
        if observation.get("registrations") == 1:
            receipt["status"] = "ready"
            return observation["port"]
        time.sleep(max(0, min(2, deadline - time.monotonic())))
    receipt["status"] = "timeout"
    raise RuntimeError("owned completed seed did not become registered within its readiness budget")


def diagnostic_rows_match_filter(nodes, minimum, category="", profile="normal"):
    labels = {node.get("text", "") for node in nodes}
    rows = [match.groups() for label in labels
            if (match := re.fullmatch(r"(trace|debug|info|warning|error) · ([a-z][a-z0-9_.]*)", label))]
    levels = {"trace": 0, "debug": 1, "info": 2, "warning": 3, "error": 4}
    if not rows:
        return "No diagnostic records match the current filter" in labels
    return all(levels[level] >= levels[minimum] and
               (not category or value == category or value.startswith(category + ".")
                or profile == "normal" and levels[level] >= levels["warning"])
               for level, value in rows)


def wait_diagnostic_filter_rows(adb, minimum, category=""):
    deadline = time.monotonic() + 30
    bounded = DeadlineAdb(adb, deadline, "actual visible diagnostic rows did not settle to the selected filter")
    while time.monotonic() < deadline:
        try:
            nodes = list(product.dump_ui(bounded).iter())
        except FreshUiCaptureUnavailable:
            print(json.dumps({"stage": "diagnostic_rows", "status": "fresh_capture_unavailable"}), flush=True)
            time.sleep(min(.5, max(0, deadline - time.monotonic())))
            continue
        if diagnostic_rows_match_filter(nodes, minimum, category):
            return nodes
        time.sleep(min(.5, max(0, deadline - time.monotonic())))
    raise RuntimeError("actual visible diagnostic rows did not settle to the selected filter")


def verify_retained_diagnostic_view(adb, capture, expected_name):
    # Real log filters replace the native subscription with a full retained
    # snapshot. Exercise this after a large verified transfer, not an empty
    # first-use view; do not inject backend facts or increase retention.
    uid = re.search(r"\buserId=(\d+)\b", adb.shell("dumpsys", "package", PACKAGE).stdout)
    if uid is None:
        raise RuntimeError("owned diagnostic package UID is unavailable")
    log_args = ("logcat", "-d", "-v", "threadtime", f"--uid={uid[1]}", "-t", "1000")
    baseline = set(adb.run(*log_args).stdout.splitlines())
    adb.shell("am", "start", "-W", "-n", ACTIVITY)
    for field, value in [("content-desc", "More options"), ("text", "Logs"),
                         ("text", "Minimum: info"), ("text", "warning")]:
        product.tap_bounds(adb, wait_unique_observed_control(adb, field, value).get("bounds"))
    wait_unique_observed_control(adb, "text", "Minimum: warning")
    wait_diagnostic_filter_rows(adb, "warning")
    capture("06-retained-diagnostic-warning-filter")
    for field, value in [("text", "Minimum: warning"), ("text", "info")]:
        product.tap_bounds(adb, wait_unique_observed_control(adb, field, value).get("bounds"))
    wait_diagnostic_filter_rows(adb, "info")
    deadline = time.monotonic() + 30
    bounded = DeadlineAdb(adb, deadline, "owned full retained diagnostic view was not observed")
    summary = None
    while time.monotonic() < deadline:
        try:
            labels = {node.get("text", "") for node in product.dump_ui(bounded).iter()}
        except FreshUiCaptureUnavailable:
            print(json.dumps({"stage": "diagnostic_summary", "status": "fresh_capture_unavailable"}), flush=True)
            time.sleep(min(.5, max(0, deadline - time.monotonic())))
            continue
        summaries = [text for text in labels if re.fullmatch(r"source evicted \d+ · local evicted \d+ · subscription resets \d+", text)]
        if "Logs" in labels and "Minimum: info" in labels and len(summaries) == 1:
            match = re.search(r"local evicted (\d+)", summaries[0])
            if int(match[1]) > 0:
                summary = summaries[0]
                break
        time.sleep(min(.5, max(0, deadline - time.monotonic())))
    if summary is None:
        raise RuntimeError("owned full retained diagnostic view was not observed")
    recent = [line for line in adb.run(*log_args).stdout.splitlines() if line not in baseline]
    if any("initial snapshot is" in line and "exceeds" in line for line in recent):
        raise RuntimeError("owned retained diagnostic subscription still exceeds its queue")
    capture("06-retained-diagnostic-view")
    product.tap_bounds(adb, wait_unique_observed_control(adb, "content-desc", "Back").get("bounds"))
    wait_unique_observed_control(adb, "text", "Live")
    wait_unique_observed_control(adb, "text", expected_name)
    capture("06-diagnostic-live-library")
    adb.shell("input", "keyevent", "KEYCODE_HOME")
    return {"actual_live_library_after_filters": True, "actual_filter_replacements": ["warning", "info"], "delivery_health": summary,
            "large_retained_history_observed": True, "snapshot_queue_failure": False}


def capture_failed_upload_peer_view(adb, capture, destination):
    # Preserve actual native rejection/registration facts before finally clears
    # only this owned profile. This is diagnosis after failure, never a pass.
    adb.shell("am", "start", "-W", "-n", ACTIVITY)
    for field, value in [("content-desc", "More options"), ("text", "Logs"),
                         ("text", "Category: all"), ("text", "peer")]:
        product.tap_bounds(adb, wait_unique_observed_control(adb, field, value).get("bounds"))
    wait_unique_observed_control(adb, "text", "Category: peer")
    nodes = wait_diagnostic_filter_rows(adb, "info", "peer")
    destination.write_text(ET.tostring(nodes[0], encoding="unicode"))
    capture("failure-peer-diagnostics")


def reopened_library_action(nodes, expected_name):
    labels = {node.get("text", "") for node in nodes}
    if "Live" in labels and expected_name in labels:
        return "live", None
    if not labels.intersection({"Power Management", "Settings"}):
        return "wait", None
    backs = [node for node in nodes if node.get("content-desc") == "Back"]
    if len(backs) != 1 or backs[0].get("enabled") != "true":
        raise RuntimeError("owned retained-settings Back control is absent, ambiguous or disabled")
    bounds = backs[0].get("bounds", "")
    coordinates = [int(value) for value in re.findall(r"-?\d+", bounds)]
    if len(coordinates) != 4 or coordinates[2] <= coordinates[0] or coordinates[3] <= coordinates[1]:
        raise RuntimeError("owned retained-settings Back control is clipped")
    return "back", bounds


def wait_reopened_library(adb, expected_name, *, timeout=120, wake_display=False):
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 120:
        raise RuntimeError("invalid owned library-reopen budget")
    beginning = time.monotonic()
    deadline = beginning + timeout

    if wake_display:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("joined restart did not restore the live owned library")
        adb.wake_display(timeout=min(30, remaining))
    bounded = DeadlineAdb(adb, deadline, "joined restart did not restore the live owned library")
    back_steps = unavailable_captures = 0
    while time.monotonic() < deadline:
        try:
            action, bounds = reopened_library_action(list(product.dump_ui(bounded).iter()), expected_name)
        except FreshUiCaptureUnavailable:
            unavailable_captures += 1
            print(json.dumps({"stage": "reopened_library", "status": "fresh_capture_unavailable",
                              "unavailable_captures": unavailable_captures,
                              "elapsed_seconds": round(time.monotonic() - beginning, 2)}), flush=True)
        else:
            if action == "live":
                result = {"observed_settings_back_steps": back_steps,
                          "unavailable_reopen_captures": unavailable_captures}
                if wake_display:
                    result["native_display_wake"] = "modifier_only_input_delivered"
                return result
            if action == "back":
                if back_steps >= 2:
                    raise RuntimeError("owned retained-settings navigation exceeded its two-step budget")
                product.tap_bounds(bounded, bounds)
                back_steps += 1
        time.sleep(min(.5, max(0, deadline - time.monotonic())))
    raise RuntimeError("joined restart did not restore the live owned library")


def disable_seeding_and_verify_joined_restart(adb, destination, expected_hash):
    uid = re.search(r"\buserId=(\d+)\b", adb.shell("dumpsys", "package", PACKAGE).stdout)
    if uid is None:
        raise RuntimeError("owned restart package UID is unavailable")
    log_args = ("logcat", "-d", "-v", "threadtime", f"--uid={uid[1]}", "-t", "1000")
    baseline = set(adb.run(*log_args).stdout.splitlines())
    def saf_registry():
        preferences = ET.fromstring(adb.shell("run-as", PACKAGE, "cat", "shared_prefs/product-saf.xml").stdout)
        values = [node.text for node in preferences if node.get("name") == "root-registry-v1"]
        if len(values) != 1 or not values[0]:
            raise RuntimeError("owned retained SAF registry is absent or ambiguous")
        return values[0]
    registry_before = saf_registry()
    adb.shell("am", "start", "-W", "-n", ACTIVITY)
    for field, value in [("content-desc", "More options"), ("text", "Settings"), ("text", "Power Management")]:
        product.tap_bounds(adb, unique_observed_control(adb, field, value).get("bounds"))
    switch = unique_observed_control(adb, "content-desc", "Keep seeding in background")
    if switch.get("checked") != "true":
        raise RuntimeError("owned seeding switch was not retained")
    product.tap_bounds(adb, switch.get("bounds"))
    if unique_observed_control(adb, "content-desc", "Keep seeding in background").get("checked") != "false":
        raise RuntimeError("owned seeding switch did not disable")
    adb.shell("input", "keyevent", "KEYCODE_HOME")
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        logs = adb.run(*log_args).stdout.splitlines()
        joined = [line for line in logs if line not in baseline and "product_shutdown_complete" in line]
        services = adb.shell("dumpsys", "activity", "services", PACKAGE).stdout
        if joined and "ServiceRecord{" not in services:
            break
        time.sleep(1)
    else:
        raise RuntimeError("owned completed-file service did not join shutdown")
    adb.shell("am", "start", "-W", "-n", ACTIVITY)
    actual = adb.shell("sha1sum", destination).stdout.split(" ", 1)[0].strip()
    if actual != expected_hash:
        raise RuntimeError("joined restart changed completed payload bytes")
    if saf_registry() != registry_before:
        raise RuntimeError("joined restart changed the retained SAF registry")
    # A delivered launch and unchanged filesystem bytes do not prove that
    # the restarted client finished restoring its retained library.
    expected_name = Path(destination).parent.name
    navigation = wait_reopened_library(adb, expected_name, wake_display=True)
    return {"shutdown": joined[-1], "service_absent_after_join": True,
            "reopen_sha1": actual, "retained_saf_registry": "unchanged",
            "reopen_live_library": True, **navigation}


def native_maximize_arguments(result):
    # The platform adapter writes human-readable queries to stderr. Duplicate
    # ARC accessibility roots may describe the very same native caption button.
    output = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", result.stdout + "\n" + result.stderr)
    count = re.search(r"(?m)^(\d+) matches$", output)
    if count is None:
        raise RuntimeError("native window query has no match count")
    if int(count[1]) == 0:
        return None
    controls = re.findall(r'(?m)^\[button\] "Maximize" at \((-?\d+),(-?\d+)\) (\d+)x(\d+)$', output)
    if len(controls) != int(count[1]) or len(set(controls)) != 1 or any(int(v) <= 0 for v in controls[0][2:]):
        raise RuntimeError("product window has ambiguous native Maximize controls")
    return ["--nth", "1"]


def select_owned_tree(adb):
    # Maximize the owning product window before DocumentsUI inherits its ARC
    # geometry. Maximizing a previous picker does not persist across tasks.
    window = subprocess.run(
        [*adb.command, "testbed", "--", "desktop-find", "^Maximize$", "--role", "button"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    selection = native_maximize_arguments(window)
    if selection is not None:
        subprocess.run(
            [*adb.command, "testbed", "--", "desktop-action", "^Maximize$", "doDefault", "--role", "button", *selection],
            capture_output=True, text=True, check=True, timeout=30,
        )

    def recover_picker():
        # ARC can place DocumentsUI behind the shelf. Its Android button has
        # zero bounds; use the observed native window action, never a guess.
        result = subprocess.run(
            [*adb.command, "testbed", "--", "desktop-find", "^Maximize$", "--role", "button"],
            capture_output=True, text=True, check=True, timeout=30,
        )
        selection = native_maximize_arguments(result)
        if selection is None:
            raise RuntimeError("clipped SAF picker lacks one native Maximize control")
        subprocess.run(
            [*adb.command, "testbed", "--", "desktop-action", "^Maximize$", "doDefault", "--role", "button", *selection],
            capture_output=True, text=True, check=True, timeout=30,
        )
    try:
        product.select_controlled_tree(adb, recover_picker=recover_picker)
    except product.ScenarioFailure as error:
        # The old helper predates 194's binary retained-root registry. Keep its
        # real picker interaction, then inspect the current independently owned
        # registry rather than expecting a plaintext legacy tree-uri value.
        if str(error) != "product did not persist the controlled SAF tree URI":
            raise
    preferences = ET.fromstring(adb.shell("run-as", PACKAGE, "cat", "shared_prefs/product-saf.xml").stdout)
    encoded = next(node.text for node in preferences if node.get("name") == "root-registry-v1")
    registry = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    if struct.unpack(">II", registry[:8]) != (1, 1) or FOLDER.encode() not in registry:
        raise RuntimeError("owned SAF binding did not commit in the retained-root registry")


def confirm_intake(adb):
    nodes = list(product.dump_ui(adb).iter())
    labels = {"Add"} if any(n.get("text") == "Magnet link from another app" for n in nodes) else {"Download"}
    confirm = product.click_labeled([n for n in nodes if n.get("enabled") == "true"], labels)
    if confirm is not None:
        product.tap_bounds(adb, confirm.get("bounds"))
    return confirm is not None and labels == {"Download"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--seed-address", required=True, help="explicit controller LAN address")
    parser.add_argument("--seed-port", type=int, default=0, help="explicit permitted TCP port, or 0 for a preflighted dynamic port")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--screenshots", type=Path, help="retain actual ChromeOS captures at product checkpoints")
    parser.add_argument("--observe-seconds", type=int, default=3600)
    parser.add_argument("--observation-lifetime", choices=("foreground", "background"), default="foreground",
                        help="background uses the actual app setting and detaches the Android view")
    parser.add_argument("--diagnostics", type=Path, help="new owned directory for bounded, package-scoped failure/observation logs")
    parser.add_argument("--completed-upload", action="store_true",
                        help="real seeding/listener UI, independent background leecher and joined restart")
    parser.add_argument("--targeted-upload", action="store_true",
                        help="only the bounded upload/resubscription/reopen stage; never an hour or cold-repetition pass")
    args = parser.parse_args()
    if args.targeted_upload and not (args.completed_upload and 0 < args.observe_seconds <= 600):
        parser.error("targeted upload requires a completed-upload short run of 1..600 seconds; cannot qualify an hour")
    if not 0 <= args.seed_port <= 65535:
        parser.error("seed port must be 0..65535")
    if not 0 <= args.observe_seconds <= 3600:
        parser.error("observation is bounded to 0..3600 seconds; short runs do not close endurance")
    if args.completed_upload and (args.observation_lifetime != "background" or not args.observe_seconds):
        parser.error("completed upload requires a nonzero background observation")
    command = [str(args.machine_control), "--registry", str(args.registry), "--target", args.target]
    adb = RemoteAdb(command)
    package_uid = None
    if args.diagnostics:
        args.diagnostics.mkdir(parents=True, exist_ok=False)
        package_info = adb.shell("dumpsys", "package", PACKAGE).stdout
        uid = re.search(r"\buserId=(\d+)\b", package_info)
        if uid is None:
            raise RuntimeError("owned qualification package UID is unavailable")
        package_uid = uid[1]
    # Existing picker/durable-grant assertions are reused with exclusively owned
    # identities. No fixed-package install/reset function is invoked.
    product.PACKAGE = PACKAGE
    product.ACTIVITY = ACTIVITY
    product.GRANT_FOLDER = FOLDER
    product.GRANT_PATH = ROOT
    product.require_unlocked(adb)
    if not adb.shell("pm", "path", PACKAGE).stdout.strip().startswith("package:"):
        raise RuntimeError("install and inspect the isolated package before running")
    if adb.shell("test", "-e", ROOT, check=False).returncode == 0:
        raise RuntimeError("qualification folder already exists; refusing inherited payload deletion")
    if adb.shell("test", "-e", "/data/local/tmp/rstorrent253-ui.xml", check=False).returncode == 0:
        raise RuntimeError("qualification UI artifact exists; refusing to overwrite")
    run_id = uuid.uuid4().hex
    records = []
    report = {"schema": "chromeos-android-qualification/v1",
        "driver_source_sha256": DRIVER_SOURCE_SHA256, "cohort": args.target,
              "delivery": "isolated_debug_sideload", "play_installation": "unrun",
              "notification_setup": "granted_after_each_owned_profile_reset",
              "observation_lifetime": args.observation_lifetime,
              "completed_upload_requested": args.completed_upload, "fixture_run_id": run_id,
              "targeted_upload_only": args.targeted_upload,
              "cold_repetition_scope": "unrun_targeted_stage" if args.targeted_upload else "three_current_source",
              "repetitions": records, "result": "fail", "cleanup": "pending"}
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=False)
        report["screenshots"] = []

    def capture(name):
        if args.screenshots is None:
            return
        destination = (args.screenshots / f"{name}.png").resolve()
        subprocess.run([*command, "testbed", "--", "screenshot", str(destination)],
                       check=True, capture_output=True, text=True, timeout=45)
        if not destination.is_file() or destination.stat().st_size == 0:
            raise RuntimeError("product screenshot did not produce an artifact")
        report["screenshots"].append(destination.name)

    def diagnostic(name, *, failure=False):
        if args.diagnostics is None:
            return
        operations = [
            ("logcat", ("logcat", "-d", "-v", "threadtime", f"--uid={package_uid}", "-t", "1000")),
            ("activities", ("shell", "dumpsys", "activity", "-p", PACKAGE, "activities")),
            ("services", ("shell", "dumpsys", "activity", "services", PACKAGE)),
        ]
        if failure:
            operations += [
                ("crash-logcat", ("logcat", "-b", "crash", "-d", "-v", "threadtime", f"--uid={package_uid}", "-t", "1000")),
                ("exit-info", ("shell", "dumpsys", "activity", "exit-info", PACKAGE)),
            ]
        for label, arguments in operations:
            try:
                result = adb.run(*arguments, check=False)
                output = (result.stdout + result.stderr)[-65536:]
            except Exception as error:
                output = f"Diagnostic capture failed: {type(error).__name__}"
            (args.diagnostics / f"{name}-{label}.txt").write_text(output)

    session = create_session()
    session.apply_settings({"listen_interfaces": f"{args.seed_address}:{args.seed_port}", "upload_rate_limit": 8 * 1024, "ignore_limits_on_local_network": False})
    handles = []
    try:
        adb.shell("mkdir", "-p", ROOT)
        adb.shell("pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS")
        adb.shell("am", "start", "-W", "-n", ACTIVITY)
        finish_first_use(adb)
        capture("01-first-use-complete")
        select_owned_tree(adb)
        capture("02-download-folder-selected")
        print(json.dumps({"stage": "owned_saf_ready"}), flush=True)
        with tempfile.TemporaryDirectory(prefix="rstorrent-253-seeds-") as temporary:
            directory = Path(temporary)
            port = wait_for_listener(session, [])
            repetition_count = 0 if args.targeted_upload else 3
            for ordinal in range(1, repetition_count + 1):
                start = time.monotonic()
                fixture = create_owned_fixture(directory / str(ordinal), run_id, str(ordinal), 256 * 1024)
                handle = add_seed(session, fixture.torrent_info, fixture.seed_directory, [])
                handles.append(handle)
                # Cold launch retains the same app/profile/grant. Unique payload
                # names keep repetition records and files independently owned.
                adb.shell("am", "force-stop", PACKAGE)
                adb.shell("am", "start", "-W", "-n", ACTIVITY, "-a", "android.intent.action.VIEW", "-d", magnet_uri(fixture.info_hash, f"{args.seed_address}:{port}"))
                destination = f"{ROOT}/{fixture.payload_path.parent.name}/payload.bin"
                expected = fixture.payload_hash
                deadline = time.monotonic() + 300
                actual = ""
                confirmed = False
                while time.monotonic() < deadline:
                    if not confirmed:
                        confirmed = confirm_intake(adb)
                    actual = adb.shell("sha1sum", destination, check=False).stdout.split(" ", 1)[0].strip()
                    if actual == expected: break
                    time.sleep(2)
                else: raise RuntimeError(f"repetition {ordinal} byte verification timed out")
                capture(f"03-{ordinal}-verified-download")
                # Source-offline restart must retain the verified bytes and grant.
                handle.pause()
                adb.shell("am", "force-stop", PACKAGE)
                adb.shell("am", "start", "-W", "-n", ACTIVITY)
                actual = adb.shell("sha1sum", destination).stdout.split(" ", 1)[0].strip()
                if actual != expected: raise RuntimeError("restart changed downloaded bytes")
                capture(f"04-{ordinal}-source-offline-restart")
                records.append({"ordinal": ordinal, "elapsed_seconds": round(time.monotonic()-start, 2), "bytes": 256*1024, "sha1": actual, "source_offline_restart": "pass"})
                print(json.dumps({"stage": "cold_launch_verified", **records[-1]}), flush=True)
                # Different deterministic torrents use the same exact single-file
                # name. Retire only this owned catalog before the next run.
                adb.shell("am", "force-stop", PACKAGE)
                reset_owned_profile(adb)
                adb.shell("rm", "-f", destination)
                if ordinal < 3 or args.observe_seconds:
                    adb.shell("am", "start", "-W", "-n", ACTIVITY)
                    finish_first_use(adb)
                    select_owned_tree(adb)
            report["result"] = "pass_bounded_repetitions"
            report["observation"] = {"status": "unrun", "seconds": 0}
            if args.observe_seconds:
                # Large metainfo is unrelated to public swarms. Slow the controlled
                # seed so the initial window contains continuous real transfer.
                fixture = create_owned_fixture(directory / "observation", run_id, "observation", observation_payload_size(args.observe_seconds))
                destination = f"{ROOT}/{fixture.payload_path.parent.name}/payload.bin"
                report["observation_fixture"] = {"info_hash": fixture.info_hash, "payload_bytes": fixture.payload_path.stat().st_size, "root_name": fixture.payload_path.parent.name}
                handle = add_seed(session, fixture.torrent_info, fixture.seed_directory, [])
                handles.append(handle)
                # Qualify the real background policy before intake. ARC can
                # detach the view during metadata acquisition; default-off
                # shutdown during that wait is not background-mode evidence.
                if args.observation_lifetime == "background":
                    listener_port = configure_background_observation(adb, keep_seeding=args.completed_upload)
                    report["observed_listener_port_before_intake"] = listener_port
                adb.shell("am", "start", "-W", "-n", ACTIVITY, "-a", "android.intent.action.VIEW", "-d", magnet_uri(fixture.info_hash, f"{args.seed_address}:{port}"))
                deadline = time.monotonic()+300
                while time.monotonic() < deadline:
                    if confirm_intake(adb):
                        break
                    time.sleep(1)
                else: raise RuntimeError("observation intake confirmation timed out")
                if args.observation_lifetime == "background":
                    adb.shell("input", "keyevent", "KEYCODE_HOME")
                    capture("05-background-view-detached")
                beginning = time.monotonic()
                samples = []
                while time.monotonic()-beginning < args.observe_seconds:
                    transferred = int(handle.status().total_payload_upload)
                    samples.append(transferred)
                    report["observation"] = {"status": "running", "seconds": round(time.monotonic()-beginning), "seed_payload_upload": transferred, "completion": "unrun"}
                    if len(samples) % 4 == 1:
                        diagnostic(f"observation-{len(samples):03}")
                    if len(samples) == 3:
                        capture("05-controlled-observation")
                    if len(samples) >= 5 and samples[-1] <= samples[-5]:
                        raise RuntimeError("controlled observation stopped moving for two minutes")
                    print(json.dumps({"stage": "observation", "seconds": round(time.monotonic()-beginning), "seed_payload_upload": transferred}), flush=True)
                    time.sleep(max(0, min(30, args.observe_seconds-(time.monotonic()-beginning))))
                if len(samples) < 2 or samples[-1] <= samples[0]:
                    raise RuntimeError("observation did not show controlled payload movement")
                session.apply_settings({"upload_rate_limit": 0})
                report["completion_seed_limit"] = "released_after_observation"
                verified = False
                deadline = time.monotonic()+300
                while time.monotonic() < deadline:
                    actual = adb.shell("sha1sum", destination, check=False).stdout.split(" ", 1)[0].strip()
                    if actual == fixture.payload_hash:
                        verified = True
                        break
                    time.sleep(2)
                report["observation"] = observation_result(args.observe_seconds, samples[-1], verified, actual)
                if verified:
                    capture("06-observation-verified")
                if not verified:
                    raise RuntimeError("observation completion did not verify within the recovery budget")
                if args.completed_upload:
                    report["retained_diagnostic_view"] = verify_retained_diagnostic_view(adb, capture, fixture.payload_path.parent.name)
                    handle.pause()
                    report["incoming_seed_readiness"] = {}
                    listener_port = wait_owned_seed_readiness(adb, fixture.info_hash, report["incoming_seed_readiness"])
                    report["upload_verification"] = {"status": "running", "leecher_budget_seconds": completed_upload_budget(fixture.payload_path.stat().st_size)}
                    upload_beginning = time.monotonic()
                    try:
                        uploaded = verify_completed_upload(adb, fixture, args.registry, args.target, listener_port)
                    except BaseException:
                        report["upload_verification"]["status"] = "fail"
                        raise
                    else:
                        report["upload_verification"]["status"] = "pass_independent_file_hashes"
                    finally:
                        report["upload_verification"]["verification_call_seconds"] = round(time.monotonic() - upload_beginning, 2)
                    report["completed_background_upload"] = {"payload_bytes": uploaded, "sha1": fixture.payload_hash,
                                                             "actual_listener_port": listener_port}
                    diagnostic("completed-background-upload")
                    capture("07-completed-background-upload")
                    report["joined_completion_restart"] = disable_seeding_and_verify_joined_restart(
                        adb, destination, fixture.payload_hash)
                    diagnostic("joined-restart")
                    capture("08-joined-completion-restart")
                    report["result"] = ("pass_targeted_upload" if args.targeted_upload else
                                        "pass_end_to_end_background_hour" if args.observe_seconds == 3600 else
                                        "pass_bounded_repetitions_and_upload")
    except BaseException:
        report["result"] = "fail"
        if report.get("observation", {}).get("status") == "running":
            report["observation"]["status"] = "fail"
        diagnostic("failure", failure=True)
        if report.get("retained_diagnostic_view") and args.diagnostics is not None:
            try:
                capture_failed_upload_peer_view(adb, capture, args.diagnostics / "failure-peer-view.xml")
            except Exception as error:
                report["peer_diagnostic_capture_failure"] = str(error)
        try:
            capture("failure")
        except Exception as error:
            report["screenshot_failure"] = type(error).__name__
        raise
    finally:
        cleaned = True
        for arguments in [("am", "force-stop", PACKAGE), ("pm", "clear", PACKAGE),
                          ("rm", "-rf", ROOT), ("rm", "-f", "/sdcard/rstorrent-window.xml")]:
            try:
                cleaned = adb.shell(*arguments, check=False).returncode == 0 and cleaned
            except Exception:
                cleaned = False
        session.pause()
        for handle in handles: session.remove_torrent(handle)
        handles.clear()
        session = None
        gc.collect()
        try:
            cleaned = adb.shell("test", "-e", ROOT, check=False).returncode == 1 and cleaned
        except Exception:
            cleaned = False
        report["cleanup"] = "ok" if cleaned else "fail"
        if not cleaned:
            report["result"] = "fail"
        args.output.write_text(json.dumps(report, indent=2)+"\n")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

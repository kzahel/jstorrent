"""Actual old-client updater handoff shared by claimed installed rehearsals."""
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import time
import hashlib


def executable_digest(app):
    binary = (app / "jstorrent-desktop.exe" if os.name == "nt" else
              app / "Contents/MacOS/jstorrent-desktop" if sys.platform == "darwin" else app)
    hash_value = hashlib.sha256()
    with binary.open("rb") as source:
        for chunk in iter(lambda: source.read(65536), b""):
            hash_value.update(chunk)
    return hash_value.hexdigest()


def assert_gui_source(before, after, active_profile):
    """An old GUI is a writer; compare values, then freeze after it joins."""
    assert after["profiles"] == before["profiles"], "legacy GUI changed fixture values"
    inactive = lambda files: {key: value for key, value in files.items()
                              if not key.startswith("profiles/" + active_profile + "/")}
    assert inactive(after["files"]) == inactive(before["files"]), "inactive legacy profile changed"


def owned_pids(app):
    if os.name == "nt":
        # Only exact executable paths in the isolated installation count.
        command = "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
        rows = json.loads(subprocess.check_output(["powershell.exe", "-NoProfile", "-Command", command], timeout=30)) or []
        if isinstance(rows, dict):
            rows = [rows]
        return [int(row["ProcessId"]) for row in rows if (row.get("ExecutablePath") or "").lower().startswith(str(app).lower() + "\\")]
    if sys.platform == "darwin":
        rows = subprocess.check_output(["ps", "-ww", "-U", str(os.getuid()), "-o", "pid=,command="], timeout=10).decode().splitlines()
        return [int(row.strip().split(None, 1)[0]) for row in rows if len(row.strip().split(None, 1)) == 2 and row.strip().split(None, 1)[1].startswith(str(app) + "/")]
    result = []
    for path in Path("/proc").glob("[0-9]*/environ"):
        try:
            if path.stat().st_uid == os.getuid() and ("APPIMAGE=" + str(app)).encode() in path.read_bytes().split(b"\0"):
                result.append(int(path.parent.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    return result


def stop_owned(app):
    """Join updater-spawned owners before restoring their installed files."""
    for force in (False, True):
        for pid in owned_pids(app):
            if os.name == "nt":
                command = ["taskkill.exe", "/PID", str(pid), "/T"]
                if force:
                    command.append("/F")
                subprocess.run(command, capture_output=True, timeout=15)
            else:
                try:
                    os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)
                except ProcessLookupError:
                    pass
        end = time.monotonic() + 15
        while time.monotonic() < end:
            if not owned_pids(app):
                return
            time.sleep(0.1)
    raise RuntimeError("owned updater processes did not join; retain restoration backups")


def check_and_apply(args, native, app, launch, wait_until, phase, installed, results):
    raw = args.trial_installation_id.read_text().strip()
    import uuid
    assert str(uuid.UUID(raw)) == raw
    (native / "cfu-id").write_text(raw)
    result_path = native / "update-check-result.json"
    result_path.unlink(missing_ok=True)
    check = launch("legacy", ("--check-update",))
    wait_until(lambda: check.poll() is not None, seconds=180)
    assert check.wait() == 0
    status = json.loads(result_path.read_text())
    assert status.get("available") is True and status.get("version") == "0.3.0" and not status.get("error"), status
    assert not installed(), "check-only unexpectedly replaced the legacy app"
    results["checks"].append("old-unmodified-HTTPS-check-offers-pinned-successor")
    if args.trial_negative:
        before = set(owned_pids(app))
        assert not before, "negative update requires a stopped installation"
        legacy_digest = executable_digest(app)
        negative = launch("legacy", ("--auto-update",))
        phase("negative-updating")
        if args.trial_negative == "interrupted":
            log = args.root / "legacy.log"
            # Small NSIS downloads can finish within the general 250-ms poll.
            # Observe progress without hashing installed files or spawning a
            # shell before cancellation. The Popen handle owns this exact
            # Windows process; no installer child exists during download.
            deadline = time.monotonic() + 120
            while True:
                progress = log.read_text(errors="replace") if log.exists() else ""
                if "download progress:" in progress:
                    assert "download complete, installing" not in progress, "download completed before interruption"
                    break
                assert negative.poll() is None, "updater exited before download progress"
                assert time.monotonic() < deadline, "download progress timed out"
                time.sleep(0.01)
            if os.name == "nt":
                negative.kill()
            elif sys.platform == "linux":
                # The extract-and-run AppImage may have a launcher parent.
                # Its driver-created process group owns the whole attempt.
                os.killpg(negative.pid, signal.SIGTERM)
            else:
                os.kill(negative.pid, signal.SIGTERM)
            results["interruptedDownloadProgressObserved"] = True
        wait_until(lambda: negative.poll() is not None, seconds=180)
        if args.trial_negative == "wrong-signature":
            result = json.loads((native / "update-check-result.json").read_text())
            assert "Install failed" in result.get("error", "") and "signature" in result["error"].lower(), result
        wait_until(lambda: set(owned_pids(app)) == before, seconds=30)
        assert not installed()
        assert executable_digest(app) == legacy_digest, "negative update changed legacy executable"
        results["negativeLegacyExecutableSha256"] = legacy_digest
        results["checks"].append(args.trial_negative + "-preserves-old-installation")
        phase("negative-complete")
        wait_until(lambda: (args.root / "allow-retry").is_file(), seconds=1800)
    arguments = ("--force-desktop", "--profile", args.rehearsal_profile) if args.trial_gui else ("--auto-update",)
    updating = launch("legacy", arguments)
    phase("signed-update-gui" if args.trial_gui else "signed-updating")
    wait_until(installed, seconds=600)
    results["checks"].append("old-updater-download-authenticates-and-installs-successor")
    # The ordinary updater owns OS restart. The controller uses native Quit;
    # the driver independently joins every executable in its installed scope.
    return updating

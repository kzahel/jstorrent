#!/usr/bin/env python3
"""Rehearse a real signed update inside a claimed Machine Control VM.

Run under `machine-control --target macos run -- ...`, or supply a live
--target/--claim explicitly. This runner owns only a fresh qualification
installation, its data root, fixture CA/processes and editor-field edits.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
GUEST_ROOT = "/tmp/jstorrent-355-update"
IDENTIFIER = "com.jstorrent.qualification.update"


class Rehearsal:
    def __init__(self, args):
        self.args = args
        self.prefix = [str(args.machine_control)]
        if args.target:
            self.prefix += ["--target", args.target]
        if args.claim:
            self.prefix += ["--claim", args.claim]
        self.report = {"schema": "jstorrent-unattended-update-rehearsal/v1", "scenario": args.scenario,
                       "fault": args.fault, "checks": [], "passed": False, "cleanupPassed": False}
        self.created = False
        self.original_text = None

    def mc(self, *arguments, input_bytes=None, timeout=90):
        result = subprocess.run([*self.prefix, *arguments], input=input_bytes, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f"Machine Control {arguments[0]} failed: " + result.stderr.decode(errors="replace")[-1200:] + result.stdout.decode(errors="replace")[-1200:])
        return result.stdout.decode()

    def desktop(self, *arguments):
        value = json.loads(self.mc("desktop", *arguments))
        if not value.get("accepted"):
            raise RuntimeError("Desktop action refused: " + str(value.get("errorCode")))
        return value.get("data", {})

    def python(self, code, *arguments):
        return self.mc("os", "--", "/usr/bin/python3", "-c", code, *map(str, arguments))

    def save(self):
        self.args.output.write_text(json.dumps(self.report, indent=2) + "\n")

    def check(self, name, passed):
        self.report["checks"].append({"name": name, "passed": bool(passed)})
        self.save()
        if not passed:
            raise AssertionError(name)

    def field(self):
        snapshot = self.desktop("snapshot", "--target", "org.machine-control.fixture", "--query", "Text")
        return next(row for row in snapshot["elements"] if row.get("identifier") == "fixture.text")

    def start(self, arguments, name, env=None):
        code = "import json,os,pathlib,subprocess,sys; root=pathlib.Path(sys.argv[1]); env=dict(os.environ,**json.loads(sys.argv[3])); out=(root/sys.argv[2]).open('wb'); p=subprocess.Popen(sys.argv[4:],stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.STDOUT,env=env,start_new_session=True); print(p.pid)"
        return int(self.python(code, GUEST_ROOT, name, json.dumps(env or {}), *arguments).strip())

    def read(self, name):
        return self.python("from pathlib import Path; import sys; p=Path(sys.argv[1]); print(p.read_text() if p.exists() else '')", GUEST_ROOT + "/" + name)

    def run(self):
        fixture = json.loads((self.args.fixture / "fixture.json").read_text())
        if fixture["platform"] != "darwin":
            raise ValueError("This native runner currently requires macOS fixture packages")
        if fixture.get("fixtureTrust") != "build-scoped": raise ValueError("Rebuild fixture with build-scoped TLS trust")
        self.report["fixture"] = fixture
        self.mc("target", "ensure-ready")
        self.python("from pathlib import Path; import sys; p=Path(sys.argv[1]); p.mkdir(mode=0o700)", GUEST_ROOT)
        self.created = True
        with tempfile.TemporaryDirectory(prefix="jstorrent-355-transfer-") as transfer:
            archive = Path(transfer) / "fixture.tar"
            with tarfile.open(archive, "w") as packed:
                packed.add(self.args.fixture / "fixture.json", arcname="fixture.json")
                for name in ("server.pem", "server.key"):
                    if (self.args.fixture / name).exists(): packed.add(self.args.fixture / name, arcname=name)
                for version in ("100.0.1", "100.0.2"):
                    for path in (self.args.fixture / version).iterdir():
                        if path.is_file():
                            packed.add(path, arcname=version + "/" + path.name)
                packed.add(ROOT / "tests/interop/desktop_updates/guest.py", arcname="guest.py")
                packed.add(ROOT / "tests/interop/desktop_updates/focus_macos.swift", arcname="focus.swift")
                packed.add(ROOT / "crates/rstorrent-session/tests/fixtures/product/v2.sqlite", arcname="product-v2.sqlite")
            self.mc("testbed", "--", "exec", "-i", "/usr/bin/tar", "-xf", "-", "-C", GUEST_ROOT, input_bytes=archive.read_bytes(), timeout=120)
        setup = r'''
import hashlib, pathlib, shutil, ssl, subprocess, sys, tarfile
root=pathlib.Path(sys.argv[1]).resolve(); runtime=root/'runtime'; (runtime/'config').mkdir(parents=True)
shutil.copy2(root/'product-v2.sqlite', runtime/'config/product.db')
with tarfile.open(next((root/'100.0.1').glob('*.tar.gz'))) as archive:
 for member in archive.getmembers():
  target=(root/member.name).resolve()
  if root not in target.parents or not (member.isfile() or member.isdir()): raise ValueError('Unsafe fixture archive')
 archive.extractall(root)
print(hashlib.sha1(ssl.PEM_cert_to_DER_cert((root/'server.pem').read_text())).hexdigest().upper())
'''
        self.report["testCertificateSha1"] = self.python(setup, GUEST_ROOT).strip().splitlines()[-1]
        self.python("from pathlib import Path; import sys; Path(sys.argv[1]).write_text(sys.argv[2])", GUEST_ROOT + "/fault", self.args.fault)
        self.mc("os", "--", "/usr/bin/swiftc", GUEST_ROOT + "/focus.swift", "-o", GUEST_ROOT + "/focus-observer")
        env = {"RSTORRENT_DESKTOP_DATA_ROOT": GUEST_ROOT + "/runtime"}
        self.start(["/usr/bin/python3", GUEST_ROOT + "/guest.py", "serve", "--root", GUEST_ROOT], "feed.log", env)
        self.start([GUEST_ROOT + "/focus-observer", "1200", GUEST_ROOT + "/offer"], "focus.jsonl")
        deadline = time.monotonic() + 20
        while "ready" not in self.read("feed-ready"):
            if time.monotonic() > deadline:
                raise TimeoutError("Fixture feed startup failed: " + self.read("feed.log"))
            time.sleep(.25)
        field = self.field()
        self.original_text = field.get("value", "")
        self.desktop("action", "--reference", field["reference"], "--action", "set_value", "--text", "")
        self.check("editor-is-empty-before-critical-interval", self.field().get("value", "") == "")
        field = self.field()
        self.desktop("action", "--reference", field["reference"], "--action", "focus")
        executable = GUEST_ROOT + "/JSTorrent Update Qualification.app/Contents/MacOS/jstorrent-client"
        presentation = {"closed": "unfocused", "hidden": "hidden", "unfocused": "unfocused", "minimized": "minimized", "foreground": "foreground", "switch-away": "foreground"}[self.args.scenario]
        launch_args = [executable, "--update-presentation=" + presentation]
        if self.args.scenario == "switch-away": launch_args.append("--qualification-hold-relaunch")
        self.report["oldPid"] = self.start(launch_args, "application.log", env)
        self.start(["/usr/bin/python3", GUEST_ROOT + "/guest.py", "watch", "--root", GUEST_ROOT, "--timeout", "1200"], "watch.log", env)
        if self.args.scenario == "closed":
            deadline = time.monotonic() + 45
            while '"connected"' not in self.read("observations.json"):
                if time.monotonic() >= deadline: raise TimeoutError("A did not initialize before closing its window")
                time.sleep(.25)
            self.desktop("call", json.dumps({"operation": "window.close", "target": IDENTIFIER}))
            self.python("import os,sys; os.kill(int(sys.argv[1]),0)", self.report["oldPid"])
            self.check("closing-existing-window-retains-background-host", True)
        # Starting the app is setup. Establish the independent editor as the
        # foreground owner once; later typing deliberately omits --target.
        if presentation != "foreground":
            self.desktop("application", "activate", "--target", "org.machine-control.fixture")
            field = self.field()
            self.desktop("action", "--reference", field["reference"], "--action", "focus")
        self.python("from pathlib import Path; import sys; (Path(sys.argv[1])/'offer').touch()", GUEST_ROOT)
        expected = ""
        switched = False
        updated_at = None
        deadline = time.monotonic() + max(180, fixture["quietSeconds"] + 180)
        while time.monotonic() < deadline:
            if self.args.scenario == "switch-away" and not switched:
                if "old process exited" in self.read("runtime/config/update-cache/relaunch-waiting"):
                    self.desktop("application", "activate", "--target", "org.machine-control.fixture")
                    field = self.field()
                    self.desktop("action", "--reference", field["reference"], "--action", "focus")
                    self.desktop("input", "text", "355_switch ")
                    expected += "355_switch "
                    self.python("from pathlib import Path; import sys; Path(sys.argv[1]).touch()", GUEST_ROOT + "/runtime/config/update-cache/relaunch-release")
                    switched = True
            if presentation != "foreground" or switched:
                text = f"355_{len(expected):04d} "
                self.desktop("input", "text", text)
                expected += text
            if self.args.fault != "none" and '"phase": "error"' in self.read("observations.json"):
                break
            if "100.0.2" in self.read("updated"):
                updated_at = updated_at or time.monotonic()
                if time.monotonic() - updated_at >= 5: break
            time.sleep(.25)
        else:
            raise TimeoutError("Real A-to-B update timed out: " + self.read("last-error") + self.read("application.log")[-2000:] + self.read("watch.log")[-1000:])
        if self.args.fault != "none":
            observations = json.loads(self.read("observations.json"))
            self.report["updateObservations"] = observations
            self.check("negative-update-is-reported", any(item.get("phase") == "error" for item in observations))
            code = r'''
import hashlib,json,os,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]); os.kill(int(sys.argv[2]),0)
with tarfile.open(next((root/'100.0.1').glob('*.tar.gz'))) as archive:
 member=next(member for member in archive.getmembers() if member.name.endswith('/Contents/MacOS/jstorrent-client'))
 expected=hashlib.sha256(archive.extractfile(member).read()).hexdigest()
binary=root/'JSTorrent Update Qualification.app/Contents/MacOS/jstorrent-client'
print(json.dumps({'originalAlive':True,'hashUnchanged':hashlib.sha256(binary.read_bytes()).hexdigest()==expected,'cached':(root/'runtime/config/update-cache/payload').is_file(),'updated':(root/'updated').exists()}))
'''
            retained = json.loads(self.python(code, GUEST_ROOT, self.report["oldPid"]))
            self.report["retained"] = retained
            self.check("negative-update-retains-original-process-and-executable", retained["originalAlive"] and retained["hashUnchanged"] and not retained["updated"])
            self.check("only-verified-downloads-remain-cached", retained["cached"] == (self.args.fault in ("withdrawn", "offline")))
            self.report["passed"] = True
            self.save()
            return
        self.check("new-host-reports-compiled-version-B", "100.0.2" in self.read("updated"))
        self.report["updateObservations"] = json.loads(self.read("observations.json"))
        events = [json.loads(line) for line in self.read("focus.jsonl").splitlines() if line.strip()]
        self.report["focusEvents"] = events
        critical_events = [event for event in events if event.get("critical", True)]
        if presentation != "foreground":
            self.check("background-update-never-activates-JSTorrent", not any(event.get("watched") for event in critical_events if event.get("kind") == "focus"))
            actual_text = self.field().get("value", "")
            self.report["keyboard"] = {"expectedLength": len(expected), "actualLength": len(actual_text), "expectedSha256": hashlib.sha256(expected.encode()).hexdigest(), "actualSha256": hashlib.sha256(actual_text.encode()).hexdigest(), "firstDifference": next((index for index, (a, b) in enumerate(zip(expected, actual_text)) if a != b), min(len(expected), len(actual_text)))}
            self.check("all-untargeted-keyboard-input-reaches-editor", actual_text == expected)
        if self.args.scenario in ("closed", "hidden", "minimized"):
            self.check("hidden-or-minimized-update-never-shows-native-window", not any(event.get("windows") for event in critical_events if event.get("kind") == "visibility"))
        if self.args.scenario == "switch-away":
            self.check("switch-away-during-process-gap-exercised", switched)
            self.check("new-host-does-not-activate-over-new-input", not any(event.get("watched") and event.get("pid") != self.report["oldPid"] for event in events if event.get("kind") == "focus"))
            self.check("switch-away-input-reaches-editor", self.field().get("value", "") == expected)
        if self.args.scenario == "foreground":
            self.check("foreground-is-restored", self.desktop("applications")["applications"] and any(app.get("bundleId") == IDENTIFIER and app.get("active") for app in self.desktop("applications")["applications"]))
        code = r'''
import hashlib,json,os,pathlib,sqlite3,subprocess,sys,tarfile
root=pathlib.Path(sys.argv[1]); binary=root/'JSTorrent Update Qualification.app/Contents/MacOS/jstorrent-client'
with tarfile.open(next((root/'100.0.2').glob('*.tar.gz'))) as archive:
 member=next(member for member in archive.getmembers() if member.name.endswith('/Contents/MacOS/jstorrent-client'))
 expected=hashlib.sha256(archive.extractfile(member).read()).hexdigest()
actual=hashlib.sha256(binary.read_bytes()).hexdigest()
rows=subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines()
pids=[int(row.strip().split(None,1)[0]) for row in rows if len(row.strip().split(None,1))==2 and row.strip().split(None,1)[1].startswith(str(binary)) and '--desktop-update-relaunch' not in row]
connection=sqlite3.connect(root/'runtime/config/product.db'); enabled,attempt=connection.execute('SELECT automatic_install,attempt FROM desktop_update_state').fetchone(); stats=connection.execute('SELECT statistics_enabled FROM product_state').fetchone()[0]
print(json.dumps({'installedHashMatchesB':actual==expected,'newPids':pids,'statisticsOptOutPreserved':stats==0,'automaticInstall':enabled,'attempt':json.loads(attempt)}))
'''
        installed = json.loads(self.python(code, GUEST_ROOT))
        self.report["installed"] = installed
        self.check("installed-executable-matches-signed-B", installed["installedHashMatchesB"])
        self.check("one-new-host-and-old-process-gone", len(installed["newPids"]) == 1 and self.report["oldPid"] not in installed["newPids"])
        self.check("statistics-opt-out-survives-update", installed["statisticsOptOutPreserved"])
        self.check("success-recorded-after-B-startup", installed["attempt"]["succeeded"])
        self.report["passed"] = True
        self.save()

    def cleanup(self):
        errors = []
        if self.original_text is not None:
            try:
                field = self.field()
                if field.get("value", "") != self.original_text:
                    self.desktop("action", "--reference", field["reference"], "--action", "set_value", "--text", self.original_text)
                    if self.field().get("value", "") != self.original_text: raise AssertionError("Editor restoration failed")
            except Exception as error:
                errors.append(str(error))
        if self.created:
            try:
                code = r'''
import os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(sys.argv[1]); rows=subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines(); pids=[]
for row in rows:
 parts=row.strip().split(None,1)
 if len(parts)!=2: continue
 pid=int(parts[0]); command=parts[1]
 if pid==os.getpid() or not (command.startswith(str(root)+'/') or (' '+str(root)+'/guest.py ') in command): continue
 pids.append(pid)
for pid in pids:
 try: os.kill(pid,signal.SIGTERM)
 except ProcessLookupError: pass
end=time.monotonic()+8
while time.monotonic()<end and pids:
 for pid in list(pids):
  try: os.kill(pid,0)
  except ProcessLookupError: pids.remove(pid)
 time.sleep(.1)
for pid in pids:
 try: os.kill(pid,signal.SIGKILL)
 except ProcessLookupError: pass
'''
                self.python(code, GUEST_ROOT)
                self.python("import pathlib,shutil,sys; p=pathlib.Path(sys.argv[1]); assert p.name=='jstorrent-355-update' and p.parent==pathlib.Path('/tmp'); shutil.rmtree(p)", GUEST_ROOT)
            except Exception as error:
                errors.append(str(error))
        self.report["cleanupPassed"] = not errors
        if errors:
            self.report["cleanupErrors"] = errors
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, default=ROOT.parent / "machine-control/bin/machine-control")
    parser.add_argument("--target")
    parser.add_argument("--claim")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fault", choices=["none", "bad-signature", "oversized", "interrupted", "withdrawn", "offline"], default="none")
    parser.add_argument("--scenario", choices=["closed", "hidden", "unfocused", "minimized", "foreground", "switch-away"], default="hidden")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite an evidence report")
    test = Rehearsal(args)
    try:
        test.run()
    except Exception as error:
        test.report["error"] = str(error)
        test.save()
        raise
    finally:
        test.cleanup()
    if not test.report["cleanupPassed"]:
        raise SystemExit("Rehearsal cleanup failed; retain the claim for recovery")
    print("Synthetic installed update and cleanup passed")


if __name__ == "__main__":
    main()

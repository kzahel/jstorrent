#!/usr/bin/env python3
"""Rehearse signed AppImage replacement in a claimed GNOME Wayland guest."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import time
import zipfile

REPO = Path(__file__).resolve().parents[1]
ROOT = "/tmp/jstorrent-355-update"


class Run:
    def __init__(self, args):
        self.args = args
        self.prefix = [str(args.machine_control), "--target", args.target, "--claim", args.claim]
        self.created = False
        self.report = {"schema": "jstorrent-appimage-update-rehearsal/v1", "scenario": args.scenario,
                       "passed": False, "cleanupPassed": False, "checks": []}

    def mc(self, *arguments, data=None, timeout=180):
        for attempt in range(3):
            result = subprocess.run([*self.prefix, *arguments], input=data, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=timeout)
            detail = result.stderr.decode(errors="replace").strip()
            if result.returncode and attempt < 2 and not result.stdout.strip() and detail and all(message in (
                "The provider could not resolve the configured target identity.",
                "UTM automation is unavailable; refusing library recovery and CLI retries",
            ) for message in detail.splitlines()):
                self.report["preflightRefusals"] = self.report.get("preflightRefusals", 0) + 1
                time.sleep(attempt + 1)
                continue
            break
        if result.returncode:
            raise RuntimeError("Machine Control refused " + arguments[0] + ": " + result.stderr.decode(errors="replace")[-1200:] + result.stdout.decode(errors="replace")[-1200:])
        return result.stdout.decode().strip()

    def python(self, code, *args, **kwargs):
        return self.mc("os", "--", "/usr/bin/python3", "-c", code, *map(str, args), **kwargs)

    def files(self):
        return json.loads(self.python("import json,pathlib,sys; r=pathlib.Path(sys.argv[1]); print(json.dumps({p.name:p.read_text() for p in r.iterdir() if p.is_file() and p.name in ('editor.txt','editor-state.json','observations.json','updated','last-error','serve-error','watch-error','focus.jsonl','application.log','editor.log')}))", ROOT))

    def save(self):
        self.args.output.write_text(json.dumps(self.report, indent=2) + "\n")

    def check(self, name, value):
        self.report["checks"].append({"name": name, "passed": bool(value)})
        self.save()
        if not value:
            raise AssertionError(name)

    def run(self):
        self.mc("target", "ensure-ready")
        self.python("import pathlib;p=pathlib.Path('/proc');assert not any((r/'comm').read_text().strip() in ('jstorrent-client','jstorrent-clien') for r in p.iterdir() if r.name.isdecimal() and (r/'comm').exists()),'A JSTorrent host already exists'")
        ids = self.mc("testbed", "--", "user-exec", "--", "/usr/bin/id", "-u").strip()
        if not ids.isdecimal() or int(ids) == 0:
            raise ValueError("Qualification requires an ordinary desktop user")
        self.python("import pathlib,sys;pathlib.Path(sys.argv[1]).mkdir(mode=0o700)", ROOT)
        self.created = True
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as packed:
            for name in ("guest.py", "editor_linux.py", "window_state_linux.py"):
                packed.write(REPO / "tests/interop/desktop_updates" / name, name)
            packed.write(REPO / "crates/rstorrent-session/tests/fixtures/product/v2.sqlite", "product-v2.sqlite")
        self.python("import io,pathlib,sys,zipfile;zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).extractall(pathlib.Path(sys.argv[1]))", ROOT, data=archive.getvalue())
        setup = '''import json,os,pathlib,shutil,sys
r=pathlib.Path(sys.argv[1]); f=pathlib.Path(sys.argv[2]); uid=int(sys.argv[3])
for name in ('fixture.json','server.pem','server.key'): shutil.copy2(f/name,r/name)
for version in ('100.0.1','100.0.2'): shutil.copytree(f/version,r/version)
(r/'runtime/config').mkdir(parents=True);shutil.copy2(r/'product-v2.sqlite',r/'runtime/config/product.db')
image=next((r/'100.0.1').glob('*.AppImage'));shutil.copy2(image,r/'installed.AppImage');(r/'installed.AppImage').chmod(0o700)
for path in [r,*r.rglob('*')]:os.chown(path,uid,-1)
print((r/'fixture.json').read_text())'''
        self.report["fixture"] = json.loads(self.python(setup, ROOT, self.args.guest_fixture, ids))
        launch = '''import os,pathlib,subprocess,sys
r=pathlib.Path(sys.argv[1]);env=dict(os.environ,RSTORRENT_DESKTOP_DATA_ROOT=str(r/'runtime'),APPIMAGE_EXTRACT_AND_RUN='1')
commands=[('feed',[sys.executable,str(r/'guest.py'),'serve','--root',str(r)]),('editor',[sys.executable,str(r/'editor_linux.py'),'--root',str(r)]),('application',[str(r/'installed.AppImage'),'--update-presentation='+sys.argv[2]]),('watch',[sys.executable,str(r/'guest.py'),'watch','--root',str(r),'--timeout','1200'])]
for name,command in commands:
 out=(r/(name+'.log')).open('wb');p=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.STDOUT,start_new_session=True);(r/(name+'.pid')).write_text(str(p.pid))
import time
while not (r/'stop').exists():time.sleep(.25)'''
        self.python("import pathlib,sys;pathlib.Path(sys.argv[1]).write_text(sys.argv[2])", ROOT + "/launch.py", launch)
        self.mc("testbed", "--", "gui-launch", "--", "/usr/bin/python3", ROOT + "/launch.py", ROOT, self.args.scenario)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            current = self.files()
            if "connected" in current.get("observations.json", "") and "editor-state.json" in current:
                break
            if current.get("watch-error") or current.get("serve-error"):
                raise RuntimeError(str({k: v for k, v in current.items() if k.endswith("error")}))
            time.sleep(.5)
        else:
            raise TimeoutError("Fixture startup failed: " + current.get("application.log", "")[-1500:] + current.get("editor.log", "")[-1500:])
        if self.args.scenario != "foreground":
            # Wayland refuses AT-SPI top-level activation. During setup only,
            # select the editor with the compositor's ordinary switcher. The
            # MRU order can differ after a previous rehearsal.
            for _ in range(4):
                if json.loads(self.files()["editor-state.json"])["active"]:
                    break
                self.mc("desktop", "input", "key", "alt+tab")
                time.sleep(.5)
            self.check("independent-editor-has-focus-before-offer", json.loads(self.files()["editor-state.json"])["active"])
        if self.args.scenario == "minimized":
            initial_windows = json.loads(self.mc("testbed", "--", "user-exec", "--", "/usr/bin/python3", ROOT + "/window_state_linux.py"))
            self.check("A-starts-minimized", any(row["minimized"] for row in initial_windows))
        if self.args.scenario != "foreground":
            # GNOME can briefly notify is-active=false when the test broker
            # adds its virtual keyboard. Record a no-update control before
            # judging app activation, and independently compare actual input.
            for _ in range(3): self.mc("desktop", "input", "text", "baseline ")
            baseline = self.files()
            self.check("baseline-input-reaches-independent-editor", baseline.get("editor.txt") == "baseline " * 3)
            self.report["baselineEditorFocusLosses"] = sum(row.get("kind") == "editor-focus" and not row.get("active") for row in map(json.loads, baseline["focus.jsonl"].splitlines()))
            self.python("import pathlib,sys;(pathlib.Path(sys.argv[1])/'clear-editor').touch()", ROOT)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                current = self.files()
                if current.get("editor.txt") == "": break
                time.sleep(.25)
        self.check("independent-editor-starts-empty", current.get("editor.txt") == "")
        self.python("import pathlib,sys;(pathlib.Path(sys.argv[1])/'offer').touch()", ROOT)
        expected = ""
        deadline = time.monotonic() + max(180, self.report["fixture"]["quietSeconds"] + 180)
        updated_at = None
        while time.monotonic() < deadline:
            if self.args.scenario != "foreground":
                value = f"355_{len(expected):04d} "
                self.mc("desktop", "input", "text", value)
                expected += value
            current = self.files()
            observations = json.loads(current.get("observations.json", "[]"))
            if observations and observations[-1].get("phase") == "error":
                raise RuntimeError("Native updater: " + str(observations[-1].get("message")))
            if "100.0.2" in current.get("updated", ""):
                updated_at = updated_at or time.monotonic()
                if time.monotonic() - updated_at >= 5: break
            time.sleep(.25)
        else:
            raise TimeoutError("AppImage update did not reach B: " + current.get("last-error", ""))
        self.report["updateObservations"] = observations
        events = [json.loads(row) for row in current["focus.jsonl"].splitlines() if row]
        self.report["nativeEvents"] = events
        if self.args.scenario != "foreground":
            self.check("qualification-app-never-activates-over-editor", not any(row["kind"] == "native-window" and row.get("critical") and row["event"] == "window:activate" for row in events) and json.loads(current["editor-state.json"])["active"])
            actual = current["editor.txt"]
            self.report["keyboard"] = {"expectedLength": len(expected), "actualLength": len(actual), "expectedSha256": hashlib.sha256(expected.encode()).hexdigest(), "actualSha256": hashlib.sha256(actual.encode()).hexdigest()}
            self.check("all-untargeted-input-reaches-editor", actual == expected)
        if self.args.scenario in ("hidden", "minimized"):
            self.check("native-window-never-shows-during-update", not any(row["kind"] == "native-window" and row.get("critical") and row.get("showing") and row.get("visible") and not row.get("minimized") for row in events))
        final_windows = json.loads(self.mc("testbed", "--", "user-exec", "--", "/usr/bin/python3", ROOT + "/window_state_linux.py"))
        if self.args.scenario == "minimized":
            self.check("B-remains-minimized", any(row["minimized"] for row in final_windows))
        if self.args.scenario == "foreground":
            self.check("native-observer-sees-visible-qualification-window", any(row["kind"] == "native-window" and row.get("showing") and row.get("visible") for row in events))
            self.check("foreground-relaunch-activates-qualification-window", any(row["kind"] == "native-window" and row.get("critical") and row["event"] == "window:activate" for row in events) and any(row["active"] for row in final_windows) and not json.loads(current["editor-state.json"])["active"])
        installed = json.loads(self.python("import hashlib,json,pathlib,sqlite3,sys;r=pathlib.Path(sys.argv[1]); b=next((r/'100.0.2').glob('*.AppImage'));c=sqlite3.connect(r/'runtime/config/product.db');attempt=json.loads(c.execute('SELECT attempt FROM desktop_update_state').fetchone()[0]);print(json.dumps({'hashMatchesB':hashlib.sha256((r/'installed.AppImage').read_bytes()).digest()==hashlib.sha256(b.read_bytes()).digest(),'attempt':attempt,'statisticsOptOutPreserved':c.execute('SELECT statistics_enabled FROM product_state').fetchone()[0]==0}))", ROOT))
        self.report["installed"] = installed
        self.check("installed-image-matches-signed-B", installed["hashMatchesB"])
        self.check("statistics-opt-out-and-successful-startup-retained", installed["statisticsOptOutPreserved"] and installed["attempt"]["succeeded"])
        self.report["passed"] = True
        self.save()

    def cleanup(self):
        if not self.created:
            self.report["cleanupPassed"] = True
            self.save()
            return
        try:
            current = self.files()
            self.report.setdefault("updateObservations", json.loads(current.get("observations.json", "[]")))
            self.report["guestErrors"] = {k: v for k, v in current.items() if k.endswith("error")}
            code = '''import os,pathlib,signal,shutil,sys,time
r=pathlib.Path(sys.argv[1]);(r/'stop').touch()
for file in r.glob('*.pid'):
 try:os.killpg(int(file.read_text()),signal.SIGTERM)
 except ProcessLookupError:pass
# Relaunched B inherits the helper's process group, but the helper and AppImage
# runtime may already have exited. Match only this run's explicit APPIMAGE.
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdecimal() or int(p.name)==os.getpid():continue
 try:
  if (p/'comm').read_text().strip() not in ('jstorrent-client','jstorrent-clien'):continue
  environment=(p/'environ').read_bytes().split(b'\\0')
  if ('APPIMAGE='+str(r/'installed.AppImage')).encode() in environment:os.kill(int(p.name),signal.SIGTERM)
 except (ProcessLookupError,PermissionError,FileNotFoundError):pass
time.sleep(2);shutil.rmtree(r)'''
            self.python(code, ROOT)
            self.report["cleanupPassed"] = True
        except Exception as error:
            self.report["cleanupError"] = str(error)
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, default=REPO.parent / "machine-control/bin/machine-control")
    parser.add_argument("--target", default="linux")
    parser.add_argument("--claim", required=True)
    parser.add_argument("--guest-fixture", required=True)
    parser.add_argument("--scenario", choices=["hidden", "minimized", "unfocused", "foreground"], default="hidden")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists(): parser.error("Refusing to overwrite evidence")
    run = Run(args)
    try:
        run.run()
    except Exception as error:
        run.report["error"] = str(error)
        raise
    finally:
        run.cleanup()
    if not run.report["cleanupPassed"]: raise SystemExit("Retain claim for cleanup")


if __name__ == "__main__":
    main()

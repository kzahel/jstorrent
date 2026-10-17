#!/usr/bin/env python3
"""Exercise a native signed NSIS A/B fixture in a claimed Windows guest.

The fixture is built inside that guest. All GUI processes run in the ordinary
interactive user's limited token. No credentials, global trust or production
registrations are changed. The caller owns VM power and claim cleanup.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PureWindowsPath
import subprocess
import time
import zipfile

REPO = Path(__file__).resolve().parents[1]
TASK = "JSTorrent355Qualification"


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


class Run:
    def __init__(self, args):
        self.args = args
        self.prefix = [str(args.machine_control), "--target", args.target, "--claim", args.claim]
        self.root = None
        self.created = False
        self.task_created = False
        self.report = {"schema": "jstorrent-nsis-update-rehearsal/v1", "scenario": args.scenario,
                       "passed": False, "cleanupPassed": False, "checks": []}

    def mc(self, *arguments, data=None, timeout=180):
        for attempt in range(3):
            result = subprocess.run([*self.prefix, *arguments], input=data, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=timeout)
            detail = result.stderr.decode(errors="replace").strip()
            # These provider identity refusals precede guest dispatch. Never
            # replay a timeout or an operation with an unknown guest effect.
            if result.returncode and attempt < 2 and not result.stdout.strip() and detail and all(message in (
                "The provider could not resolve the configured target identity.",
                "UTM automation is unavailable; refusing library recovery and CLI retries",
            ) for message in detail.splitlines()):
                self.report["preflightRefusals"] = self.report.get("preflightRefusals", 0) + 1
                time.sleep(attempt + 1)
                continue
            break
        if result.returncode:
            raise RuntimeError("Machine Control operation failed: " + arguments[0] + ": " +
                               result.stderr.decode(errors="replace")[-1500:] + result.stdout.decode(errors="replace")[-1500:])
        return result.stdout.decode(errors="replace").strip()

    def ps(self, code, **kwargs):
        return self.mc("os", "--", "$ErrorActionPreference='Stop';" + code, **kwargs)

    def save(self):
        self.args.output.write_text(json.dumps(self.report, indent=2) + "\n")

    def check(self, name, passed):
        self.report["checks"].append({"name": name, "passed": bool(passed)})
        self.save()
        if not passed:
            raise AssertionError(name)

    def files(self):
        root = quote(self.root)
        return json.loads(self.ps(f"$r={root}; $out=@{{}}; @('editor.txt','editor.pid','editor-ready.json','editor-raised','editor-normal','foreground.json','focus.jsonl','observations.json','updated','last-error','serve-error','watch-error') | ForEach-Object {{ $p=Join-Path $r $_; if(Test-Path $p){{$stream=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]7);$reader=[IO.StreamReader]::new($stream);try{{$out[$_]=$reader.ReadToEnd()}}finally{{$reader.Dispose()}}}} }}; $out | ConvertTo-Json -Compress"))

    def run(self):
        self.mc("target", "ensure-ready")
        config = json.loads(self.ps("@{root=(Join-Path $env:TEMP 'jstorrent-355-update'); python=(Get-Command python.exe).Source} | ConvertTo-Json -Compress"))
        self.root = PureWindowsPath(config["root"])
        fixture = self.args.guest_fixture
        expected_binary = self.args.guest_b_executable or str(PureWindowsPath(fixture) / "target/debug/jstorrent-client.exe")
        self.ps(f"if(Get-Process -Name jstorrent-client -ErrorAction SilentlyContinue){{throw 'A JSTorrent process already exists; qualification must not interrupt it'}}; $r={quote(self.root)}; if(Test-Path $r){{throw 'Scratch root already exists'}}; if(Get-ScheduledTask -TaskName {quote(TASK)} -ErrorAction SilentlyContinue){{throw 'Qualification task already exists'}}; New-Item -ItemType Directory $r | Out-Null")
        self.created = True
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as packed:
            for name in ("guest.py", "focus_windows.py", "editor_windows.py", "token_windows.py", "live_files.py"):
                packed.write(REPO / "tests/interop/desktop_updates" / name, name)
            packed.write(REPO / "crates/rstorrent-session/tests/fixtures/product/v2.sqlite", "product-v2.sqlite")
        self.ps(f"$r={quote(self.root)}; $s=[Console]::OpenStandardInput();$f=[IO.File]::Create((Join-Path $r 'tools.zip'));$s.CopyTo($f);$f.Dispose();Expand-Archive (Join-Path $r 'tools.zip') -DestinationPath $r; Copy-Item (Join-Path {quote(fixture)} 'fixture.json') (Join-Path $r 'fixture.json'); Copy-Item (Join-Path {quote(fixture)} '100.0.1'),(Join-Path {quote(fixture)} '100.0.2') -Destination $r -Recurse; Copy-Item (Join-Path {quote(fixture)} 'server.pem'),(Join-Path {quote(fixture)} 'server.key') -Destination $r; New-Item -ItemType Directory (Join-Path $r 'runtime/config') -Force | Out-Null; Copy-Item (Join-Path $r 'product-v2.sqlite') (Join-Path $r 'runtime/config/product.db')", data=archive.getvalue())
        self.report["fixture"] = json.loads(self.ps(f"[IO.File]::ReadAllText({quote(self.root / 'fixture.json')})"))
        self.ps(f"$r={quote(self.root)}; $setup=Get-ChildItem (Join-Path $r '100.0.1') -Filter '*100.0.1*-setup.exe' | Select-Object -First 1; if(!$setup){{throw 'Missing A installer'}}; $p=Start-Process $setup.FullName -ArgumentList @('/S',('/D='+(Join-Path $r 'installed'))) -PassThru -Wait; if($p.ExitCode -ne 0){{throw 'Initial install failed'}}", timeout=300)
        pythonw = PureWindowsPath(config["python"]).with_name("pythonw.exe")
        executable = self.root / "installed/jstorrent-client.exe"
        presentation = self.args.scenario
        commands = [
            [str(pythonw), str(self.root / "guest.py"), "serve", "--root", str(self.root)],
            [str(pythonw), str(self.root / "focus_windows.py"), "--root", str(self.root)],
            [str(pythonw), str(self.root / "editor_windows.py"), "--root", str(self.root)],
            [str(executable), "--update-presentation=" + presentation],
            [str(pythonw), str(self.root / "guest.py"), "watch", "--root", str(self.root), "--timeout", "1200"],
        ]
        vbs = ["Set sh = CreateObject(\"WScript.Shell\")",
               "sh.Environment(\"PROCESS\")(\"RSTORRENT_DESKTOP_DATA_ROOT\") = " + json.dumps(str(self.root / "runtime"))]
        # VBS literals double quotes; Windows command-line quoting remains with
        # list2cmdline, so paths containing spaces remain individual arguments.
        vbs[1] = 'sh.Environment("PROCESS")("RSTORRENT_DESKTOP_DATA_ROOT") = "' + str(self.root / "runtime").replace('"', '""') + '"'
        for command in commands:
            line = subprocess.list2cmdline(command).replace('"', '""')
            vbs += ['sh.Run "' + line + '", 1, False', "WScript.Sleep 300"]
        encoded = "\r\n".join(vbs)
        self.ps(f"$r={quote(self.root)}; [IO.File]::WriteAllText((Join-Path $r 'launch.vbs'),{quote(encoded)}); $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited; $action=New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32/wscript.exe') -Argument ('\"'+(Join-Path $r 'launch.vbs')+'\"'); Register-ScheduledTask -TaskName {quote(TASK)} -Principal $principal -Action $action | Out-Null; Start-ScheduledTask -TaskName {quote(TASK)}")
        self.task_created = True
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            current = self.files()
            if "observations.json" in current and "connected" in current["observations.json"] and "editor.pid" in current and "editor-ready.json" in current and "foreground.json" in current:
                break
            time.sleep(1)
        else:
            raise TimeoutError("Interactive fixture startup failed: " + str({key: value for key, value in current.items() if key.endswith("error")}))
        initial = json.loads(self.ps(f"$p=Get-CimInstance Win32_Process | Where-Object ExecutablePath -EQ {quote(executable)}; if(@($p).Count -ne 1){{throw 'Expected one ordinary A process'}}; $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid; @{{pid=$p.ProcessId; interactive=($p.SessionId -gt 0); ordinaryUser=($owner.Sid -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)}} | ConvertTo-Json -Compress"))
        self.report["oldPid"] = initial["pid"]
        token = json.loads(self.ps(f"& {quote(config['python'])} {quote(self.root / 'token_windows.py')} {initial['pid']}"))
        self.check("A-token-is-not-elevated", not token["elevated"])
        self.check("ordinary-user-interactive-installation", initial["interactive"] and initial["ordinaryUser"])
        if presentation == "minimized":
            self.check("A-starts-minimized", any(row["pid"] == initial["pid"] and row["visible"] for row in json.loads(self.files()["foreground.json"])["minimizedWindows"]))
        if presentation != "foreground":
            point = json.loads(current["editor-ready.json"])
            self.ps(f"[IO.File]::WriteAllText({quote(self.root / 'raise-editor')},'setup')")
            deadline = time.monotonic() + 15
            while "editor-raised" not in self.files() and time.monotonic() < deadline:
                time.sleep(.25)
            self.mc("desktop", "input", "click", str(point["x"]), str(point["y"]))
            self.ps(f"[IO.File]::WriteAllText({quote(self.root / 'normalize-editor')},'setup')")
            deadline = time.monotonic() + 15
            while "editor-normal" not in self.files() and time.monotonic() < deadline:
                time.sleep(.25)
            self.check("editor-is-not-topmost-before-offer", "editor-normal" in self.files())
            focused = json.loads(self.files()["foreground.json"])
            self.report["editorSetup"] = {"editorPid": int(current["editor.pid"]), "foreground": focused, "point": point}
            self.check("independent-editor-has-focus-before-offer", focused["pid"] == int(current["editor.pid"]))
        self.check("independent-editor-starts-empty", self.files().get("editor.txt") == "")
        self.ps(f"[IO.File]::WriteAllText({quote(self.root / 'offer')},'offer')")
        expected = ""
        updated_at = None
        deadline = time.monotonic() + max(180, self.report["fixture"]["quietSeconds"] + 180)
        while time.monotonic() < deadline:
            if presentation != "foreground":
                text = f"355_{len(expected):04d} "
                self.mc("desktop", "input", "text", text)
                expected += text
            current = self.files()
            if "observations.json" in current:
                observations = json.loads(current["observations.json"])
                if observations and observations[-1].get("phase") == "error":
                    raise RuntimeError("Native updater rejected the rehearsal: " + str(observations[-1].get("message")))
            if "100.0.2" in current.get("updated", ""):
                updated_at = updated_at or time.monotonic()
                if time.monotonic() - updated_at >= 5: break
            time.sleep(.25)
        else:
            raise TimeoutError("Real NSIS update did not reach B: " + current.get("last-error", "") + current.get("watch-error", ""))
        self.report["updateObservations"] = json.loads(current["observations.json"])
        events = [json.loads(line) for line in current["focus.jsonl"].splitlines() if line]
        self.report["focusEvents"] = events
        if presentation != "foreground":
            editor = int(current["editor.pid"])
            self.check("foreground-remains-with-independent-editor", all(row["pid"] == editor for row in events if row["kind"] == "focus" and row.get("critical")))
            actual = current["editor.txt"]
            self.report["keyboard"] = {"expectedLength": len(expected), "actualLength": len(actual), "expectedSha256": hashlib.sha256(expected.encode()).hexdigest(), "actualSha256": hashlib.sha256(actual.encode()).hexdigest()}
            self.check("all-untargeted-input-reaches-editor", expected == actual)
        if presentation in ("hidden", "minimized"):
            self.check("background-install-and-relaunch-never-show-a-window", not any(row.get("windows") for row in events if row["kind"] == "visibility" and row.get("critical")))
        state = json.loads(self.ps(f"$r={quote(self.root)}; $bin=Join-Path $r 'installed/jstorrent-client.exe'; $p=@(Get-CimInstance Win32_Process | Where-Object ExecutablePath -EQ $bin); @{{pids=@($p.ProcessId)}} | ConvertTo-Json -Compress"))
        # Locked Tauri CLI 2.11.4 patches UNK -> NSS inside the installer,
        # then restores the build-cache executable. Compare every installed
        # byte against precisely that independently computed packaging result.
        verify = "import hashlib,json,pathlib,sys; actual=pathlib.Path(sys.argv[1]).read_bytes(); compiled=pathlib.Path(sys.argv[2]).read_bytes(); token=b'__TAURI_BUNDLE_TYPE_VAR_UNK'; assert compiled.count(token)==1, 'Expected exactly one unsigned packaging marker'; expected=compiled.replace(token,b'__TAURI_BUNDLE_TYPE_VAR_NSS',1); print(json.dumps({'hashMatchesB':actual==expected,'installedSha256':hashlib.sha256(actual).hexdigest(),'expectedPackagedSha256':hashlib.sha256(expected).hexdigest()}))"
        state.update(json.loads(self.ps(f"& {quote(config['python'])} -c {quote(verify)} {quote(executable)} {quote(expected_binary)}")))
        durable = "import json,pathlib,sqlite3,sys; db=sqlite3.connect(pathlib.Path(sys.argv[1])/'runtime/config/product.db'); attempt=json.loads(db.execute('SELECT attempt FROM desktop_update_state').fetchone()[0]); print(json.dumps({'statisticsOptOutPreserved':db.execute('SELECT statistics_enabled FROM product_state').fetchone()[0]==0,'attempt':attempt}))"
        state.update(json.loads(self.ps(f"& {quote(config['python'])} -c {quote(durable)} {quote(self.root)}")))
        self.report["installed"] = state
        self.check("statistics-opt-out-and-successful-startup-retained", state["statisticsOptOutPreserved"] and state["attempt"]["succeeded"])
        self.check("installed-executable-matches-compiled-B", state["hashMatchesB"])
        self.check("one-B-process-and-original-gone", len(state["pids"]) == 1 and self.report["oldPid"] not in state["pids"])
        token = json.loads(self.ps(f"& {quote(config['python'])} {quote(self.root / 'token_windows.py')} {state['pids'][0]}"))
        self.check("B-token-is-not-elevated", not token["elevated"])
        if presentation == "minimized":
            self.check("B-remains-minimized", any(row["pid"] == state["pids"][0] and row["visible"] for row in json.loads(current["foreground.json"])["minimizedWindows"]))
        if presentation == "foreground":
            self.check("native-observer-sees-B-window", any(row["kind"] == "visibility" and any(window["pid"] == state["pids"][0] for window in row.get("windows", [])) for row in events))
            self.check("foreground-restored", json.loads(current["foreground.json"])["pid"] == state["pids"][0])
        self.report["passed"] = True
        self.save()

    def diagnose(self):
        if not self.created:
            return
        try:
            files = self.files()
            for name in ("observations.json", "foreground.json"):
                if name in files:
                    self.report[name.removesuffix(".json")] = json.loads(files[name])
            self.report["guestErrors"] = {key: value for key, value in files.items() if key.endswith("error")}
            self.report["installationDiagnostics"] = json.loads(self.ps(f"$r={quote(self.root)}; $p=@(Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -like ($r+'*') }} | Select-Object ProcessId,Name,ExecutablePath,CommandLine); $bin=Join-Path $r 'installed/jstorrent-client.exe'; @{{processes=$p; installedVersion=([Diagnostics.FileVersionInfo]::GetVersionInfo($bin)).ProductVersion; controlPipes=@([IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object {{$_ -like '*rstorrent-desktop-v1-*'}}); ambientQualification=(Test-Path (Join-Path $env:APPDATA 'com.jstorrent.qualification.update')); installed=@(Get-ChildItem (Join-Path $r 'installed') -ErrorAction SilentlyContinue | Select-Object Name,Length); runtimeFiles=@(Get-ChildItem (Join-Path $r 'runtime') -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {{$_.FullName.Substring($r.Length)}})}} | ConvertTo-Json -Depth 4 -Compress"))
        except Exception as error:
            self.report["diagnosticError"] = str(error)
        self.save()

    def cleanup(self):
        if not self.created:
            self.report["cleanupPassed"] = True
            self.save()
            return
        try:
            root = quote(self.root)
            self.ps(f"$r={root}; [IO.File]::WriteAllText((Join-Path $r 'stop'),'stop'); Start-Sleep -Seconds 2; Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and ($_.ExecutablePath -eq (Join-Path $r 'installed/jstorrent-client.exe') -or ($_.Name -in @('python.exe','pythonw.exe') -and $_.CommandLine -like ('*'+$r+'*'))) }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}; $uninstall=Join-Path $r 'installed/uninstall.exe'; if(Test-Path $uninstall){{Start-Process $uninstall -ArgumentList '/S' -Wait}}; Unregister-ScheduledTask -TaskName {quote(TASK)} -Confirm:$false -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $r -Recurse -Force", timeout=180)
            self.report["cleanupPassed"] = True
        except Exception as error:
            self.report["cleanupError"] = str(error)
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, default=REPO.parent / "machine-control/bin/machine-control")
    parser.add_argument("--target", default="windows")
    parser.add_argument("--claim", required=True)
    parser.add_argument("--guest-fixture", required=True)
    parser.add_argument("--guest-b-executable", help="B executable when the fixture reused a separate build cache")
    parser.add_argument("--scenario", choices=["hidden", "unfocused", "minimized", "foreground"], default="hidden")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--retain-failed", action="store_true", help="Keep the owned installation for diagnosis; retain the claim and clean it explicitly")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite evidence")
    run = Run(args)
    try:
        run.run()
    except Exception as error:
        run.report["error"] = str(error)
        run.diagnose()
        run.save()
        raise
    finally:
        if args.retain_failed and not run.report["passed"] and run.created:
            run.report["cleanupDeferred"] = True
            run.save()
        else:
            run.cleanup()
    if not run.report["cleanupPassed"]:
        raise SystemExit("Cleanup failed; retain the claim for recovery")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Controlled candidate runtime checks in an existing physical Crostini container.

Uses Machine Control's shell and the installed vsh/LXC interfaces. This does
not qualify OS setup, package installation, registered launcher or browser UI.
The caller must provision the exact candidate in the exclusively owned root.
"""
from __future__ import annotations

import argparse
import gc
import json
import re
import shlex
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from first_verified_piece import add_seed, create_session, wait_for_listener
from magnet_metadata import create_fixture, magnet_uri

OWNED = "/tmp/rstorrent253-linux"


class Runtime:
    def __init__(self, command):
        self.command = command

    def python(self, source):
        remote = '''export PATH=/bin:/usr/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH
active_dir=$(cat /mnt/stateful_partition/rstorrent-tactical-253-owner/active-profile)
user_hash=${active_dir##*/u-}
vsh --vm_name=termina --owner_id="$user_hash" -- env LXD_CONF=/tmp/rstorrent253-lxc LXD_DIR=/mnt/stateful/lxd lxc exec penguin -- ''' + shlex.join(["python3", "-c", source]) + " </dev/null\n"
        result = subprocess.run([*self.command, "testbed", "--", "shell"], input=remote, text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(f"owned runtime assertion failed ({result.returncode}): {result.stderr[-1500:]}")
        output = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", result.stdout).strip()
        return json.loads(output)

    def request(self, command=None):
        path = "/api/v1/hello" if command is None else "/api/v1/commands"
        body = None if command is None else json.dumps({"version": 1, "request_id": "qualification253-"+uuid.uuid4().hex, "command": command})
        result = self.python(f'''import json,urllib.request
body={body!r}
request=urllib.request.Request("http://127.0.0.1:3030{path}", data=None if body is None else body.encode(), headers={{"Host":"jstorrent.localhost:3030","Origin":"http://jstorrent.localhost:3030","X-RSTorrent-Owner":"25300000000000000000000000000001","Content-Type":"application/json"}})
with urllib.request.urlopen(request,timeout=5) as response: print(response.read().decode())
''')
        if command is not None and (result.get("status") != "success" or result.get("error")):
            raise RuntimeError(f"application command {command['type']} was rejected: {result.get('error', {}).get('code')}")
        return result

    def restart(self):
        self.python(f'''import json,os,pwd,signal,subprocess,time
from pathlib import Path
root=Path({OWNED!r}); pid=int((root/"gateway.pid").read_text())
cmdline=Path(f"/proc/{{pid}}/cmdline").read_bytes()
assert str(root/"bundle/bin/rstorrent-gateway").encode() in cmdline
assert str(root/"data/rstorrent-crostini/profile").encode() in cmdline
assert Path(f"/proc/{{pid}}").stat().st_uid == 1000
os.kill(pid,signal.SIGTERM)
deadline=time.monotonic()+20
while Path(f"/proc/{{pid}}").exists() and time.monotonic()<deadline: time.sleep(.1)
assert not Path(f"/proc/{{pid}}").exists(), "owned gateway failed to stop"
user=pwd.getpwuid(1000).pw_name
log=(root/"gateway.log").open("ab")
process=subprocess.Popen(["runuser","-u",user,"--","env",f"XDG_DATA_HOME={{root}}/data",str(root/"bundle/bin/rstorrent-crostini"),"serve"],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
deadline=time.monotonic()+5
children=[]
while time.monotonic()<deadline:
    children=subprocess.run(["ps","-o","pid=","--ppid",str(process.pid)],capture_output=True,text=True).stdout.split()
    if len(children)==1: break
    time.sleep(.1)
assert len(children)==1
(root/"gateway.pid").write_text(children[0])
print(json.dumps({{"restarted":True}}))
''')
        deadline = time.monotonic()+20
        while time.monotonic() < deadline:
            try:
                self.request()
                return
            except RuntimeError:
                time.sleep(.5)
        raise RuntimeError("owned gateway did not become ready")

    def hash_payload(self, name):
        return self.python(f'''import hashlib,json,pwd
from pathlib import Path
path=Path(pwd.getpwuid(1000).pw_dir)/"Downloads"/{name!r}/"payload.bin"
print(json.dumps({{"sha1":hashlib.sha1(path.read_bytes()).hexdigest() if path.is_file() else None}}))
''')["sha1"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--seed-address", required=True)
    parser.add_argument("--seed-port", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--observe-seconds", type=int, default=3600)
    args = parser.parse_args()
    if not 1 <= args.seed_port <= 65535 or not 0 <= args.observe_seconds <= 3600:
        parser.error("explicit permitted seed port and observation in 0..3600 seconds required")
    runtime = Runtime([str(args.machine_control), "--registry", str(args.registry), "--target", args.target])
    runtime.request()
    runtime.python('''import json,pwd
from pathlib import Path
downloads=Path(pwd.getpwuid(1000).pw_dir)/"Downloads"
assert not list(downloads.glob("qualification253-linux-*")), "refusing pre-existing payloads"
print(json.dumps({"owned_payload_names_absent":True}))
''')
    report = {"schema": "chromeos-crostini-runtime/v1", "cohort": args.target, "delivery": "controlled_unsigned_local_candidate", "registered_launcher": "unrun", "browser_journey": "unrun", "repetitions": [], "result": "fail", "cleanup": "pending"}
    session = create_session()
    session.apply_settings({"listen_interfaces": f"{args.seed_address}:{args.seed_port}", "upload_rate_limit": 8*1024, "ignore_limits_on_local_network": False})
    handles = []
    payloads = []
    try:
        with tempfile.TemporaryDirectory(prefix="rstorrent-253-linux-seeds-") as directory:
            # The listener must settle on the explicitly preflighted port.
            deadline = time.monotonic()+10
            while wait_for_listener(session, []) != args.seed_port:
                if time.monotonic() > deadline: raise RuntimeError("seed listener did not settle")
                time.sleep(.1)
            for ordinal in range(1, 5 if args.observe_seconds else 4):
                observation = ordinal == 4
                name = f"qualification253-linux-{ordinal}"
                start = time.monotonic()
                fixture = create_fixture(Path(directory)/str(ordinal), payload_size=(28*1024*1024 if observation else 256*1024), root_name=name)
                handle = add_seed(session, fixture.torrent_info, fixture.seed_directory, [])
                handles.append(handle)
                payloads.append(name)
                response = runtime.request({"type": "add_magnet", "magnet": magnet_uri(fixture.info_hash, f"{args.seed_address}:{args.seed_port}"), "storage_root": "downloads", "start_content": True, "await_file_selection": False})
                torrent_id = response["result"]["result"]["torrent_id"]
                if observation:
                    beginning = time.monotonic()
                    samples = []
                    while time.monotonic()-beginning < args.observe_seconds:
                        samples.append(int(handle.status().total_payload_upload))
                        if len(samples) >= 5 and samples[-1] <= samples[-5]:
                            raise RuntimeError("controlled observation stopped moving for two minutes")
                        print(json.dumps({"stage":"observation", "seconds":round(time.monotonic()-beginning), "seed_payload_upload":samples[-1]}), flush=True)
                        time.sleep(max(0,min(30,args.observe_seconds-(time.monotonic()-beginning))))
                    if len(samples)<2 or samples[-1]<=samples[0]: raise RuntimeError("no controlled payload movement")
                    # The bounded observation is complete. Release the test
                    # throttle so verification measures completion, not whether
                    # protocol overhead happened to fit a five-minute tail.
                    session.apply_settings({"upload_rate_limit": 0})
                    report["completion_seed_limit"] = "released_after_observation"
                deadline = time.monotonic()+300
                while runtime.hash_payload(name) != fixture.payload_hash:
                    if time.monotonic()>deadline: raise RuntimeError("independent payload verification timed out")
                    time.sleep(2)
                handle.pause()
                runtime.restart()
                if runtime.hash_payload(name) != fixture.payload_hash: raise RuntimeError("restart changed bytes")
                runtime.request({"type":"remove_torrent", "torrent_id":torrent_id, "data":"keep"})
                runtime.restart()
                if runtime.hash_payload(name) != fixture.payload_hash: raise RuntimeError("remove/restart changed retained bytes")
                record = {"ordinal":ordinal, "bytes":fixture.payload_path.stat().st_size, "sha1":fixture.payload_hash, "elapsed_seconds":round(time.monotonic()-start,2), "source_offline_restart":"pass", "remove_and_restart_keep":"pass"}
                report["repetitions"].append(record)
                print(json.dumps({"stage":"runtime_verified", **record}), flush=True)
            report["result"] = "pass_bounded_runtime"
            report["observation"] = {"status":"pass" if args.observe_seconds==3600 else "bounded_short_run" if args.observe_seconds else "unrun", "seconds":args.observe_seconds}
    finally:
        session.pause()
        for handle in handles: session.remove_torrent(handle)
        handles.clear()
        session = None
        gc.collect()
        runtime.python(f'''import json,pwd,shutil
from pathlib import Path
downloads=Path(pwd.getpwuid(1000).pw_dir)/"Downloads"
for name in {payloads!r}: shutil.rmtree(downloads/name,ignore_errors=True)
assert not any((downloads/name).exists() for name in {payloads!r})
print(json.dumps({{"payload_cleanup":"ok"}}))
''')
        report["cleanup"] = "owned_payloads_removed_runtime_still_owned"
        args.output.write_text(json.dumps(report,indent=2)+"\n")


if __name__ == "__main__":
    main()

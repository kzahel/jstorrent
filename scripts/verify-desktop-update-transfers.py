#!/usr/bin/env python3
"""Run the macOS signed update with downloading, seeding and paused content.

Uses the repository's locked libtorrent Python environment and private VM
network only. All app data, content, peers and processes belong to this run.
"""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("update_rehearsal", REPO / "scripts/verify-desktop-unattended-update.py")
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


class Run(rehearsal.Rehearsal):
    def __init__(self, args, peer):
        super().__init__(args)
        self.peer = peer

    def start(self, arguments, name, env=None):
        if name == "application.log":
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode="w") as packed:
                packed.add(REPO / "target/debug/rstorrent-session", arcname="session")
                packed.add(REPO / "tests/interop/desktop_updates/transfers_guest.py", arcname="transfers_guest.py")
                packed.add(self.peer / "source/update-seed.bin", arcname="downloads/update-seed.bin")
            self.mc("testbed", "--", "exec", "-i", "/usr/bin/tar", "-xf", "-", "-C", rehearsal.GUEST_ROOT, input_bytes=archive.getvalue(), timeout=120)
            config = json.loads((self.peer / "ready.json").read_text())
            prepare = '''import json,pathlib,socket,subprocess,sys
r=pathlib.Path(sys.argv[1]);c=json.loads(sys.argv[2]);(r/'downloads/update-paused.bin').write_bytes(b'paused fixture content')
with socket.socket() as sock:sock.bind(('0.0.0.0',0));c['listenPort']=sock.getsockname()[1]
p=subprocess.Popen([str(r/'session'),'--profile-root',str(r/'runtime/data/profile'),'--profile-id','default','--storage-root','downloads='+str(r/'downloads')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=(r/'session.log').open('w'),text=True)
sequence=[0]
def command(value):
 sequence[0]+=1
 p.stdin.write(json.dumps({'version':1,'request_id':'setup-'+str(sequence[0]),'command':value})+'\\n');p.stdin.flush();out=json.loads(p.stdout.readline());assert out['status']=='success',out;return out['snapshot']
try:
 command({'type':'update_client_settings','patch':{'dht_enabled':False,'peer_exchange_enabled':False,'ipv6_enabled':False}})
 known=set()
 for item in c['items']:
  magnet='magnet:?xt=urn:btih:'+item['hash']+'&x.pe='+c['peerHost']+':'+str(c['peerPort'])
  snapshot=command({'type':'add_magnet','magnet':magnet,'storage_root':'downloads','start_content':False})
  added=set(row['torrent_id'] for row in snapshot['torrents'])-known;assert len(added)==1;item['id']=added.pop();known.add(item['id'])
 command({'type':'shutdown'});p.wait(timeout=15);assert p.returncode==0
finally:
 if p.poll() is None:p.kill();p.wait()
(r/'transfers.json').write_text(json.dumps(c))'''
            self.python(prepare, rehearsal.GUEST_ROOT, json.dumps(config))
        pid = super().start(arguments, name, env)
        if name == "watch.log":
            deadline = time.monotonic() + 100
            while not super().read("transfer-before.json").strip():
                error = super().read("watch-error").strip()
                if error: raise RuntimeError(error)
                if time.monotonic() >= deadline: raise TimeoutError("Controlled transfers did not start")
                time.sleep(.25)
        return pid

    def read(self, name):
        if name == "updated":
            request = super().read("transfer-b.json").strip()
            if request and not (self.peer / "leech-request.json").exists():
                (self.peer / "leech-request.json").write_text(request)
            if not (self.peer / "leech-result.json").exists():
                return ""
        return super().read(name)

    def run(self):
        super().run()
        self.report["transfers"] = {
            "before": json.loads(super().read("transfer-before.json")),
            "after": json.loads(super().read("transfer-result.json")),
            "independentLeech": json.loads((self.peer / "leech-result.json").read_text()),
        }
        self.check("download-resumes-and-paused-content-is-unchanged", self.report["transfers"]["after"]["allHashesMatch"] and self.report["transfers"]["after"]["intentPreserved"])
        self.check("restarted-B-uploads-verified-content-to-independent-peer", self.report["transfers"]["independentLeech"]["hashMatches"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine-control", type=Path, default=REPO.parent / "machine-control/bin/machine-control")
    parser.add_argument("--target", default="macos")
    parser.add_argument("--claim", required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists(): parser.error("Refusing to overwrite evidence")
    args.scenario, args.fault = "hidden", "none"
    prefix = [str(args.machine_control), "--target", args.target, "--claim", args.claim]
    route = subprocess.check_output([*prefix, "os", "--", "/sbin/route", "-n", "get", "default"], text=True)
    gateway = next(line.split(":", 1)[1].strip() for line in route.splitlines() if line.strip().startswith("gateway:"))
    with tempfile.TemporaryDirectory(prefix="jstorrent-355-peer-") as temporary:
        root = Path(temporary)
        peer_root = root / "peer"
        with (root / "peer.log").open("w") as output:
            peer = subprocess.Popen(["uv", "run", "--project", str(REPO / "tests/interop"), "--locked", "python", str(REPO / "tests/interop/desktop_updates/transfer_peer.py"), "--root", str(peer_root), "--bind", gateway], stdout=output, stderr=subprocess.STDOUT)
            test = Run(args, peer_root)
            try:
                deadline = time.monotonic() + 30
                while not (peer_root / "ready.json").exists():
                    if peer.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Private peer failed: " + (root / "peer.log").read_text()[-2000:])
                    time.sleep(.1)
                test.run()
            except Exception as error:
                test.report["passed"] = False
                test.report["error"] = str(error)
                raise
            finally:
                test.cleanup()
                if peer_root.exists(): (peer_root / "stop").touch()
                try: peer.wait(timeout=10)
                except subprocess.TimeoutExpired: peer.kill(); peer.wait()
                test.report["peerCleanupPassed"] = peer.poll() is not None
                test.save()
            if not test.report["cleanupPassed"]: raise SystemExit("Retain claim for cleanup")


if __name__ == "__main__":
    main()

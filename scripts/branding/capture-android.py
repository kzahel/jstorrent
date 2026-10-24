#!/usr/bin/env python3
"""Capture real product screens on a fresh, owned API 35 phone AVD."""
import importlib.util, json, os, subprocess, sys, time
from pathlib import Path
root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('audit_probe', root/'experiments/android-storage-probe/run_probe.py')
probe = importlib.util.module_from_spec(spec); sys.modules[spec.name] = probe; spec.loader.exec_module(probe)
sdk = Path(os.environ['ANDROID_HOME'])
avdmanager = sdk/'cmdline-tools/latest/bin/avdmanager'
name = f'rstorrent-brand-audit-{os.getpid()}'
output = Path(sys.argv[1] if len(sys.argv)>1 else root/'docs/evidence/258-brand-audit/after')
output.mkdir(parents=True, exist_ok=True)
subprocess.run([str(avdmanager),'create','avd','--name',name,'--package','system-images;android-35;google_apis;arm64-v8a','--device','pixel_6'],input='no\n',text=True,check=True,capture_output=True)
session = None; evidence=[]
try:
 session = probe.start_avd(name,'35'); target=session.target
 target.run(['install','-r',str(root/'clients/android/app/build/outputs/apk/debug/app-debug.apk')],timeout=120)
 target.shell(['pm','grant','org.rstorrent.bootstrap','android.permission.POST_NOTIFICATIONS'])
 target.shell(['am','start','-n','org.rstorrent.bootstrap/.MainActivity'])
 def nodes(): return probe.ui_nodes(target)
 def click(label):
  deadline=time.monotonic()+20
  while time.monotonic()<deadline:
   if probe.click_from_nodes(target,nodes(),[label]): return
   time.sleep(.3)
  raise RuntimeError('UI control missing: '+label)
 def capture(name):
  ns=nodes(); text='\n'.join(n.attrib.get('text','')+' '+n.attrib.get('content-desc','') for n in ns)
  with open(output/(name+'.png'),'wb') as image:
   subprocess.run([*target.prefix,'exec-out','screencap','-p'],stdout=image,check=True)
  evidence.append({'name':name,'method':'compiled debug APK on disposable API 35 arm64 phone emulator','obsoleteDisplayBrand':'rstorrent' in text.lower(),'text':text})
 deadline=time.monotonic()+30
 while time.monotonic()<deadline and not any(n.attrib.get('text')=='JSTorrent' for n in nodes()): time.sleep(.5)
 if any(n.attrib.get('text')=='Save and continue' for n in nodes()):
  capture('android-privacy')
  click('Include usage statistics');click('Save and continue')
 capture('android-library')
 click('Add torrent');capture('android-add');click('Cancel')
 click('More options');click('Settings');capture('android-settings')
 for label in ['Storage','Speed & Connection Limits','Notifications','Network & Privacy','Power Management','Advanced']:
  try:
   click(label);capture('android-settings-'+label.lower().replace(' & ','-').replace(' ','-'))
   target.shell(['input','keyevent','4'])
  except RuntimeError as e: evidence.append({'name':label,'failure':str(e)})
 target.shell(['input','keyevent','4'])
 target.shell(['cmd','uimode','night','yes'])
 time.sleep(2)
 capture('android-library-dark')
finally:
 (output/'android-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
 if session: session.close()
 subprocess.run([str(avdmanager),'delete','avd','--name',name],capture_output=True)
print(json.dumps([{k:v for k,v in e.items() if k!='text'} for e in evidence],indent=2))

if any(e.get('failure') for e in evidence):
 raise SystemExit(1)

#!/usr/bin/env python3
"""Controlled guest native host fixture; never use a personal browser.

Place beside bootstrap-fixture-mode (unsupported or wrong-version). This host
never starts a runtime and records operation names only, without credentials.
"""
import json
from pathlib import Path
import struct
import sys

root = Path(__file__).resolve().parent
header = sys.stdin.buffer.read(4)
if len(header) != 4:
    raise SystemExit(2)
length = struct.unpack('<I', header)[0]
if length > 16 * 1024:
    raise SystemExit(2)
request = json.loads(sys.stdin.buffer.read(length))
operation = request.get('op')
if operation not in ('hello', 'launch', 'start_control', 'attach_control'):
    raise SystemExit(2)
with (root / 'bootstrap-fixture-ops.jsonl').open('a') as log:
    log.write(json.dumps({'op': operation}) + '\n')
mode = (root / 'bootstrap-fixture-mode').read_text().strip()
if mode not in ('unsupported', 'wrong-version'):
    raise SystemExit(2)
response = {'id': request['id'], 'protocolVersion': 2 if mode == 'wrong-version' else 1,
            'ok': False, 'error': {'code': 'unsupported_protocol', 'message': 'controlled incompatible fixture'}}
body = json.dumps(response).encode()
sys.stdout.buffer.write(struct.pack('<I', len(body)) + body)
sys.stdout.buffer.flush()

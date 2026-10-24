#!/usr/bin/env python3
"""Owned physical SAF and interruption recovery; never changes device networking."""
from __future__ import annotations
import argparse
import base64
import gc
import io
import json
import struct
import subprocess
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import libtorrent as lt
import android_reactive_surface as product
import chromeos_android_qualification as qualification
from chromeos_android_startup_profile import cold_start
from first_verified_piece import add_seed, create_session, wait_for_listener, write_deterministic_payload
from magnet_metadata import magnet_uri


def retained_roots(xml: str) -> list[dict]:
    preferences = ET.fromstring(xml)
    encoded = next(n.text for n in preferences if n.get('name') == 'root-registry-v1')
    source = io.BytesIO(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
    version, count = struct.unpack('>II', source.read(8))
    if version != 1 or not 0 <= count <= 32:
        raise ValueError('invalid retained registry')
    def string():
        length = struct.unpack('>H', source.read(2))[0]
        return source.read(length).decode('utf-8')
    return [dict(root_id=string(), label=string(), uri=string(),
                 generation=struct.unpack('>q', source.read(8))[0]) for _ in range(count)]


def cancel_tree_picker(adb):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if any('documentsui' in n.get('package', '') for n in product.dump_ui(adb).iter()):
            break
        time.sleep(.5)
    else:
        raise RuntimeError('Android folder picker did not open')
    # Back first leaves a provider subfolder on some ARC picker layouts. Stop
    # as soon as DocumentsUI leaves; never send Back into the product itself.
    for _ in range(5):
        nodes = list(product.dump_ui(adb).iter())
        if not any('documentsui' in n.get('package', '') for n in nodes):
            return
        adb.shell('input', 'keyevent', '4')
        time.sleep(.5)
    raise RuntimeError('Android folder picker did not cancel')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--machine-control', type=Path, required=True)
    parser.add_argument('--registry', type=Path, help='runtime-private Machine Control registry')
    parser.add_argument('--target', required=True)
    parser.add_argument('--seed-address', required=True)
    parser.add_argument('--seed-port', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--screenshots', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.seed_port <= 65535:
        parser.error('explicit permitted seed port required')
    command = [str(args.machine_control)]
    if args.registry:
        command.extend(['--registry', str(args.registry)])
    command.extend(['--target', args.target])
    adb = qualification.RemoteAdb(command)
    product.PACKAGE, product.ACTIVITY = qualification.PACKAGE, qualification.ACTIVITY
    product.GRANT_FOLDER, product.GRANT_PATH = qualification.FOLDER, qualification.ROOT
    root = qualification.ROOT
    moved = root + '-moved'
    product.require_unlocked(adb)
    if not adb.shell('pm', 'path', qualification.PACKAGE).stdout.startswith('package:'):
        raise RuntimeError('install isolated qualification package first')
    for path in (root, moved, '/data/local/tmp/rstorrent253-ui.xml'):
        if adb.shell('test', '-e', path, check=False).returncode != 1:
            raise RuntimeError('refusing an inherited fixture path')
    args.screenshots.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'chromeos-android-recovery/v1', 'delivery': 'isolated_debug_sideload',
              'network_failure': 'controlled_seed_pause_only', 'device_wifi': 'unchanged',
              'cases': [], 'result': 'fail', 'cleanup': 'pending'}
    def save():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    def record(name, **details):
        report['cases'].append({'case': name, 'result': 'pass', **details})
        save()
        print(json.dumps(report['cases'][-1]), flush=True)
    def capture(name):
        subprocess.run([*command, 'testbed', '--', 'screenshot', str((args.screenshots / (name + '.png')).resolve())],
                       capture_output=True, check=True, timeout=45)
    def roots():
        return retained_roots(adb.shell('run-as', qualification.PACKAGE, 'cat', 'shared_prefs/product-saf.xml').stdout)
    def labels():
        return {n.get('text', '') for n in product.dump_ui(adb).iter()}
    def wait_labels(wanted, seconds=45):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            observed = labels()
            if wanted & observed:
                return observed
            time.sleep(.5)
        raise RuntimeError('missing expected UI labels: ' + ', '.join(sorted(wanted)))
    session = create_session()
    session.apply_settings({'listen_interfaces': f'{args.seed_address}:{args.seed_port}',
                            'upload_rate_limit': 48 * 1024, 'ignore_limits_on_local_network': False})
    handle = None
    try:
        adb.shell('mkdir', root)
        adb.shell('pm', 'grant', qualification.PACKAGE, 'android.permission.POST_NOTIFICATIONS')
        adb.shell('am', 'start', '-W', '-n', qualification.ACTIVITY)
        qualification.finish_first_use(adb)
        qualification.select_owned_tree(adb)
        original = roots()[0]
        with tempfile.TemporaryDirectory(prefix='rstorrent-253-recovery-') as directory:
            seed = Path(directory) / 'seed'
            name = 'qualification253-recovery-' + uuid.uuid4().hex
            (seed / name).mkdir(parents=True)
            expected = write_deterministic_payload(seed / name / 'payload.bin', 4 * 1024 * 1024)
            files = lt.file_storage()
            files.add_file(name + '/payload.bin', 4 * 1024 * 1024)
            creator = lt.create_torrent(files, piece_size=16 * 1024, flags=lt.create_torrent.v1_only)
            lt.set_piece_hashes(creator, str(seed))
            info = lt.torrent_info(creator.generate())
            handle = add_seed(session, info, seed, [])
            port = wait_for_listener(session, [])
            if port != args.seed_port:
                raise RuntimeError('seed listener differs from preflighted port')
            destination = root + '/' + name + '/payload.bin'
            def verify():
                actual = adb.shell('sha1sum', destination).stdout.split(' ', 1)[0]
                if actual != expected:
                    raise RuntimeError('retained payload hash mismatch')
                return actual
            adb.shell('am', 'start', '-W', '-n', qualification.ACTIVITY, '-a', 'android.intent.action.VIEW',
                      '-d', magnet_uri(str(info.info_hashes().v1), f'{args.seed_address}:{port}'))
            deadline = time.monotonic() + 100
            confirmed = False
            while time.monotonic() < deadline:
                if not confirmed:
                    confirmed = qualification.confirm_intake(adb)
                sent = int(handle.status().total_payload_upload)
                if confirmed and 128 * 1024 < sent < 4 * 1024 * 1024:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('controlled download did not reach partial transfer')
            capture('01-downloading')
            handle.pause()
            time.sleep(3)
            before = int(handle.status().total_payload_upload)
            cold_start(adb)
            time.sleep(4)
            after = int(handle.status().total_payload_upload)
            if after != before:
                raise RuntimeError('paused seed continued sending')
            capture('02-source-unavailable-after-process-restart')
            record('partial_process_restart_with_source_unavailable', seed_bytes=before, stable_seed_bytes=after)
            handle.resume()
            session.apply_settings({'upload_rate_limit': 0})
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                actual = adb.shell('sha1sum', destination, check=False).stdout.split(' ', 1)[0]
                if actual == expected:
                    break
                time.sleep(2)
            else:
                raise RuntimeError('download did not recover after source resumed')
            time.sleep(3)
            handle.pause()
            wait_labels({'Seeding', 'Complete', 'Finished'})
            capture('03-recovered-complete')
            record('source_restored_download_complete', sha1=verify())
            adb.shell('am', 'start', '-W', '-n', qualification.ACTIVITY, '--ez', 'product_release_saf_grant', 'true')
            cold_start(adb)
            wait_labels({'Repair'})
            if roots()[0] != original:
                raise RuntimeError('grant release changed retained root identity')
            capture('04-grant-revoked')
            record('revoked_grant_fails_closed', sha1=verify())
            repair = product.click_labeled(list(product.dump_ui(adb).iter()), {'Repair'})
            product.tap_bounds(adb, repair.get('bounds'))
            time.sleep(1)
            cancel_tree_picker(adb)
            wait_labels({'Repair'})
            if roots()[0] != original:
                raise RuntimeError('picker cancellation changed root binding')
            record('repair_picker_cancel_preserves_binding', sha1=verify())
            qualification.select_owned_tree(adb)
            repaired = roots()[0]
            if repaired['root_id'] != original['root_id'] or repaired['uri'] != original['uri'] or repaired['generation'] <= original['generation']:
                raise RuntimeError('repair did not preserve identity with a new grant generation')
            cold_start(adb)
            wait_labels({'Seeding', 'Complete', 'Finished'})
            capture('05-grant-repaired')
            record('repair_picker_retry_completed', sha1=verify(), generation_advanced=True)
            adb.shell('am', 'force-stop', qualification.PACKAGE)
            adb.shell('mv', root, moved)
            cold_start(adb)
            wait_labels({'Repair'})
            if roots()[0] != repaired:
                raise RuntimeError('missing folder changed binding')
            capture('06-folder-renamed-unavailable')
            if adb.shell('test', '-e', root, check=False).returncode != 1:
                raise RuntimeError('missing root silently recreated')
            record('renamed_root_fails_closed_without_recreation')
            product.GRANT_FOLDER = qualification.FOLDER + '-moved'
            qualification.select_owned_tree(adb)
            relocated = roots()[0]
            if relocated['root_id'] != original['root_id'] or relocated['uri'] == repaired['uri'] or relocated['generation'] <= repaired['generation']:
                raise RuntimeError('relocated folder did not repair the retained binding')
            destination = moved + '/' + name + '/payload.bin'
            cold_start(adb)
            wait_labels({'Seeding', 'Complete', 'Finished'})
            capture('07-folder-restored')
            record('relocated_root_repair_source_offline_recovery', sha1=verify(), same_root_id=True, generation_advanced=True)
        report['result'] = 'pass_bounded_recovery'
    except Exception as error:
        report['failure'] = str(error).splitlines()[0][:240]
        raise
    finally:
        session.pause()
        if handle is not None:
            session.remove_torrent(handle)
        handle = None
        session = None
        gc.collect()
        clean = True
        for arguments in [('am', 'force-stop', qualification.PACKAGE), ('pm', 'clear', qualification.PACKAGE),
                          ('rm', '-rf', root, moved), ('rm', '-f', '/data/local/tmp/rstorrent253-ui.xml')]:
            try:
                clean = adb.shell(*arguments, check=False).returncode == 0 and clean
            except Exception:
                clean = False
        report['cleanup'] = 'ok' if clean else 'fail'
        save()
        if not clean:
            raise RuntimeError('owned recovery cleanup failed')


if __name__ == '__main__':
    main()

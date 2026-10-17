#!/usr/bin/env python3
"""Audit registry identities, including the original identity of local backports."""
import argparse
import json
from pathlib import Path
import subprocess

import glib_backport


def collect(root=glib_backport.ROOT):
    lock, provenance = glib_backport.audit_lock(root)
    # Feed an in-memory audit-only projection. Never rewrite Cargo.lock or the
    # resolver input used to build the product.
    version = subprocess.check_output(['cargo-audit', '--version'], text=True).strip()
    if version != 'cargo-audit 0.22.2':
        raise ValueError('install pinned cargo-audit 0.22.2 with --locked')
    run = subprocess.run(['cargo', 'audit', '--file', '-', '--json'], input=lock,
                         stdout=subprocess.PIPE, cwd=root, timeout=300)
    if run.returncode not in (0, 1) or len(run.stdout) > 16 * 1024 * 1024:
        raise ValueError('Cargo advisory collection failed or exceeded bounds')
    report = json.loads(run.stdout)
    report['rstorrent_source_review'] = provenance
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--locked', '--all-features', '--format-version', '1'],
        cwd=root, timeout=120))
    packages = {p['id']: p for p in metadata['packages']}
    report['rstorrent_reviewed_features'] = {
        'rand@0.7.3': sorted(node['features'])
        for node in metadata['resolve']['nodes']
        if (packages[node['id']]['name'], packages[node['id']]['version']) == ('rand', '0.7.3')
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = collect()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('Collected Cargo registry advisory report with verified local-source provenance')


if __name__ == '__main__':
    main()

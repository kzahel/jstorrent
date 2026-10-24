#!/usr/bin/env python3
"""Check fresh audits against expiring warning and vulnerability reviews."""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re

import glib_backport
import dependency_exceptions

ROOT = Path(__file__).resolve().parents[1]
PROBE_LOCKFILE = 'experiments/ios-storage-probe/Cargo.lock'
SAFE_FAILURES = {
    'Cargo vulnerability report is missing or has vulnerabilities',
    'web npm vulnerability report is missing or has vulnerabilities',
    'website npm vulnerability report is missing or has vulnerabilities',
    'advisory database must be at most 30 days old',
    'dependency warning review has expired',
    'dependency warning inventory changed; review additions and removals',
    'reviewed backports require exact independently verified source',
    'Cargo report must audit the exact original backport registry identity',
    'reviewed rand warning requires the log feature to remain disabled',
    'iOS probe audit must match its current lockfile',
    'iOS probe vulnerability report is missing or has vulnerabilities',
    'iOS probe has unreviewed dependency warnings',
    'iOS probe advisory database must be at most 30 days old',
    'Cargo vulnerability exception inventory changed; review additions and removals',
    'Cargo vulnerability exception has expired or has invalid review dates',
    'Cargo vulnerability exception requires bounded review and evidence',
    'Cargo vulnerability exception source or feature context changed',
}


def review_ios_probe(cargo, today, root=ROOT):
    probe = cargo.get('rstorrent_ios_probe', {})
    digest = hashlib.sha256((root / PROBE_LOCKFILE).read_bytes()).hexdigest()
    if probe.get('lock_sha256') != digest:
        raise ValueError('iOS probe audit must match its current lockfile')
    report = probe.get('audit', {})
    if report.get('vulnerabilities', {}).get('count') != 0:
        raise ValueError('iOS probe vulnerability report is missing or has vulnerabilities')
    if not isinstance(report.get('warnings'), dict) or any(report['warnings'].values()):
        raise ValueError('iOS probe has unreviewed dependency warnings')
    database = report['database']
    updated = datetime.fromisoformat(database['last-updated']).date()
    if not 0 <= (today - updated).days <= 30:
        raise ValueError('iOS probe advisory database must be at most 30 days old')
    return {
        'lockfile': PROBE_LOCKFILE,
        'lock_sha256': digest,
        'database_revision': database['last-commit'],
        'cargo_vulnerabilities': 0,
        'warnings': [],
    }


def review(cargo, npm, website_npm, policy, today, backports=(), root=ROOT):
    exceptions = dependency_exceptions.review(cargo, policy, today, root)
    if npm.get('metadata', {}).get('vulnerabilities', {}).get('total') != 0:
        raise ValueError('web npm vulnerability report is missing or has vulnerabilities')
    if website_npm.get('metadata', {}).get('vulnerabilities', {}).get('total') != 0:
        raise ValueError('website npm vulnerability report is missing or has vulnerabilities')
    database = cargo['database']
    updated = datetime.fromisoformat(database['last-updated']).date()
    if not 0 <= (today - updated).days <= 30:
        raise ValueError('advisory database must be at most 30 days old')
    if today > date.fromisoformat(policy['review_expires']):
        raise ValueError('dependency warning review has expired')
    expected = {(r['kind'], r['advisory'], r['package'], r['version'])
                for r in policy['warnings']}
    actual = set()
    for kind, entries in cargo.get('warnings', {}).items():
        for entry in entries:
            actual.add((kind, entry.get('advisory', {}).get('id'),
                        entry['package']['name'], entry['package']['version']))
    if actual != expected:
        raise ValueError('dependency warning inventory changed; review additions and removals')
    if ('unsound', 'RUSTSEC-2026-0097', 'rand', '0.7.3') in expected:
        features = cargo.get('rstorrent_reviewed_features', {}).get('rand@0.7.3')
        if not isinstance(features, list) or 'log' in features:
            raise ValueError('reviewed rand warning requires the log feature to remain disabled')
    identity = ('package', 'version', 'advisory', 'source_manifest_sha256')
    expected_backports = {tuple(p[k] for k in identity) for p in policy.get('backports', [])}
    actual_backports = {tuple(p[k] for k in identity) for p in backports
                       if p.get('status') == 'source-verified-backport'}
    if (actual_backports != expected_backports or len(actual_backports) != len(backports)
            or len(expected_backports) != len(policy.get('backports', []))):
        raise ValueError('reviewed backports require exact independently verified source')
    return {
        'schema': 1,
        'reviewed_at': today.isoformat(),
        'database_revision': database['last-commit'],
        'cargo_vulnerabilities': cargo['vulnerabilities']['count'],
        'unexcepted_cargo_vulnerabilities': 0,
        'reviewed_vulnerability_exceptions': exceptions,
        'npm_vulnerabilities': 0,
        'website_npm_vulnerabilities': 0,
        'reviewed_warnings': sorted([list(r) for r in actual]),
        'reviewed_features': cargo.get('rstorrent_reviewed_features', {}),
        'source_verified_backports': list(backports),
        'release_blockers': policy['release_blockers'],
        'release_ready': not policy['release_blockers'],
    }


def failure_summary(cargo, npm, website_npm, reason):
    """Keep an actionable, bounded CI artifact without raw audit reports."""
    def bounded(value):
        return re.sub(r'[^A-Za-z0-9_.:-]', '_', str(value))[:100]

    def findings(report):
        return [{
            'advisory': bounded((item.get('advisory') or {}).get('id', 'unknown')),
            'package': bounded(item.get('package', {}).get('name', 'unknown')),
            'version': bounded(item.get('package', {}).get('version', 'unknown')),
        } for item in report.get('vulnerabilities', {}).get('list', [])[:20]]

    probe = cargo.get('rstorrent_ios_probe', {}).get('audit', {})
    npm_findings = {}
    for label, report in (('web', npm), ('website', website_npm)):
        npm_findings[label] = [
            {'package': bounded(name), 'severity': bounded(item.get('severity', 'unknown'))}
            for name, item in sorted(report.get('vulnerabilities', {}).items())[:20]
        ]
    return {
        'schema': 1,
        'status': 'failed',
        'reason': reason,
        'cargo_vulnerability_count': cargo.get('vulnerabilities', {}).get('count'),
        'cargo_findings': findings(cargo),
        'ios_probe_vulnerability_count': probe.get('vulnerabilities', {}).get('count'),
        'ios_probe_findings': findings(probe),
        'npm_vulnerability_counts': {
            label: report.get('metadata', {}).get('vulnerabilities', {}).get('total')
            for label, report in (('web', npm), ('website', website_npm))
        },
        'npm_findings': npm_findings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cargo', type=Path, required=True)
    parser.add_argument('--npm', type=Path, required=True)
    parser.add_argument('--website-npm', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--require-release-ready', action='store_true')
    args = parser.parse_args()
    policy = json.loads((ROOT / 'distribution/dependency-review.json').read_text(encoding='utf-8'))
    cargo = json.loads(args.cargo.read_text(encoding='utf-8'))
    npm = json.loads(args.npm.read_text(encoding='utf-8'))
    website_npm = json.loads(args.website_npm.read_text(encoding='utf-8'))
    try:
        _, provenance = glib_backport.audit_lock(ROOT)
        if cargo.get('rstorrent_source_review') != provenance:
            raise ValueError('Cargo report must audit the exact original backport registry identity')
        today = datetime.now(timezone.utc).date()
        probe = review_ios_probe(cargo, today)
        result = review(cargo, npm, website_npm, policy, today,
                        [glib_backport.verify(ROOT)])
        result['ios_probe'] = probe
        result['lockfiles'] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                               for name in ('Cargo.lock', 'clients/web/package-lock.json',
                                            'website/package-lock.json', PROBE_LOCKFILE)}
    except (ValueError, KeyError, TypeError) as error:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        safe_reason = str(error) if str(error) in SAFE_FAILURES else 'integrity or report error'
        args.output.write_text(json.dumps(failure_summary(cargo, npm, website_npm, safe_reason),
                                          indent=2) + '\n')
        raise SystemExit(f'Dependency review failed: {error}') from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if args.require_release_ready and not result['release_ready']:
        raise SystemExit('Reviewed dependency blockers remain; see distribution/dependency-review.json')
    print(f"Reviewed dependency reports; release_ready={result['release_ready']}; "
          f"reviewed_vulnerability_exceptions={len(result['reviewed_vulnerability_exceptions'])}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Check fresh audit reports against an explicit, expiring warning review."""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re

import glib_backport

ROOT = Path(__file__).resolve().parents[1]
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
}


def review(cargo, npm, website_npm, policy, today, backports=()):
    if cargo.get('vulnerabilities', {}).get('count') != 0:
        raise ValueError('Cargo vulnerability report is missing or has vulnerabilities')
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
        'cargo_vulnerabilities': 0,
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

    cargo_findings = []
    for item in cargo.get('vulnerabilities', {}).get('list', [])[:20]:
        cargo_findings.append({
            'advisory': bounded(item.get('advisory', {}).get('id', 'unknown')),
            'package': bounded(item.get('package', {}).get('name', 'unknown')),
            'version': bounded(item.get('package', {}).get('version', 'unknown')),
        })
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
        'cargo_findings': cargo_findings,
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
        result = review(cargo, npm, website_npm, policy, datetime.now(timezone.utc).date(),
                        [glib_backport.verify(ROOT)])
        result['lockfiles'] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                               for name in ('Cargo.lock', 'clients/web/package-lock.json',
                                            'website/package-lock.json')}
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
    print(f"Reviewed dependency reports; release_ready={result['release_ready']}")


if __name__ == '__main__':
    main()

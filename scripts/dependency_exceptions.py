"""Evidence binding for the single reviewed OPAQUE bigint exception."""
from datetime import date
import hashlib
import json
from pathlib import Path


EVIDENCE = 'docs/tactical/evidence/381-opaque-bigint-reachability.md'
CRYPTO_SOURCE = 'crates/rstorrent-remote-crypto/src'
REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index'
IDENTITY = ('RUSTSEC-2026-0387', 'crypto-bigint', '0.5.5', REGISTRY,
            '0dc92fb57ca44df6db8059111ab3af99a63d5d0f8375d9972e319a379c6bab76')
BACKENDS = {('crypto-bigint', '0.5.5'), ('elliptic-curve', '0.13.8'),
            ('opaque-ke', '4.0.1'), ('voprf', '0.5.0'), ('curve25519-dalek', '4.1.3')}


def fingerprint(context):
    return hashlib.sha256(json.dumps(context, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def collect_context(metadata, root):
    """Use all-target/all-feature metadata; omit machine-specific Cargo IDs."""
    root = Path(root).resolve()
    packages = {p['id']: p for p in metadata['packages']}
    nodes = metadata['resolve']['nodes']
    paths = {'Cargo.toml', 'Cargo.lock', EVIDENCE}
    paths.update(Path(packages[p]['manifest_path']).resolve().relative_to(root).as_posix()
                 for p in metadata['workspace_members'])
    paths.update(p.relative_to(root).as_posix() for p in (root / CRYPTO_SOURCE).rglob('*.rs'))

    def identity(package_id):
        p = packages[package_id]
        return f"{p['name']}@{p['version']}#{p.get('source') or 'workspace'}"

    backends = []
    for node in nodes:
        p = packages[node['id']]
        if (p['name'], p['version']) not in BACKENDS:
            continue
        backends.append({
            'package': identity(node['id']),
            'features': sorted(node['features']),
            'dependencies': sorted(identity(d) for d in node['dependencies']),
            'dependents': sorted(identity(n['id']) for n in nodes if node['id'] in n['dependencies']),
        })
    return {
        'files': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sorted(paths)},
        'backends': sorted(backends, key=lambda b: b['package']),
    }


def review(cargo, policy, today, root):
    """Accept exactly the reviewed finding, while retaining its raw count."""
    report = cargo.get('vulnerabilities', {})
    count, findings = report.get('count'), report.get('list', [])
    if type(count) is not int or count < 0 or not isinstance(findings, list) or count != len(findings):
        raise ValueError('Cargo vulnerability report is missing or has vulnerabilities')
    exceptions = policy.get('vulnerability_exceptions', [])
    if not exceptions:
        if count:
            raise ValueError('Cargo vulnerability report is missing or has vulnerabilities')
        return []
    if not isinstance(exceptions, list) or len(exceptions) != 1 or count != 1:
        raise ValueError('Cargo vulnerability exception inventory changed; review additions and removals')
    exception, finding = exceptions[0], findings[0]
    identity = (finding['advisory']['id'], *(finding['package'][k]
                for k in ('name', 'version', 'source', 'checksum')))
    expected = tuple(exception[k] for k in ('advisory', 'package', 'version', 'source', 'checksum'))
    if identity != IDENTITY or expected != IDENTITY:
        raise ValueError('Cargo vulnerability exception inventory changed; review additions and removals')
    reviewed, expires = (date.fromisoformat(exception[k]) for k in ('reviewed_at', 'expires'))
    if not reviewed <= today <= expires or not 0 <= (expires - reviewed).days <= 30:
        raise ValueError('Cargo vulnerability exception has expired or has invalid review dates')
    if (expires > date.fromisoformat(policy['review_expires']) or
            not isinstance(exception.get('reason'), str) or not exception['reason'].strip() or
            exception.get('evidence') != EVIDENCE):
        raise ValueError('Cargo vulnerability exception requires bounded review and evidence')
    context = cargo.get('rstorrent_vulnerability_context', {})
    if fingerprint(context) != exception['context_sha256']:
        raise ValueError('Cargo vulnerability exception source or feature context changed')
    root = Path(root).resolve()
    for path, digest in context['files'].items():
        file = root / path
        if (file.is_symlink() or not file.resolve().is_relative_to(root) or
                not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != digest):
            raise ValueError('Cargo vulnerability exception source or feature context changed')
    actual_sources = {p.relative_to(root).as_posix() for p in (root / CRYPTO_SOURCE).rglob('*.rs')}
    if actual_sources != {p for p in context['files'] if p.startswith(CRYPTO_SOURCE + '/')}:
        raise ValueError('Cargo vulnerability exception source or feature context changed')
    return [exception]

"""Evidence binding for the single reviewed OPAQUE bigint exception."""
from datetime import date
import hashlib
import json
import subprocess
import tomllib
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
    locked = {(p['name'], p['version'], p.get('source')): p.get('checksum')
              for p in tomllib.loads((root / 'Cargo.lock').read_text()).get('package', [])}
    # The review concerns this crypto implementation and resolved dependency
    # closure, not unrelated lockfile entries or workspace package versions.
    paths = {EVIDENCE, (Path(CRYPTO_SOURCE).parent / 'Cargo.toml').as_posix()}
    paths.update(p.relative_to(root).as_posix() for p in (root / CRYPTO_SOURCE).rglob('*.rs'))

    def identity(package_id):
        p = packages[package_id]
        return f"{p['name']}@{p['version']}#{p.get('source') or 'workspace'}"

    by_id = {node['id']: node for node in nodes}
    backends = {node['id'] for node in nodes
                if (packages[node['id']]['name'], packages[node['id']]['version']) in BACKENDS}
    selected = set(backends)
    pending = list(backends)
    while pending:
        for dependency in by_id[pending.pop()]['dependencies']:
            if dependency not in selected:
                selected.add(dependency)
                pending.append(dependency)
    graph = []
    for package_id in selected:
        node, package = by_id[package_id], packages[package_id]
        entry = {
            'package': identity(package_id),
            'checksum': locked.get((package['name'], package['version'], package.get('source'))),
            'features': sorted(node['features']),
            'dependencies': sorted(identity(d) for d in node['dependencies']),
        }
        if package_id in backends:
            entry['dependents'] = sorted(identity(n['id']) for n in nodes
                                         if package_id in n['dependencies'])
        graph.append(entry)
    return {
        'schema': 2,
        'files': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sorted(paths)},
        'crypto_graph': sorted(graph, key=lambda b: b['package']),
    }


def current_context(root):
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--locked', '--all-features', '--format-version', '1'],
        cwd=root, timeout=120))
    return collect_context(metadata, root)


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
    if fingerprint(current_context(root)) != exception['context_sha256']:
        raise ValueError('Cargo vulnerability exception source or feature context changed')
    for path, digest in context['files'].items():
        file = root / path
        if (file.is_symlink() or not file.resolve().is_relative_to(root) or
                not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != digest):
            raise ValueError('Cargo vulnerability exception source or feature context changed')
    actual_sources = {p.relative_to(root).as_posix() for p in (root / CRYPTO_SOURCE).rglob('*.rs')}
    if actual_sources != {p for p in context['files'] if p.startswith(CRYPTO_SOURCE + '/')}:
        raise ValueError('Cargo vulnerability exception source or feature context changed')
    return [exception]

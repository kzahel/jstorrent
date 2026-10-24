#!/usr/bin/env python3
"""Build Android attribution from Gradle's exact runtime graph and Cargo.lock."""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('release_notices', ROOT / 'scripts/prepare-release-notices.py')
rust = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rust)
NS = '{http://maven.apache.org/POM/4.0.0}'
TARGETS = ['aarch64-linux-android', 'x86_64-linux-android']
ABI_NAMES = {'arm64-v8a', 'x86_64'}
MAX_TEXT = 512 * 1024
MAX_OUTPUT = 16 * 1024**2
COORDINATE = re.compile(r'[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+')
NOTICE_NAME = re.compile(r'(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$', re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bounded_read(path, maximum=MAX_TEXT):
    if not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError('missing or oversized attribution input')
    return path.read_bytes()


def pom_locator(component):
    group, name, version = component.split(':')
    if group == 'rustls':
        return f'https://crates.io/api/v1/crates/rustls-platform-verifier-android/{version}/download'
    base = ('https://dl.google.com/dl/android/maven2/' if group.startswith('androidx.')
            else 'https://repo.maven.apache.org/maven2/')
    return base + group.replace('.', '/') + f'/{name}/{version}/{name}-{version}.pom'


def pom_evidence(chain, component):
    if not 1 <= len(chain) <= 4:
        raise ValueError('invalid parent POM chain length')
    expected, seen, records = component, set(), []
    for entry in chain:
        coordinate = entry['component']
        if coordinate != expected or coordinate in seen or not COORDINATE.fullmatch(coordinate):
            raise ValueError('POM parent/coordinate differs from resolved graph')
        seen.add(coordinate)
        data = bounded_read(Path(entry['file']))
        xml = data.decode('utf-8-sig')
        if '<!DOCTYPE' in xml or '<!ENTITY' in xml:
            raise ValueError('DTD/entity in Maven license metadata')
        root = ET.fromstring(xml)
        parent = root.find(NS + 'parent')
        group = root.findtext(NS + 'groupId') or (parent.findtext(NS + 'groupId') if parent is not None else None)
        version = root.findtext(NS + 'version') or (parent.findtext(NS + 'version') if parent is not None else None)
        actual = ':'.join((group or '', root.findtext(NS + 'artifactId') or '', version or ''))
        if actual != coordinate:
            raise ValueError('POM identity differs from resolved component')
        licenses = [{'name': p.findtext(NS + 'name'), 'url': p.findtext(NS + 'url'),
                     'comments': p.findtext(NS + 'comments')}
                    for p in root.findall(NS + 'licenses/' + NS + 'license')]
        records.append({'component': coordinate, 'sha256': digest(data),
                        'source_locator': pom_locator(coordinate), 'licenses': licenses})
        if licenses:
            if len(records) != len(chain):
                raise ValueError('unexpected extra parent license metadata')
            return licenses, records
        if parent is not None:
            expected = ':'.join(parent.findtext(NS + k) or '' for k in ('groupId', 'artifactId', 'version'))
    return [], records


def zip_contents(archive):
    entries = archive.infolist()
    if len(entries) > 200000 or len({p.filename for p in entries}) != len(entries):
        raise ValueError('oversized or duplicate archive entry inventory')
    total = 0
    for entry in entries:
        name = PurePosixPath(entry.filename)
        if (name.is_absolute() or '..' in name.parts or '\\' in entry.filename or
                len(entry.filename) > 512 or (entry.external_attr >> 16) & 0o170000 == 0o120000):
            raise ValueError('unsafe path/symlink in dependency archive')
        total += entry.file_size
        if total > 512 * 1024**2 or entry.file_size > 64 * 1024**2:
            raise ValueError('dependency archive exceeds expansion bound')
    return entries


def artifact_notices(path):
    if not 0 < path.stat().st_size <= 128 * 1024**2:
        raise ValueError('dependency archive exceeds input bound')
    texts, native = [], []

    def inspect(archive, prefix=''):
        for entry in zip_contents(archive):
            name = PurePosixPath(entry.filename)
            if entry.is_dir():
                continue
            if NOTICE_NAME.fullmatch(name.name) and name.suffix != '.class':
                if not 0 < entry.file_size <= MAX_TEXT:
                    raise ValueError('original notice exceeds text bound')
                data = archive.read(entry)
                texts.append({'path': prefix + entry.filename, 'sha256': digest(data),
                              'text': data.decode('utf-8-sig')})
            if name.suffix == '.so':
                if len(name.parts) != 3 or name.parts[0] != 'jni':
                    raise ValueError('unreviewed native artifact path')
                if name.parts[1] in ABI_NAMES:
                    native.append({'path': '/'.join(name.parts[1:]), 'sha256': digest(archive.read(entry))})
            if not prefix and entry.filename == 'classes.jar':
                with zipfile.ZipFile(io.BytesIO(archive.read(entry))) as nested:
                    inspect(nested, 'classes.jar!/')
    with zipfile.ZipFile(path) as archive:
        inspect(archive)
    if len(texts) > 128:
        raise ValueError('too many original artifact notices')
    return texts, native


def reviewed_text(catalog, key):
    entry = catalog['texts'][key]
    name = entry['file']
    if Path(name).name != name or not re.fullmatch('[0-9a-f]{64}\\.txt', name):
        raise ValueError('unsafe reviewed license path')
    data = bounded_read(ROOT / 'distribution/licenses' / name)
    if digest(data) != entry['sha256']:
        raise ValueError('reviewed license text checksum changed')
    return f"Source: {entry['source']}\nSHA-256: {entry['sha256']}\n\n" + data.decode('utf-8')


def maven_notices(graph, catalog):
    rows = graph['artifacts']
    if not 1 <= len(rows) <= 256 or len({(p['component'], Path(p['file']).name) for p in rows}) != len(rows):
        raise ValueError('invalid resolved artifact inventory')
    sections, inventory = [], []
    for row in sorted(rows, key=lambda p: p['component']):
        component = row['component']
        if not COORDINATE.fullmatch(component):
            raise ValueError('invalid resolved artifact coordinate')
        licenses, poms = pom_evidence(row['poms'], component)
        path = Path(row['file'])
        original, native = artifact_notices(path)
        texts = [f"Original artifact file: {p['path']}\nSHA-256: {p['sha256']}\n\n{p['text']}" for p in original]
        declared_apache = any(p['url'] in {'http://www.apache.org/licenses/LICENSE-2.0.txt',
                                         'https://www.apache.org/licenses/LICENSE-2.0.txt'} for p in licenses)
        if declared_apache and len(licenses) != 1:
            if not (component == 'net.java.dev.jna:jna:5.17.0' and len(licenses) == 2 and
                    {p['name'] for p in licenses} == {'Apache-2.0', 'LGPL-2.1-or-later'}):
                raise ValueError('unreviewed multiple Maven grants; do not infer an OR license')
        if component.startswith('rustls:rustls-platform-verifier:'):
            package = graph['rustls']
            if (component != 'rustls:rustls-platform-verifier:' + package['version'] or
                    package['name'] != 'rustls-platform-verifier-android' or not package.get('source') or
                    package['license'] != 'MIT OR Apache-2.0'):
                raise ValueError('Rustls AAR differs from reviewed Cargo provenance')
            crate = Path(package['manifest_path']).parent
            expected = crate / 'maven/rustls/rustls-platform-verifier' / package['version'] / f"rustls-platform-verifier-{package['version']}.aar"
            if path.resolve() != expected.resolve():
                raise ValueError('Rustls AAR does not belong to the resolved Cargo package')
            files = rust.license_files(crate)
            if not files:
                cargo_catalog = json.loads((ROOT / 'distribution/licenses/cargo-sources.json').read_text())
                texts += rust.supplemental(package, crate, cargo_catalog)
            texts += [f"Original Cargo package file: {p.relative_to(crate)}\n\n{rust.read_text(p)}" for p in files]
            grant = 'MIT OR Apache-2.0'
        elif declared_apache:
            grant = 'Apache-2.0'
        else:
            raise ValueError(f'missing or unreviewed Maven grant: {component}')
        if native:
            if component not in catalog['native_artifacts']:
                raise ValueError(f'unreviewed native AAR component: {component}')
            if digest(path.read_bytes()) != catalog['native_artifacts'][component]:
                raise ValueError('native AAR checksum changed; review its bundled attribution')
            if component == 'net.java.dev.jna:jna:5.17.0':
                texts.append('Bundled libffi original notice:\n' + reviewed_text(catalog, 'jna-libffi'))
            elif component == 'androidx.graphics:graphics-path:1.0.1':
                texts.append('Bundled graphics native notices:\n' + reviewed_text(catalog, 'graphics-native'))
            else:
                raise ValueError(f'unreviewed native AAR component: {component}')
        if not original and not component.startswith('rustls:'):
            texts.insert(0, 'Provenance: exact published Maven POM declaration; the artifact supplies no standalone notice text.\nThe standard Apache-2.0 text is included below. No copyright owner is inferred.')
        record = {'component': component, 'artifact_file': path.name, 'artifact_sha256': digest(path.read_bytes()),
                  'selected_license': grant, 'pom_evidence': poms,
                  'original_notices': [{k: p[k] for k in ('path', 'sha256')} for p in original],
                  'native_libraries': native}
        inventory.append(record)
        sections.append(f"## {component}\nSelected license: {grant}\nArtifact SHA-256: {record['artifact_sha256']}\n\n" + '\n\n'.join(texts))
    sections.append('## Standard Apache-2.0 license text\n\n' + reviewed_text(catalog, 'apache-2.0'))
    return sections, inventory


def generate(graph, output):
    if graph.get('schema') != 1 or graph.get('variant') not in {'debug', 'release'}:
        raise ValueError('unknown Android attribution variant/schema')
    catalog = json.loads((ROOT / 'distribution/licenses/android-sources.json').read_text())
    maven, maven_inventory = maven_notices(graph, catalog)
    rust_texts, rust_inventory, generator = rust.generate_rust_notices(TARGETS, ROOT / 'crates/rstorrent-android/Cargo.toml')
    text = ('# JSTorrent Android third-party notices\n\n'
            f"Variant: {graph['variant']}\n"
            'Scope: resolved Maven/AAR runtime artifacts and the locked default-feature Rust graph for both shipped ABIs, including build dependencies.\n'
            'Original notices and manifest-only declarations are distinguished below.\n'
            'Exact Rust source-package URLs identify upstream source; they are not a separate corresponding-source offer.\n\n' + rust.branding_notice() + '\n\n' + '\n\n'.join(maven + rust_texts) + '\n')
    encoded = text.encode('utf-8')
    if len(encoded) > MAX_OUTPUT:
        raise ValueError('Android notice bundle exceeds bound')
    manifest = {'schema': 1, 'variant': graph['variant'], 'targets': TARGETS,
                'generator': generator, 'cargo_lock_sha256': digest((ROOT / 'Cargo.lock').read_bytes()),
                'notices_sha256': digest(encoded), 'rust': rust_inventory, 'maven': maven_inventory}
    directory = output / 'notices'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'THIRD_PARTY_NOTICES.txt').write_bytes(encoded)
    (directory / 'dependency-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f"Prepared Android {graph['variant']} notices: {len(maven_inventory)} Maven and {len(rust_inventory)} Rust packages")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    generate(json.loads(bounded_read(args.graph, 4 * 1024**2)), args.output)


if __name__ == '__main__':
    main()

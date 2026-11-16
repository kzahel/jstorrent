import copy
from datetime import date
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import glib_backport
from test_distribution_review import audit, notices, package


class BackportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['Cargo.toml', 'Cargo.lock', glib_backport.MANIFEST,
                     'distribution/patches/glib-0.18.5-variant-iterator.patch']:
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(glib_backport.ROOT / name, dest)
        shutil.copytree(glib_backport.ROOT / 'vendor', self.root / 'vendor')

    def test_exact_published_tree_and_two_line_delta_pass(self):
        self.assertEqual(glib_backport.verify(self.root)['status'], 'source-verified-backport')

    def test_missing_extra_or_modified_source_fails(self):
        p = self.root / 'vendor/glib-0.18.5/src/variant_iter.rs'
        data = p.read_bytes()
        for contents in [None, data.replace(b'&mut p,', b'&p,'), data + b'\n']:
            with self.subTest(contents=contents is None):
                if contents is None:
                    p.unlink()
                else:
                    p.write_bytes(contents)
                with self.assertRaisesRegex(ValueError, 'inventory'):
                    glib_backport.verify(self.root)
                p.write_bytes(data)
        (p.parent / 'extra.rs').write_text('')
        with self.assertRaisesRegex(ValueError, 'inventory'):
            glib_backport.verify(self.root)

    def test_symlink_source_fails_even_with_matching_bytes(self):
        p = self.root / 'vendor/glib-0.18.5/LICENSE'
        p.unlink()
        p.symlink_to(glib_backport.ROOT / 'vendor/glib-0.18.5/LICENSE')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            glib_backport.verify(self.root)

    def test_windows_style_checkout_preserves_verified_source_bytes(self):
        import subprocess
        # A tiny owned repository exercises actual Git checkout conversion.
        # Preserve fixture bytes on import, then enable Windows autocrlf.
        shutil.copyfile(glib_backport.ROOT / '.gitattributes', self.root / '.gitattributes')
        def git(*args):
            return subprocess.run(['git', *args], cwd=self.root, check=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        git('init', '--quiet')
        git('-c', 'core.autocrlf=false', 'add', '.')
        checkout = self.root / 'checkout'
        git('-c', 'core.autocrlf=true', 'checkout-index', '--all', '--prefix=checkout/')
        self.assertIn(b'\r\n', (checkout / 'Cargo.lock').read_bytes())
        self.assertNotIn(b'\r\n', (checkout / glib_backport.MANIFEST).read_bytes())
        self.assertEqual(glib_backport.verify(checkout), glib_backport.verify(self.root))

    def test_audit_projection_keeps_registry_identity_and_original_lock(self):
        import tomllib
        path = self.root / 'Cargo.lock'
        original = path.read_bytes()
        lock, proof = glib_backport.audit_lock(self.root)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(proof['cargo_lock_sha256'], glib_backport.sha(original))
        glib = next(p for p in tomllib.loads(lock.decode())['package'] if p['name'] == 'glib')
        self.assertEqual(glib['source'], 'registry+https://github.com/rust-lang/crates.io-index')
        self.assertEqual(glib['checksum'], glib_backport.verify(self.root)['upstream_archive_sha256'])
        # Windows checkout newlines do not alter dependency identities.
        path.write_bytes(original.replace(b'\n', b'\r\n'))
        windows, proof = glib_backport.audit_lock(self.root)
        self.assertEqual(windows, lock)
        self.assertEqual(proof['cargo_lock_sha256'], glib_backport.sha(path.read_bytes()))

    def test_patch_or_manifest_drift_fails(self):
        for name in [glib_backport.MANIFEST, 'distribution/patches/glib-0.18.5-variant-iterator.patch']:
            p = self.root / name
            original = p.read_bytes()
            p.write_bytes(original + b'\n')
            with self.assertRaises(ValueError):
                glib_backport.verify(self.root)
            p.write_bytes(original)

    def test_registry_lock_or_removed_override_fails(self):
        p = self.root / 'Cargo.lock'
        data = p.read_text()
        p.write_text(data.replace('name = "glib"\nversion = "0.18.5"',
                                 'name = "glib"\nversion = "0.18.5"\nsource = "registry+https://github.com/rust-lang/crates.io-index"'))
        with self.assertRaisesRegex(ValueError, 'Cargo.lock'):
            glib_backport.verify(self.root)
        p.write_text(data)
        p = self.root / 'Cargo.toml'
        p.write_text(p.read_text().replace('glib = { path = "vendor/glib-0.18.5" }', ''))
        with self.assertRaisesRegex(ValueError, 'override'):
            glib_backport.verify(self.root)

    def test_audit_cannot_clear_a_local_package_without_source_proof(self):
        proof = glib_backport.verify(self.root)
        policy = {'reviewed_at': '2026-09-12', 'review_expires': '2026-10-12', 'warnings': [], 'release_blockers': [],
                  'backports': [{k: proof[k] for k in
                                ('package', 'version', 'advisory', 'source_manifest_sha256')}]}
        cargo = {'vulnerabilities': {'count': 0}, 'warnings': {},
                 'database': {'last-commit': 'test', 'last-updated': '2026-09-12T00:00:00+00:00'}}
        npm = {'metadata': {'vulnerabilities': {'total': 0}}}
        with self.assertRaisesRegex(ValueError, 'verified source'):
            audit.review(cargo, npm, npm, policy, date(2026, 9, 12))
        result = audit.review(cargo, npm, npm, policy, date(2026, 9, 12), [proof])
        self.assertTrue(result['release_ready'])
        self.assertEqual(result['source_verified_backports'], [proof])
        future = copy.deepcopy(cargo)
        future['warnings'] = {'unsound': [{'advisory': {'id': 'RUSTSEC-future-glib'},
                                          'package': {'name': 'glib', 'version': '0.18.5'}}]}
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            audit.review(future, npm, npm, policy, date(2026, 9, 12), [proof])
        changed = copy.deepcopy(proof)
        changed['source_manifest_sha256'] = 'wrong'
        with self.assertRaisesRegex(ValueError, 'verified source'):
            audit.review(cargo, npm, npm, policy, date(2026, 9, 12), [changed])

    def test_local_glib_keeps_original_license_and_patch_in_notices(self):
        data = {'crates': [{'package': {'name': 'glib', 'version': '0.18.5',
                'source': None, 'license': 'MIT',
                'manifest_path': str(self.root / 'vendor/glib-0.18.5/Cargo.toml')}}], 'licenses': []}
        with patch.object(notices, 'ROOT', self.root):
            sections, inventory = notices.rust_notices(data, {})
        self.assertIn('Permission is hereby granted', sections[0])
        self.assertIn('+                &mut p,', sections[0])
        self.assertEqual(inventory[0]['backport'], glib_backport.verify(self.root))
        data['crates'][0]['package']['name'] = 'unreviewed'
        with self.assertRaisesRegex(ValueError, 'unreviewed local'):
            notices.rust_notices(data, {})

    def test_linux_package_rejects_omitted_or_misidentified_backport(self):
        output = self.root / 'package'
        output.mkdir()
        text = b'original notice text'
        (output / 'THIRD_PARTY_NOTICES.txt').write_bytes(text)
        manifest = {'schema': 1, 'target': 'x86_64-unknown-linux-gnu',
                    'rust': [{'name': 'glib', 'version': '0.18.5', 'license': 'MIT',
                              'source': glib_backport.verify(self.root)['upstream_archive'],
                              'backport': glib_backport.verify(self.root)}],
                    'npm': [{}], 'cargo_lock_sha256': 'test', 'npm_lock_sha256': 'test',
                    'notices_sha256': notices.digest(text)}
        path = output / 'dependency-manifest.json'
        path.write_text(json.dumps(manifest))
        package.inspect(output)
        incorrect_version = copy.deepcopy(manifest['rust'])
        incorrect_version[0]['version'] = '0.20.0'
        for rust in [[{'name': 'glib'}], [{'name': 'other'}], incorrect_version]:
            manifest['rust'] = rust
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'exact verified GLib'):
                package.inspect(output)
        manifest['target'] = 'aarch64-apple-darwin'
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'reviewed Linux target'):
            package.inspect(output, require_native=True)


if __name__ == '__main__':
    unittest.main()

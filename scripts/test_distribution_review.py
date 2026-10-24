import copy
from datetime import date
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = load('review-dependency-audit')
package = load('inspect-distribution')
notices = load('prepare-release-notices')
collector = load('audit-cargo-dependencies')


class PlaybackDependencySourceTests(unittest.TestCase):
    def test_rust_notices_keep_their_registry_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'LICENSE').write_text('Published MIT license attribution')
            data = {'crates': [{'package': {'name': 'example', 'version': '1.0.0',
                     'license': 'MIT', 'source': 'registry+https://example.com',
                     'manifest_path': str(root / 'Cargo.toml')}}], 'licenses': []}
            sections, inventory = notices.rust_notices(data, {})
            self.assertEqual(inventory[0]['source'],
                             'https://crates.io/api/v1/crates/example/1.0.0/download')
            self.assertIn('Published MIT license attribution', sections[0])

    def test_only_the_reviewed_immutable_git_source_is_accepted(self):
        package = {'name': 'mediabunny', 'version': '1.38.1', 'license': 'MPL-2.0'}
        locked = {'resolved': 'git+https://github.com/kzahel/mediabunny.git#cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0'}
        self.assertIn('cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0.tar.gz', notices.npm_source(locked, package))
        ssh = {'resolved': locked['resolved'].replace('git+https://', 'git+ssh://git@')}
        self.assertEqual(notices.npm_source(locked, package), notices.npm_source(ssh, package))
        for bad in ['git+https://github.com/kzahel/mediabunny.git#integration',
                    'git+ssh://git@github.com/kzahel/mediabunny.git#integration',
                    'git+ssh://git@github.com/other/mediabunny.git#cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0',
                    'git+https://example.com/mediabunny.git#cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0']:
            with self.assertRaisesRegex(ValueError, 'reviewed source integrity'):
                notices.npm_source({'resolved': bad}, package)
        with self.assertRaises(ValueError):
            notices.npm_source(locked, {**package, 'license': 'unknown'})

    def test_production_lockfile_sources_are_accepted(self):
        lock = json.loads((notices.ROOT / 'clients/web/package-lock.json').read_text())
        sources = {}
        for key, locked in lock['packages'].items():
            if key and (not locked.get('dev') or key == 'node_modules/ajv'):
                name = key.rsplit('node_modules/', 1)[-1]
                sources[name] = notices.npm_source(locked, {**locked, 'name': name})
        self.assertEqual(sources['mediabunny'],
                         'https://github.com/kzahel/mediabunny/archive/'
                         'cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0.tar.gz')


class AdvisoryReviewTests(unittest.TestCase):
    def setUp(self):
        self.cargo = {'vulnerabilities': {'count': 0},
                      'database': {'last-commit': 'abc', 'last-updated': '2026-09-09T00:00:00+00:00'},
                      'warnings': {'unsound': [{'advisory': {'id': 'RUSTSEC-test'},
                                               'package': {'name': 'example', 'version': '1.0'}}]}}
        self.npm = {'metadata': {'vulnerabilities': {'total': 0}}}
        self.website_npm = {'metadata': {'vulnerabilities': {'total': 0}}}
        self.policy = {'review_expires': '2026-10-12',
                       'warnings': [{'kind': 'unsound', 'advisory': 'RUSTSEC-test',
                                     'package': 'example', 'version': '1.0'}],
                       'release_blockers': ['unresolved unsound implementation']}

    def test_review_never_turns_known_blocker_into_release_clearance(self):
        result = audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))
        self.assertFalse(result['release_ready'])
        self.assertEqual(len(result['reviewed_warnings']), 1)

    def test_new_and_removed_warnings_require_review(self):
        changed = copy.deepcopy(self.cargo)
        changed['warnings'] = {}
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            audit.review(changed, self.npm, self.website_npm, self.policy, date(2026, 9, 12))
        changed['warnings'] = {'yanked': [{'package': {'name': 'new', 'version': '1'}}]}
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            audit.review(changed, self.npm, self.website_npm, self.policy, date(2026, 9, 12))

    def test_conditional_rand_warning_requires_feature_proof_and_blocks_logger_activation(self):
        item = {'advisory': {'id': 'RUSTSEC-2026-0097'},
                'package': {'name': 'rand', 'version': '0.7.3'}}
        self.cargo['warnings'] = {'unsound': [item]}
        self.policy['warnings'] = [{'kind': 'unsound', 'advisory': item['advisory']['id'],
                                   'package': 'rand', 'version': '0.7.3'}]
        with self.assertRaisesRegex(ValueError, 'log feature'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))
        self.cargo['rstorrent_reviewed_features'] = {'rand@0.7.3': ['std', 'small_rng']}
        audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))
        self.cargo['rstorrent_reviewed_features']['rand@0.7.3'].append('log')
        with self.assertRaisesRegex(ValueError, 'log feature'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))

    def test_expired_review_stale_database_and_vulnerabilities_fail(self):
        with self.assertRaisesRegex(ValueError, '30 days'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 10, 13))
        self.cargo['database']['last-updated'] = '2026-10-12T00:00:00+00:00'
        with self.assertRaisesRegex(ValueError, 'expired'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 10, 13))
        self.cargo['vulnerabilities']['count'] = 1
        with self.assertRaisesRegex(ValueError, 'vulnerabilities'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))
        self.cargo['vulnerabilities']['count'] = 0
        self.npm['metadata']['vulnerabilities']['total'] = 1
        with self.assertRaisesRegex(ValueError, 'npm'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))

    def test_website_findings_fail_and_summary_is_bounded(self):
        self.website_npm['metadata']['vulnerabilities']['total'] = 1
        self.website_npm['vulnerabilities'] = {
            'astro': {'severity': 'critical', 'via': ['unreviewed details']}}
        with self.assertRaisesRegex(ValueError, 'website npm'):
            audit.review(self.cargo, self.npm, self.website_npm, self.policy, date(2026, 9, 12))
        result = audit.failure_summary(self.cargo, self.npm, self.website_npm,
                                       'website npm vulnerability report is missing or has vulnerabilities')
        self.assertEqual(result['npm_vulnerability_counts']['website'], 1)
        self.assertEqual(result['npm_findings']['website'],
                         [{'package': 'astro', 'severity': 'critical'}])
        self.assertNotIn('unreviewed details', json.dumps(result))


class ProbeAdvisoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock = self.root / audit.PROBE_LOCKFILE
        self.lock.parent.mkdir(parents=True)
        self.lock.write_bytes(b'probe lockfile')
        self.today = date(2026, 10, 23)
        self.cargo = {'rstorrent_ios_probe': {
            'lock_sha256': audit.hashlib.sha256(self.lock.read_bytes()).hexdigest(),
            'audit': {'database': {'last-updated': '2026-10-22T00:00:00+00:00',
                                   'last-commit': 'abc'},
                      'vulnerabilities': {'count': 0}, 'warnings': {}}}}

    def test_collection_audits_both_locks_without_rewriting_them(self):
        metadata = json.dumps({'packages': [], 'resolve': {'nodes': []}})
        with patch.object(collector.glib_backport, 'audit_lock',
                          return_value=(b'root projection', {'source': 'verified'})), \
                patch.object(collector.subprocess, 'check_output',
                             side_effect=['cargo-audit 0.22.2', metadata]), \
                patch.object(collector.dependency_exceptions, 'collect_context',
                             return_value={'review': 'exact context'}) as context, \
                patch.object(collector, 'audit_lock', return_value={}) as collect:
            result = collector.collect(self.root)
        context.assert_called_once_with(json.loads(metadata), self.root)
        self.assertEqual(result['rstorrent_vulnerability_context'], {'review': 'exact context'})
        self.assertEqual([c.args[0] for c in collect.call_args_list],
                         [b'root projection', b'probe lockfile'])
        self.assertEqual(result['rstorrent_ios_probe']['lock_sha256'],
                         self.cargo['rstorrent_ios_probe']['lock_sha256'])
        self.assertEqual(self.lock.read_bytes(), b'probe lockfile')

    def test_clean_probe_records_exact_lock_and_database(self):
        result = audit.review_ios_probe(self.cargo, self.today, self.root)
        self.assertEqual(result['lockfile'], audit.PROBE_LOCKFILE)
        self.assertEqual(result['database_revision'], 'abc')
        self.assertEqual(result['cargo_vulnerabilities'], 0)

    def test_missing_report_and_changed_lock_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'current lockfile'):
            audit.review_ios_probe({}, self.today, self.root)
        self.lock.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'current lockfile'):
            audit.review_ios_probe(self.cargo, self.today, self.root)

    def test_probe_vulnerabilities_and_warnings_are_rejected(self):
        report = self.cargo['rstorrent_ios_probe']['audit']
        report['vulnerabilities']['count'] = 1
        with self.assertRaisesRegex(ValueError, 'vulnerabilities'):
            audit.review_ios_probe(self.cargo, self.today, self.root)
        report['vulnerabilities']['count'] = 0
        report['warnings'] = {'yanked': [{'package': {'name': 'chacha20'}}]}
        with self.assertRaisesRegex(ValueError, 'warnings'):
            audit.review_ios_probe(self.cargo, self.today, self.root)
        report.pop('warnings')
        with self.assertRaisesRegex(ValueError, 'warnings'):
            audit.review_ios_probe(self.cargo, self.today, self.root)

    def test_stale_and_future_probe_database_are_rejected(self):
        report = self.cargo['rstorrent_ios_probe']['audit']
        for updated in ('2026-09-01T00:00:00+00:00', '2026-10-24T00:00:00+00:00'):
            report['database']['last-updated'] = updated
            with self.assertRaisesRegex(ValueError, '30 days'):
                audit.review_ios_probe(self.cargo, self.today, self.root)

    def test_failure_summary_retains_bounded_probe_findings(self):
        report = self.cargo['rstorrent_ios_probe']['audit']
        report['vulnerabilities'] = {'count': 25, 'list': [{
            'advisory': {'id': 'RUSTSEC-test', 'description': 'raw advisory'},
            'package': {'name': 'quinn-proto', 'version': '0.11.16'},
        }] * 25}
        result = audit.failure_summary(self.cargo, {}, {}, 'probe failure')
        self.assertEqual(result['ios_probe_vulnerability_count'], 25)
        self.assertEqual(len(result['ios_probe_findings']), 20)
        self.assertNotIn('raw advisory', json.dumps(result))


class VulnerabilityExceptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.helper = audit.dependency_exceptions
        for name in ('Cargo.toml', 'Cargo.lock', self.helper.EVIDENCE,
                     self.helper.CRYPTO_SOURCE + '/opaque.rs'):
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('reviewed bytes\n')
        packages = [{'id': f'{name}-{version}', 'name': name, 'version': version,
                     'source': self.helper.REGISTRY}
                    for name, version in sorted(self.helper.BACKENDS)]
        packages.append({'id': 'workspace', 'name': 'host', 'version': '0.1.0',
                         'source': None, 'manifest_path': str(self.root / 'Cargo.toml')})
        self.metadata = {'packages': packages, 'workspace_members': ['workspace'],
                         'resolve': {'nodes': [
                             {'id': p['id'], 'features': ['ristretto255'], 'dependencies': []}
                             for p in packages]}}
        context = self.helper.collect_context(self.metadata, self.root)
        self.exception = dict(zip(('advisory', 'package', 'version', 'source', 'checksum'),
                                  self.helper.IDENTITY))
        self.exception.update(reviewed_at='2026-10-24', expires='2026-11-12',
                              evidence=self.helper.EVIDENCE, reason='Reviewed unreachable arithmetic',
                              context_sha256=self.helper.fingerprint(context))
        self.policy = {'review_expires': '2026-11-12', 'warnings': [], 'release_blockers': [],
                       'vulnerability_exceptions': [self.exception]}
        self.cargo = {'vulnerabilities': {'count': 1, 'list': [{
            'advisory': {'id': self.exception['advisory']},
            'package': {k: self.exception[v] for k, v in (
                ('name', 'package'), ('version', 'version'), ('source', 'source'), ('checksum', 'checksum'))}}]},
            'rstorrent_vulnerability_context': context, 'warnings': {},
            'database': {'last-commit': 'abc', 'last-updated': '2026-10-24T00:00:00+00:00'}}
        self.npm = {'metadata': {'vulnerabilities': {'total': 0}}}
        self.today = date(2026, 10, 24)

    def review(self):
        return audit.review(self.cargo, self.npm, self.npm, self.policy, self.today, root=self.root)

    def test_exact_exception_passes_without_hiding_the_finding(self):
        before = copy.deepcopy(self.cargo)
        result = self.review()
        self.assertEqual(result['cargo_vulnerabilities'], 1)
        self.assertEqual(result['unexcepted_cargo_vulnerabilities'], 0)
        self.assertEqual(result['reviewed_vulnerability_exceptions'], [self.exception])
        self.assertTrue(result['release_ready'])
        self.assertEqual(self.cargo, before)

    def test_exception_is_required_and_stale_or_duplicate_exceptions_fail(self):
        for exceptions in ([], [self.exception, self.exception]):
            with self.subTest(exceptions=len(exceptions)):
                self.policy['vulnerability_exceptions'] = exceptions
                with self.assertRaises(ValueError):
                    self.review()
        self.policy['vulnerability_exceptions'] = [self.exception]
        self.cargo['vulnerabilities'] = {'count': 0, 'list': []}
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            self.review()

    def test_changed_advisory_version_registry_or_checksum_is_not_excepted(self):
        finding = self.cargo['vulnerabilities']['list'][0]
        for target, field, changed in ((finding['advisory'], 'id', 'RUSTSEC-new'),
                                       (finding['package'], 'name', 'other'),
                                       (finding['package'], 'version', '0.5.6'),
                                       (finding['package'], 'source', 'another registry'),
                                       (finding['package'], 'checksum', 'changed')):
            with self.subTest(field=field):
                original = target[field]
                target[field] = changed
                with self.assertRaisesRegex(ValueError, 'inventory changed'):
                    self.review()
                target[field] = original
        self.exception['version'] = '0.5.*'
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            self.review()

    def test_new_findings_and_inconsistent_reports_fail(self):
        original = copy.deepcopy(self.cargo['vulnerabilities'])
        for report in ({}, {'count': 1}, {'count': True, 'list': []},
                       {'count': 0, 'list': original['list']},
                       {'count': 2, 'list': original['list'] * 2}):
            with self.subTest(report=report):
                self.cargo['vulnerabilities'] = report
                with self.assertRaises(ValueError):
                    self.review()

    def test_expiry_future_review_and_overlong_reviews_fail(self):
        for reviewed, expires in (('2026-10-24', '2026-10-23'),
                                  ('2026-10-25', '2026-11-12'),
                                  ('2026-09-01', '2026-11-12'),
                                  ('2026-10-24', '2026-11-13')):
            with self.subTest(reviewed=reviewed, expires=expires):
                self.exception.update(reviewed_at=reviewed, expires=expires)
                with self.assertRaises(ValueError):
                    self.review()
        self.exception.update(reviewed_at='2026-10-24', expires='2026-11-12')
        self.today = date(2026, 11, 13)
        with self.assertRaisesRegex(ValueError, 'exception has expired'):
            self.review()

    def test_reason_and_evidence_are_required(self):
        for field, value in (('reason', ''), ('reason', None), ('evidence', 'unreviewed.md')):
            with self.subTest(field=field, value=value):
                original = self.exception[field]
                self.exception[field] = value
                with self.assertRaisesRegex(ValueError, 'bounded review and evidence'):
                    self.review()
                self.exception[field] = original

    def test_changed_source_manifest_lock_or_evidence_invalidates_old_report(self):
        for path in self.cargo['rstorrent_vulnerability_context']['files']:
            with self.subTest(path=path):
                file = self.root / path
                original = file.read_bytes()
                file.write_bytes(original + b'changed')
                with self.assertRaisesRegex(ValueError, 'context changed'):
                    self.review()
                file.write_bytes(original)
        extra = self.root / self.helper.CRYPTO_SOURCE / 'new_suite.rs'
        extra.write_text('new suite')
        with self.assertRaisesRegex(ValueError, 'context changed'):
            self.review()

    def test_backend_features_or_new_dependents_invalidate_context(self):
        for change in ('features', 'dependents'):
            metadata = copy.deepcopy(self.metadata)
            if change == 'features':
                metadata['resolve']['nodes'][0]['features'].append('new-backend')
            else:
                metadata['resolve']['nodes'][-1]['dependencies'].append(
                    metadata['resolve']['nodes'][0]['id'])
            self.cargo['rstorrent_vulnerability_context'] = self.helper.collect_context(metadata, self.root)
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'context changed'):
                self.review()

    def test_context_is_portable_and_order_independent(self):
        metadata = copy.deepcopy(self.metadata)
        metadata['packages'].reverse()
        metadata['resolve']['nodes'].reverse()
        context = self.helper.collect_context(metadata, self.root)
        self.assertEqual(context, self.cargo['rstorrent_vulnerability_context'])
        self.assertNotIn(str(self.root), json.dumps(context))

    def test_exception_keeps_other_review_guards(self):
        for change in ('npm', 'warnings', 'database', 'release_blocker'):
            with self.subTest(change=change):
                cargo, npm, policy = copy.deepcopy((self.cargo, self.npm, self.policy))
                if change == 'npm':
                    npm['metadata']['vulnerabilities']['total'] = 1
                elif change == 'warnings':
                    cargo['warnings'] = {'yanked': [{'package': {'name': 'new', 'version': '1'}}]}
                elif change == 'database':
                    cargo['database']['last-updated'] = '2026-09-01T00:00:00+00:00'
                else:
                    policy['release_blockers'] = ['unresolved blocker']
                if change == 'release_blocker':
                    result = audit.review(cargo, npm, npm, policy, self.today, root=self.root)
                    self.assertFalse(result['release_ready'])
                else:
                    with self.assertRaises(ValueError):
                        audit.review(cargo, npm, npm, policy, self.today, root=self.root)


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_new_package_requires_notices_and_validates_content(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            package.inspect(self.root)
        (self.root / 'THIRD_PARTY_NOTICES.txt').write_text('original attribution')
        manifest = {'schema': 1, 'target': 'test', 'rust': [{}], 'npm': [{}],
                    'cargo_lock_sha256': 'a', 'npm_lock_sha256': 'b',
                    'notices_sha256': notices.digest(b'original attribution')}
        (self.root / 'dependency-manifest.json').write_text(json.dumps(manifest))
        self.assertEqual(len(package.inspect(self.root)['notice_manifests']), 1)
        (self.root / 'THIRD_PARTY_NOTICES.txt').write_text('changed attribution')
        with self.assertRaisesRegex(ValueError, 'differs'):
            package.inspect(self.root)

    def test_historical_inventory_is_explicitly_not_notice_clearance(self):
        self.assertEqual(package.inspect(self.root, False)['notice_manifests'], [])

    def test_private_key_crossing_read_boundary_is_rejected(self):
        (self.root / 'settings.json').write_bytes(b' ' * 65530 + b'-----BEGIN PRIVATE KEY-----')
        with self.assertRaisesRegex(ValueError, 'private key'):
            package.inspect(self.root, False)

    def test_development_files_and_endpoints_are_rejected(self):
        for name, data in [('.env.production', b'anything'), ('app.js.map', b'{}'),
                           ('index.html', b'http://localhost:5173/@vite/client')]:
            with self.subTest(name=name):
                path = self.root / name
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    package.inspect(self.root, False)
                path.unlink()

    def test_external_symlink_is_rejected(self):
        (self.root / 'escape').symlink_to(self.root.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'escapes'):
            package.inspect(self.root, False)

    def test_unknown_and_changed_license_grants_fail_closed(self):
        p = {'name': 'example', 'version': '1.0', 'license': 'MIT'}
        (self.root / 'Cargo.toml').write_text('original grant')
        with self.assertRaisesRegex(ValueError, 'missing reviewed'):
            notices.supplemental(p, self.root, {})
        catalog = {'example@1.0': {'license': 'MIT', 'manifest_sha256': notices.digest(b'original grant'),
                                  'files': [], 'declaration_only': True}}
        self.assertIn('declaration', notices.supplemental(p, self.root, catalog)[0])
        (self.root / 'Cargo.toml').write_text('changed grant')
        with self.assertRaisesRegex(ValueError, 'drift'):
            notices.supplemental(p, self.root, catalog)


class NativeNoticeTests(unittest.TestCase):
    def setUp(self):
        import native_notices
        self.native = native_notices
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'AppDir'
        self.root.mkdir()
        for name in {'usr/bin/jstorrent-client', 'usr/bin/rstorrent-native-host',
                     'usr/lib/libexample.so.1', 'usr/lib/libssl.so.3', 'usr/bin/xdg-mime'}:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'#!/bin/sh\n' if name.endswith('xdg-mime') else b'\x7fELFexample')
        self.copyright = self.root.parent / 'copyright'
        self.copyright.write_bytes(b'Original holder\nSee /usr/share/common-licenses/MIT\n')
        self.common = self.root.parent / 'MIT'
        self.common.write_bytes(b'Original common license\n')
        test = self

        class Provenance:
            def identify(self, path, digest):
                if path.name == 'libssl.so.3':
                    return {'package': 'libssl3:amd64', 'version': '3.0.2-0ubuntu1.30',
                            'source_package': 'openssl', 'source_version': '3.0.2-0ubuntu1.30',
                            'original_path': '/usr/lib/libssl.so.3',
                            'original_sha256': digest, 'build_id': 'abcdef'}
                return {'package': 'example:amd64', 'version': '1.2-1',
                        'source_package': 'example', 'source_version': '1.2-1',
                        'original_path': '/usr/lib/libexample.so.1.2',
                        'original_sha256': digest, 'build_id': 'abcdef'}

            def copyright(self, package):
                return test.copyright

            def common_license(self, name):
                return test.common

        self.provenance = Provenance()

    def test_selected_components_and_original_license_bytes_round_trip(self):
        result = self.native.collect(self.root, self.provenance)
        self.assertEqual(len(result['components']), 5)
        self.assertEqual(len(result['packages']), 2)
        self.assertEqual(len(result['notices']), 3)
        copyright_path = self.root / result['packages'][0]['copyright']
        self.assertEqual(copyright_path.read_bytes(), self.copyright.read_bytes())
        self.assertEqual(self.native.verify(self.root)['distro_packages'], 2)
        self.assertNotIn(str(self.root.parent), json.dumps(result))
        self.assertTrue(result['remaining_review'])

    def test_historical_desktop_remains_independently_reviewable(self):
        (self.root / 'usr/bin/jstorrent-client').rename(self.root / 'usr/bin/rstorrent-desktop')
        result = self.native.collect(self.root, self.provenance)
        desktops = [item for item in result['components']
                    if item['path'] in self.native.DESKTOP_BINARIES]
        self.assertEqual([(item['path'], item['kind']) for item in desktops],
                         [('usr/bin/rstorrent-desktop', 'first-party')])
        self.assertEqual(self.native.verify(self.root)['distro_packages'], 2)

    def add_reviewed_apprun_fixture(self, architecture):
        from unittest.mock import patch
        binary = self.root / 'AppRun.wrapped'
        binary.write_bytes(b'\x7fELFcontrolled-apprun-' + architecture.encode())
        review = patch.dict(self.native.APPRUN, {self.native.sha(binary): architecture})
        review.start()
        self.addCleanup(review.stop)

    def test_apprun_both_architectures_preserve_original_notice(self):
        for architecture in ['x86_64', 'aarch64']:
            with self.subTest(architecture=architecture):
                self.add_reviewed_apprun_fixture(architecture)
                result = self.native.collect(self.root, self.provenance)
                entry = next(c for c in result['components'] if c['kind'] == 'apprun')
                self.assertEqual(entry['architecture'], architecture)
                self.assertEqual(entry['license'], 'MIT')
                notice = self.root / entry['copyright']
                self.assertEqual(notice.read_bytes(), self.native.APPRUN_LICENSE.read_bytes())
                self.assertIn(b'Simon Peter', notice.read_bytes())
                self.assertIn(b'RazZziel', notice.read_bytes())
                self.assertEqual(self.native.verify(self.root)['notice_files'], 4)

    def test_apprun_missing_or_forged_attribution_is_refused(self):
        import hashlib
        self.add_reviewed_apprun_fixture('x86_64')
        original = self.native.collect(self.root, self.provenance)
        for key in ['architecture', *self.native.APPRUN_NOTICE]:
            with self.subTest(field=key):
                modified = copy.deepcopy(original)
                entry = next(c for c in modified['components'] if c['kind'] == 'apprun')
                entry[key] = 'unreviewed'
                (self.root / self.native.MANIFEST).write_text(json.dumps(modified))
                with self.assertRaisesRegex(ValueError, 'AppRun license attribution'):
                    self.native.verify(self.root)
        modified = copy.deepcopy(original)
        name = self.native.APPRUN_NOTICE['copyright']
        modified['notices'] = [n for n in modified['notices'] if n['path'] != name]
        (self.root / self.native.MANIFEST).write_text(json.dumps(modified))
        with self.assertRaisesRegex(ValueError, 'AppRun license attribution'):
            self.native.verify(self.root)
        modified = copy.deepcopy(original)
        notice = next(n for n in modified['notices'] if n['path'] == name)
        payload = b'Forged terms'
        (self.root / name).write_bytes(payload)
        notice.update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
        (self.root / self.native.MANIFEST).write_text(json.dumps(modified))
        with self.assertRaisesRegex(ValueError, 'AppRun license attribution'):
            self.native.verify(self.root)

    def test_apprun_source_notice_drift_is_refused_before_manifest(self):
        from unittest.mock import patch
        self.add_reviewed_apprun_fixture('x86_64')
        changed = self.root.parent / 'changed-AppRun-license'
        changed.write_bytes(b'Altered terms')
        with patch.object(self.native, 'APPRUN_LICENSE', changed):
            with self.assertRaisesRegex(ValueError, 'AppRun license source drift'):
                self.native.collect(self.root, self.provenance)
        self.assertFalse((self.root / self.native.MANIFEST).exists())

    def test_missing_or_duplicate_desktop_is_refused(self):
        binary = self.root / 'usr/bin/jstorrent-client'
        old = self.root / 'usr/bin/rstorrent-desktop'
        old.write_bytes(binary.read_bytes())
        with self.assertRaisesRegex(ValueError, 'expected first-party binaries'):
            self.native.collect(self.root, self.provenance)
        old.unlink()
        binary.unlink()
        with self.assertRaisesRegex(ValueError, 'expected first-party binaries'):
            self.native.collect(self.root, self.provenance)

    def test_reviewed_openssl_floors_and_future_security_revisions(self):
        for version in ('3.0.2-0ubuntu1.30', '3.0.2-0ubuntu1.100',
                        '3.0.13-0ubuntu3.16', '3.0.13-0ubuntu3.20'):
            with self.subTest(version=version):
                package = {'package': 'libssl3t64:arm64', 'version': version,
                           'source_package': 'openssl', 'source_version': version}
                result = self.native.verify_security_floor([package])
                self.assertEqual(result['packages'][0]['version'], version)
        for version in ('3.0.2-0ubuntu1.29', '3.0.13-0ubuntu3.9'):
            with self.subTest(version=version):
                package = {'package': 'libssl3:amd64', 'version': version,
                           'source_package': 'openssl', 'source_version': version}
                with self.assertRaisesRegex(ValueError, 'below USN-8847-1'):
                    self.native.verify_security_floor([package])

    def test_unreviewed_or_missing_openssl_provenance_fails_closed(self):
        for version in ('3.5.5-1ubuntu3.6', '1:3.0.2-0ubuntu1.30',
                        '3.0.2-0ubuntu1.30+local', '3.0.2-0ubuntu1.030'):
            package = {'package': 'libssl3:amd64', 'version': version,
                       'source_package': 'openssl', 'source_version': version}
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, 'requires security-floor review'):
                self.native.verify_security_floor([package])
        package = {'package': 'libssl3:amd64', 'version': '3.0.2-0ubuntu1.30',
                   'source_package': 'openssl', 'source_version': '3.0.2-0ubuntu1.30'}
        for changed in ({'source_package': 'unreviewed'}, {'version': '3.0.2-0ubuntu1.29'}):
            with self.assertRaisesRegex(ValueError, 'attribution differs'):
                self.native.verify_security_floor([{**package, **changed}])
        for packages in ([], [package, {**package, 'package': 'libssl3:arm64'}]):
            with self.assertRaisesRegex(ValueError, 'exactly one'):
                self.native.verify_security_floor(packages)

    def test_old_openssl_refused_before_manifest_and_after_extraction(self):
        from unittest.mock import patch
        identify = self.provenance.identify
        def old(path, digest):
            item = identify(path, digest)
            if item['source_package'] == 'openssl':
                item.update(version='3.0.2-0ubuntu1.29', source_version='3.0.2-0ubuntu1.29')
            return item
        with patch.object(self.provenance, 'identify', side_effect=old):
            with self.assertRaisesRegex(ValueError, 'below USN-8847-1'):
                self.native.collect(self.root, self.provenance)
        self.assertFalse((self.root / self.native.MANIFEST).exists())
        result = self.native.collect(self.root, self.provenance)
        for item in result['packages'] + result['components']:
            if item.get('source_package') == 'openssl':
                item.update(version='3.0.2-0ubuntu1.29', source_version='3.0.2-0ubuntu1.29')
        (self.root / self.native.MANIFEST).write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'below USN-8847-1'):
            self.native.verify(self.root)

    def test_spdx_common_license_name_uses_ubuntu_canonical_text(self):
        from unittest.mock import patch
        root = self.root.parent / 'common-licenses'
        root.mkdir()
        canonical = root / 'GPL-2'
        canonical.write_bytes(b'GNU GPL version 2 text')
        (root / 'GPL-3').symlink_to(self.copyright)
        with patch.object(self.native, 'COMMON_LICENSE_ROOT', root):
            provenance = self.native.DpkgProvenance()
            self.assertEqual(provenance.common_license('GPL-2.0'), canonical)
            with self.assertRaises(FileNotFoundError):
                provenance.common_license('unreviewed-license')
            with self.assertRaisesRegex(ValueError, 'escapes'):
                provenance.common_license('GPL-3.0')

    def test_missing_or_changed_component_is_rejected(self):
        self.native.collect(self.root, self.provenance)
        path = self.root / 'usr/lib/libexample.so.1'
        original = path.read_bytes()
        for changed in (b'\x7fELFmodified', None):
            with self.subTest(changed=changed):
                if changed is None:
                    path.unlink()
                else:
                    path.write_bytes(changed)
                with self.assertRaisesRegex(ValueError, 'inventory differs'):
                    self.native.verify(self.root)
                path.write_bytes(original)
        (self.root / 'usr/lib/unattributed').write_bytes(b'\x7fELFnew')
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            self.native.verify(self.root)

    def test_corrupted_notice_and_first_party_exemption_are_rejected(self):
        result = self.native.collect(self.root, self.provenance)
        path = self.root / result['packages'][0]['copyright']
        path.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.native.verify(self.root)
        path.write_bytes(self.copyright.read_bytes())
        next(item for item in result['components'] if item['path'].endswith('libexample.so.1'))['kind'] = 'first-party'
        (self.root / self.native.MANIFEST).write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'exemption'):
            self.native.verify(self.root)

    def test_external_symlink_and_oversized_notice_are_rejected(self):
        (self.root / 'escape').symlink_to(self.root.parent)
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.native.collect(self.root, self.provenance)
        (self.root / 'escape').unlink()
        from unittest.mock import patch
        with patch.object(self.native, 'MAX_FILE', 2):
            with self.assertRaisesRegex(ValueError, 'bounds'):
                self.native.collect(self.root, self.provenance)

    def test_unmapped_distro_binary_fails_before_packaging(self):
        from unittest.mock import patch
        with patch.object(self.provenance, 'identify', side_effect=ValueError('no distro provenance')):
            with self.assertRaisesRegex(ValueError, 'no distro provenance'):
                self.native.collect(self.root, self.provenance)

    def test_dpkg_matches_runtime_owner_and_rejects_ambiguity(self):
        from unittest.mock import patch
        source = self.root.parent / 'libexample.so.1'
        source.write_bytes(b'\x7fELFsource')
        calls = []

        def command(args, accepted=(0,)):
            calls.append(args)
            if args[0] == 'readelf':
                return 'Build ID: abcdef\n'
            if '--show' in args:
                return 'example:amd64\t1.2-1\texample\t1.2-1'
            return f'example:amd64: {source}\n'

        with patch.object(self.native, 'command', side_effect=command):
            result = self.native.DpkgProvenance().identify(source, self.native.sha(source))
        self.assertEqual(result['package'], 'example:amd64')
        self.assertEqual(result['build_id'], 'abcdef')
        self.assertTrue(any(a[-1] == str(source) for a in calls if '--search' in a))
        def ambiguous(args, accepted=(0,)):
            output = command(args, accepted)
            if '--search' in args:
                output += f'another:amd64: {source}\n'
            return output
        with patch.object(self.native, 'command', side_effect=ambiguous):
            with self.assertRaisesRegex(ValueError, 'ambiguous distro'):
                self.native.DpkgProvenance().identify(source, self.native.sha(source))

    def test_explicit_appimage_gate_cannot_be_bypassed_by_missing_apprun(self):
        with self.assertRaises(FileNotFoundError):
            package.inspect(self.root, require_notices=False, require_native=True)


if __name__ == '__main__':
    unittest.main()

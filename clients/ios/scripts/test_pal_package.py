import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('pal_package', Path(__file__).with_name('pal-package.py'))
PAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PAL)


class PalPackageTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'package.zip'
        self.icon = self.root / 'input-icon.png'
        self.icon.write_bytes(b'fixture icon')
        self.output = self.root / 'assets'
        self.commit = 'f' * 40
        self.date = '2026-11-26T00:00:00Z'
        self.manifest = {
            'appleItemId': int(PAL.APPLE_ID), 'bundleId': PAL.BUNDLE, 'shortVersionString': '1.0.8',
            'bundleVersion': '10', 'variants': [{'assetPath': 'variant/device.ipa'}], 'deltas': [],
        }

    def make_archive(self, extra=None):
        signed_manifest = json.dumps(self.manifest, indent=4).encode() + b'\n'
        with zipfile.ZipFile(self.archive, 'w') as package:
            package.writestr('adp/manifest.json', signed_manifest)
            package.writestr('adp/signature', b'signature fixture')
            package.writestr('adp/variant/device.ipa', b'variant fixture')
            if extra:
                package.writestr(extra, b'hostile')
        return signed_manifest

    def prepare(self):
        PAL.prepare('1.0.8', '10', self.commit, self.archive, self.output, self.icon, self.date)

    def test_uses_exact_manifest_bytes_and_verifies_the_public_package(self):
        manifest = self.make_archive()
        self.prepare()
        self.assertEqual((self.output / 'manifest.json').read_bytes(), manifest)

        def download(url, target, maximum):
            name = url.split('/')[-1]
            original = self.output / name
            target.write_bytes(original.read_bytes())
            return tuple(PAL.describe(original).values())

        with patch.object(PAL, 'download', download):
            PAL.verify_public('1.0.8', '10', self.commit, self.root / 'verified')
            with self.assertRaisesRegex(ValueError, 'another version, build or commit'):
                PAL.verify_public('1.0.8', '11', self.commit, self.root / 'wrong')

    def test_refuses_wrong_signed_version(self):
        self.manifest['bundleVersion'] = '11'
        self.make_archive()
        with self.assertRaisesRegex(ValueError, 'version or build'):
            self.prepare()

    def test_rejects_a_path_outside_the_package(self):
        self.make_archive('../outside')
        with self.assertRaisesRegex(ValueError, 'invalid package asset path'):
            self.prepare()

    def test_promotes_new_version_and_never_downgrades(self):
        self.make_archive()
        self.prepare()
        candidate = self.output / PAL.SOURCE_NAME
        current = self.root / 'production.json'
        previous = json.loads(candidate.read_bytes())
        previous['fediUsername'] = 'jstorrent'
        previous['apps'][0]['versions'][0]['version'] = '1.0.7'
        PAL.write_json(current, previous)
        PAL.promote_source(candidate, current)
        updated = json.loads(current.read_bytes())
        self.assertEqual(updated['fediUsername'], 'jstorrent')
        self.assertEqual([item['version'] for item in updated['apps'][0]['versions']], ['1.0.8', '1.0.7'])
        PAL.promote_source(candidate, current)
        PAL.write_json(candidate, previous)
        with self.assertRaisesRegex(ValueError, 'would go backwards'):
            PAL.promote_source(candidate, current)


if __name__ == '__main__':
    unittest.main()

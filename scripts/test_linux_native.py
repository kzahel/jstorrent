"""Regression checks for library-chain refusal and malformed ELF inputs."""
import hashlib
import importlib.util
import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import linux_native


def elf(dependency=None):
    names = (b'\0' + dependency.encode() + b'\0') if dependency else b'\0'
    payload = bytearray(240 + len(names))
    payload[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', payload, 18, 62)
    struct.pack_into('<Q', payload, 32, 64)
    struct.pack_into('<HH', payload, 54, 56, 2)
    struct.pack_into('<IIQQQQQQ', payload, 64, 1, 4, 0, 0, 0, len(payload), len(payload), 8)
    struct.pack_into('<IIQQQQQQ', payload, 120, 2, 4, 176, 176, 176, 64, 64, 8)
    tags = [(5, 240), (10, len(names)), (1, 1) if dependency else (0, 0), (0, 0)]
    for i, pair in enumerate(tags):
        struct.pack_into('<QQ', payload, 176 + i * 16, *pair)
    payload[240:] = names
    return payload


class NativeChainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lib = self.root / 'usr/lib/libconsumer.so.1'
        self.lib.parent.mkdir(parents=True)

    def test_known_library_and_consumer_are_refused_independently(self):
        for dependency in ['libjbig.so.0', 'libayatana-indicator3.so.7']:
            self.lib.write_bytes(elf(dependency))
            with self.assertRaisesRegex(ValueError, 'GPL-only native dependency'):
                linux_native.verify_known_gpl_absent(self.root)
            self.lib.write_bytes(elf())
            unused = self.lib.parent / dependency
            unused.write_bytes(elf())
            with self.assertRaisesRegex(ValueError, 'GPL-only native library bundled'):
                linux_native.verify_known_gpl_absent(self.root)
            unused.unlink()

    def test_lgpl_libraries_and_gpl_source_tool_notices_are_not_rejected(self):
        self.lib.write_bytes(elf('libgtk-3.so.0'))
        (self.root / 'copyright').write_text('GPL-3 tool sources; LGPL library alternatives')
        result = linux_native.verify_known_gpl_absent(self.root)
        self.assertEqual(result['selected_components'], 1)
        self.assertEqual(linux_native.needed(self.lib), ['libgtk-3.so.0'])

    def test_truncated_or_malformed_elf_is_refused(self):
        valid = elf('libgtk-3.so.0')
        mutations = [valid[:50], valid[:200]]
        for at, fmt, value in [(54, '<H', 55), (32, '<Q', 999999), (216, '<Q', 999999), (192, '<Q', 999999)]:
            changed = valid.copy()
            struct.pack_into(fmt, changed, at, value)
            mutations.append(changed)
        for payload in mutations:
            with self.subTest(size=len(payload)):
                self.lib.write_bytes(payload)
                with self.assertRaises(ValueError):
                    linux_native.needed(self.lib)

    def test_new_package_gate_requires_custom_build_provenance(self):
        spec = importlib.util.spec_from_file_location('inspect_distribution', Path(__file__).with_name('inspect-distribution.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaisesRegex(ValueError, 'lacks custom source-build provenance'):
            module.inspect(self.root, require_notices=False, require_mit_native=True)




class NativeDownloadTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('build_native', Path(__file__).with_name('build-linux-native.py'))
        self.builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.builder)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = b'reviewed source'
        self.item = {'name': 'source.tar.gz', 'url': 'https://example.test/source',
                     'bytes': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}

    def failure(self, status):
        return urllib.error.HTTPError(self.item['url'], status, 'failure', {}, None)

    def test_transient_http_failure_retries_then_verifies_and_caches(self):
        with patch.object(self.builder.urllib.request, 'urlopen',
                          side_effect=[self.failure(503), io.BytesIO(self.data)]) as request, \
                patch.object(self.builder.time, 'sleep') as sleep:
            path = self.builder.obtain(self.item, self.root, True)
            self.assertEqual(path.read_bytes(), self.data)
            self.builder.obtain(self.item, self.root, True)
            self.assertEqual(request.call_count, 2)
            sleep.assert_called_once_with(1)
        self.assertFalse(list(self.root.glob('*.partial')))

    def test_transient_failures_are_bounded_and_permanent_failures_not_retried(self):
        for status, attempts in [(503, 3), (404, 1)]:
            with self.subTest(status=status), \
                    patch.object(self.builder.urllib.request, 'urlopen', side_effect=self.failure(status)) as request, \
                    patch.object(self.builder.time, 'sleep'):
                with self.assertRaises(urllib.error.HTTPError):
                    self.builder.obtain(self.item, self.root, True)
                self.assertEqual(request.call_count, attempts)
                self.assertEqual(list(self.root.iterdir()), [])

    def test_bad_size_or_hash_is_never_cached_or_retried(self):
        for data in [b'short', b'x' * len(self.data), self.data + b'extra']:
            with self.subTest(data=data), \
                    patch.object(self.builder.urllib.request, 'urlopen', return_value=io.BytesIO(data)) as request:
                with self.assertRaises(ValueError):
                    self.builder.obtain(self.item, self.root, True)
                request.assert_called_once()
                self.assertEqual(list(self.root.iterdir()), [])

    def test_partial_transport_failure_is_deleted_before_retry(self):
        class BrokenStream(io.BytesIO):
            def read(self, size):
                if self.tell():
                    raise ConnectionResetError('disconnected')
                return super().read(size)
        with patch.object(self.builder.urllib.request, 'urlopen',
                          side_effect=[BrokenStream(b'partial'), io.BytesIO(self.data)]), \
                patch.object(self.builder.time, 'sleep'):
            self.assertEqual(self.builder.obtain(self.item, self.root, True).read_bytes(), self.data)
        self.assertFalse(list(self.root.glob('*.partial')))


if __name__ == '__main__':
    unittest.main()

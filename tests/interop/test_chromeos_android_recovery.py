"""Bounded inspection of owned retained-root evidence."""
import base64
import struct
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import Mock, patch
from chromeos_android_recovery import retained_roots, cancel_tree_picker


def registry(version=1, count=1):
    def string(value):
        encoded = value.encode()
        return struct.pack('>H', len(encoded)) + encoded
    data = struct.pack('>II', version, count)
    data += string('root_253') + string('Recovery') + string('content://owned/tree/test') + struct.pack('>q', 7)
    return '<map><string name="root-registry-v1">' + base64.urlsafe_b64encode(data).decode().rstrip('=') + '</string></map>'


class RetainedRootEvidence(unittest.TestCase):
    def test_reads_identity_and_generation_without_changing_registry(self):
        self.assertEqual(retained_roots(registry()), [{'root_id': 'root_253', 'label': 'Recovery',
            'uri': 'content://owned/tree/test', 'generation': 7}])

    def test_cancel_waits_for_picker_and_never_sends_back_into_product(self):
        product = ET.fromstring('<hierarchy><node package="org.rstorrent.qualification253"/></hierarchy>')
        picker = ET.fromstring('<hierarchy><node package="com.android.documentsui"/></hierarchy>')
        adb = Mock()
        with patch('chromeos_android_recovery.product.dump_ui', side_effect=[product, picker, picker, picker, product]), patch('chromeos_android_recovery.time.sleep'):
            cancel_tree_picker(adb)
        self.assertEqual(adb.shell.call_count, 2)
        adb.shell.assert_called_with('input', 'keyevent', '4')

    def test_refuses_unknown_version_or_unbounded_count(self):
        for version, count in [(2, 1), (1, 33), (1, 2**32-1)]:
            with self.subTest(version=version, count=count), self.assertRaises(ValueError):
                retained_roots(registry(version, count))


if __name__ == '__main__':
    unittest.main()

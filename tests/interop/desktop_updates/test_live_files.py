"""Exercise concurrent snapshot replacement with the actual OS file APIs."""
import os
from pathlib import Path
import tempfile
import unittest
from live_files import publish_text, read_text


class LiveFilesTest(unittest.TestCase):
    def test_complete_unicode_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.txt'
            self.assertTrue(publish_text(path, 'old'))
            self.assertTrue(publish_text(path, 'new \N{SNOWMAN}'))
            self.assertEqual(read_text(path), 'new \N{SNOWMAN}')

    @unittest.skipUnless(os.name == 'nt', 'Windows sharing contract')
    def test_ordinary_reader_collision_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.txt'
            publish_text(path, 'old')
            with path.open() as reader:
                self.assertFalse(publish_text(path, 'new'))
                self.assertEqual(reader.read(), 'old')
            self.assertTrue(publish_text(path, 'new'))
            self.assertEqual(read_text(path), 'new')


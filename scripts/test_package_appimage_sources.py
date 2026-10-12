"""Adversarial source-carrier checks, independent of production input archives."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("package_appimage_sources", Path(__file__).with_name("package-appimage-sources.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceCarrierTests(unittest.TestCase):
    def test_candidate_version_is_bound_to_committed_source(self):
        candidate = {"sourceSha": "a" * 40, "version": "0.3.1"}
        self.assertEqual(module.candidate_version(
            candidate, "a" * 40, '{"version":"0.3.1"}'), "0.3.1")
        for source, version, tauri in [
            ("b" * 40, "0.3.1", "0.3.1"),
            ("a" * 40, "0.3.1", "0.3.0"),
            ("a" * 40, "../0.3.1", "../0.3.1"),
            ("a" * 40, "00.3.1", "00.3.1"),
        ]:
            with self.subTest(source=source, version=version, tauri=tauri):
                with self.assertRaises(ValueError):
                    module.candidate_version(
                        {"sourceSha": source, "version": version}, "a" * 40,
                        '{"version":"' + tauri + '"}')

    def carrier(self, directory, members, inventory):
        path = Path(directory) / "source.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, content in [*members, ("source/SHA256SUMS", inventory.encode())]:
                member = tarfile.TarInfo(name)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        return path

    def test_source_integrity_and_closed_membership(self):
        data = b"independently authored source input"
        checksum = hashlib.sha256(data).hexdigest() + "  input.c\n"
        with tempfile.TemporaryDirectory() as directory:
            path = self.carrier(directory, [("source/input.c", data)], checksum)
            self.assertEqual(module.verify_archive(path), 2)
            path = self.carrier(directory, [("source/input.c", data + b"changed")], checksum)
            with self.assertRaises(ValueError):
                module.verify_archive(path)
            path = self.carrier(directory, [("source/input.c", data), ("source/extra", b"unlisted")], checksum)
            with self.assertRaises(ValueError):
                module.verify_archive(path)

    def test_duplicate_members_and_checksums_are_refused(self):
        data = b"source"
        checksum = hashlib.sha256(data).hexdigest() + "  input.c\n"
        with tempfile.TemporaryDirectory() as directory:
            for members, inventory in [([("source/input.c", data)] * 2, checksum),
                                       ([("source/input.c", data)], checksum * 2)]:
                path = self.carrier(directory, members, inventory)
                with self.assertRaises(ValueError):
                    module.verify_archive(path)

    def test_unsafe_paths_are_refused(self):
        for path in ("/absolute", "../parent", "root/../parent", "root//duplicate", "root/line\nbreak"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.safe_name(path)

    def test_symlink_is_not_a_source_carrier_member(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.tar"
            with tarfile.open(path, "w") as archive:
                member = tarfile.TarInfo("source/link")
                member.type = tarfile.SYMTYPE
                member.linkname = "/private/input"
                archive.addfile(member)
            with self.assertRaises(ValueError):
                module.verify_archive(path)


if __name__ == "__main__":
    unittest.main()

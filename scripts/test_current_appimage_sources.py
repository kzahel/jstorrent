"""Admission checks for reused and newly pinned source inputs."""
import base64
import copy
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("current_sources", Path(__file__).with_name("package-current-appimage-sources.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CurrentSources(unittest.TestCase):
    def test_missing_extractor_fails_before_fetching_source_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            arguments = ["package-current-appimage-sources.py", "--source-sha", "a" * 40,
                         "--release-dir", temporary, "--cache", temporary,
                         "--output", str(Path(temporary) / "fresh.tar.gz")]
            with patch("sys.argv", arguments), patch.object(module.common.shutil, "which", return_value=None):
                with self.assertRaisesRegex(ValueError, "Install squashfs-tools"):
                    module.main()

    def test_new_or_changed_inputs_need_exact_distribution_integrity_and_preferred_sources(self):
        row = {"version": "1.0.0", "resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz", "integrity": "sha512-exact", "license": "MIT"}
        current = {"packages": {"node_modules/a": row}}
        self.assertEqual(module.required_web_inputs(current, copy.deepcopy(current), {}), [])
        with self.assertRaisesRegex(ValueError, "Missing reviewed"):
            module.required_web_inputs(current, {"packages": {}}, {})
        pin = {"distribution": row["resolved"], "integrity": row["integrity"], "license": "MIT", "preferred": {"sha256": "a" * 64}}
        self.assertEqual(module.required_web_inputs(current, {"packages": {}}, {"a@1.0.0": pin}), [("a@1.0.0", pin)])
        with self.assertRaisesRegex(ValueError, "Missing reviewed"):
            module.required_web_inputs(current, {"packages": {}}, {"a@1.0.0": {**pin, "integrity": "changed"}})

    def test_only_the_exact_reviewed_public_git_dependency_normalizes_ssh(self):
        left = {"version": "1.0.0", "resolved": "git+https://github.com/kzahel/mediabunny.git#exact"}
        right = {**left, "resolved": "git+ssh://git@github.com/kzahel/mediabunny.git#exact"}
        self.assertEqual(module.web_identity(left), module.web_identity(right))
        self.assertNotEqual(module.web_identity(left), module.web_identity({**right, "resolved": right["resolved"] + "other"}))

    def test_downloads_are_bounded_authenticated_and_failed_partials_are_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "source"
            with self.assertRaisesRegex(ValueError, "exact integrity"):
                module.fetched("https://source.test/archive", path, 10)
            with patch.object(module.urllib.request, "urlopen", return_value=io.BytesIO(b"too much data")):
                with self.assertRaisesRegex(ValueError, "Oversized"):
                    module.fetched("https://source.test/archive", path, 4, "a" * 64)
            self.assertFalse(path.exists())
            self.assertFalse(path.with_suffix(".partial").exists())
            with patch.object(module.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")) as download:
                with self.assertRaisesRegex(ValueError, "digest differs"):
                    module.fetched("https://source.test/archive", path, 10, "a" * 64)
                download.assert_called_once()
            self.assertFalse(path.exists())
            path.write_bytes(b"cache")
            integrity = "sha512-" + base64.b64encode(hashlib.sha512(b"cache").digest()).decode()
            module.fetched("https://source.test/archive", path, 10, integrity=integrity)
            path.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "changed"):
                module.fetched("https://source.test/archive", path, 10, integrity=integrity)

    def test_transient_download_restarts_from_empty_partial(self):
        class InterruptedDownload(io.BytesIO):
            def read(self, size):
                if self.tell():
                    raise ConnectionResetError("interrupted")
                return super().read(size)

        url = "https://source.test/archive"
        attempts = [HTTPError(url, 502, "Bad Gateway", {}, None),
                    InterruptedDownload(b"truncated"), io.BytesIO(b"verified")]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "source"
            with (patch.object(module.urllib.request, "urlopen", side_effect=attempts) as download,
                  patch.object(module.time, "sleep"), patch("builtins.print")):
                module.fetched(url, path, 20, hashlib.sha256(b"verified").hexdigest())
            self.assertEqual(download.call_count, 3)
            self.assertEqual(path.read_bytes(), b"verified")
            self.assertFalse(path.with_suffix(".partial").exists())

    def test_download_failures_report_input_and_bound_retries(self):
        url = "https://source.test/archive"
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "source"
            for status, expected_attempts in ((502, 3), (404, 1)):
                with self.subTest(status=status):
                    error = HTTPError(url, status, "Unavailable", {}, None)
                    with (patch.object(module.urllib.request, "urlopen", side_effect=error) as download,
                          patch.object(module.time, "sleep"), patch("builtins.print")):
                        with self.assertRaisesRegex(RuntimeError, f"{url}: HTTP Error {status}"):
                            module.fetched(url, path, 20, "a" * 64)
                    self.assertEqual(download.call_count, expected_attempts)
                    self.assertFalse(path.exists())
                    self.assertFalse(path.with_suffix(".partial").exists())

    def test_outer_runtime_allows_only_the_named_payload_digest_field(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image"
            original = bytes(range(128))
            normalized = bytearray(original)
            normalized[32:48] = b"\0" * 16
            prior = {"runtime": {"runtimeBytes": 128, "payloadDigestFieldOffset": 32, "normalizedRuntimeSha256": hashlib.sha256(normalized).hexdigest()}}
            path.write_bytes(original)
            module.runtime_binding(path, prior)
            changed = bytearray(original)
            changed[35] ^= 1
            path.write_bytes(changed)
            module.runtime_binding(path, prior)
            changed[50] ^= 1
            path.write_bytes(changed)
            with self.assertRaisesRegex(ValueError, "Outer runtime changed"):
                module.runtime_binding(path, prior)
            with self.assertRaisesRegex(ValueError, "runtime bound"):
                module.runtime_binding(path, {"runtime": {**prior["runtime"], "runtimeBytes": 4}})

    def test_new_runtime_needs_an_exact_source_and_binary_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image"
            old = bytearray(range(128))
            old[32:48] = b"\0" * 16
            prior = {"runtime": {"runtimeBytes": 128, "payloadDigestFieldOffset": 32,
                                 "normalizedRuntimeSha256": hashlib.sha256(old).hexdigest()}}
            new = bytearray(old)
            new[60] ^= 1
            digest = hashlib.sha256(new).hexdigest()
            reviewed = {
                "source": {"commit": "a" * 40},
                "upstreamBinary": {"bytes": 128, "sha256": digest},
                "binding": {"runtimeBytes": 128, "payloadDigestFieldOffset": 32,
                            "excludedBytes": 16, "normalizedRuntimeSha256": digest,
                            "sourceCommit": "a" * 40},
            }
            path.write_bytes(new)
            with self.assertRaisesRegex(ValueError, "Outer runtime changed"):
                module.runtime_binding(path, prior)
            self.assertEqual(module.runtime_binding(path, prior, reviewed), reviewed["binding"])
            new[35] ^= 1
            path.write_bytes(new)
            self.assertEqual(module.runtime_binding(path, prior, reviewed), reviewed["binding"])
            for key, value in (("sourceCommit", "b" * 40), ("excludedBytes", 32),
                               ("runtimeBytes", 127), ("normalizedRuntimeSha256", "b" * 64)):
                invalid = {**reviewed, "binding": {**reviewed["binding"], key: value}}
                with self.assertRaisesRegex(ValueError, "runtime source binding"):
                    module.runtime_binding(path, prior, invalid)
            new[61] ^= 1
            path.write_bytes(new)
            with self.assertRaisesRegex(ValueError, "Outer runtime changed"):
                module.runtime_binding(path, prior, reviewed)


if __name__ == "__main__":
    unittest.main()

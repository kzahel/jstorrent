"""Admission checks for reused and newly pinned source inputs."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("current_sources", Path(__file__).with_name("package-current-appimage-sources.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CurrentSources(unittest.TestCase):
    def test_missing_extractor_fails_before_fetching_source_inputs(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            arguments = ["package-current-appimage-sources.py", "--source-sha", "a" * 40,
                         "--release-dir", temporary, "--cache", temporary,
                         "--output", str(Path(temporary) / "fresh.tar.gz")]
            with patch("sys.argv", arguments), patch.object(module.common.shutil, "which", return_value=None):
                with self.assertRaisesRegex(ValueError, "Install 7-Zip"):
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
        import io
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "source"
            with self.assertRaisesRegex(ValueError, "exact integrity"):
                module.fetched("https://source.test/archive", path, 10)
            with patch.object(module.urllib.request, "urlopen", return_value=io.BytesIO(b"too much data")):
                with self.assertRaisesRegex(ValueError, "Oversized"):
                    module.fetched("https://source.test/archive", path, 4, "a" * 64)
            self.assertFalse(path.exists())
            self.assertFalse(path.with_suffix(".partial").exists())
            with patch.object(module.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")):
                with self.assertRaisesRegex(ValueError, "digest differs"):
                    module.fetched("https://source.test/archive", path, 10, "a" * 64)
            self.assertFalse(path.exists())
            path.write_bytes(b"cache")
            import base64
            integrity = "sha512-" + base64.b64encode(hashlib.sha512(b"cache").digest()).decode()
            module.fetched("https://source.test/archive", path, 10, integrity=integrity)
            path.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "changed"):
                module.fetched("https://source.test/archive", path, 10, integrity=integrity)

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


if __name__ == "__main__":
    unittest.main()

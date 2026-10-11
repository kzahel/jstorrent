"""Failure and privacy controls for the owned Android runtime wrapper."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("android_runtime_smoke", Path(__file__).with_name("android-runtime-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class RuntimeSmokeTests(unittest.TestCase):
    def test_report_allowlist_drops_identifiers_and_unknown_resource_fields(self):
        profile = {"profile": "product-file-selection", "force_recheck": "passed", "removal": "exact",
                   "preconfirm_content_upload": 0, "local_torrent_cancel": "joined_keep_payload",
                   "selection": {"skipped_files_absent": True}, "torrent_ids": ["PRIVATE_MARKER"],
                   "identity": {"serial": "PRIVATE_MARKER"},
                   "download_all_before_metadata": "confirmed",
                   "download_all_source_selection": "explicit_all_overrides_so",
                   "download_all_files": "hash_verified",
                   "download_all_storage_metrics": {"limit": 40, "owned_high_water": 4, "secret": "PRIVATE_MARKER"},
                   "storage_metrics": {"limit": 40, "owned_high_water": 3, "secret": "PRIVATE_MARKER"}}
        output = json.dumps(profile) + '\n' + json.dumps({"result": "pass", "cleanup": "ok", "results": 1})
        result = smoke.summarize(output)
        self.assertNotIn("PRIVATE_MARKER", json.dumps(result))
        self.assertEqual(result["storage_metrics"], {"limit": 40, "owned_high_water": 3})
        self.assertEqual(result["download_all_storage_metrics"], {"limit": 40, "owned_high_water": 4})
        profile["download_all_before_metadata"] = "missing"
        with self.assertRaisesRegex(smoke.SmokeFailure, "invalid_runtime_evidence"):
            smoke.summarize(json.dumps(profile) + '\n' + json.dumps({"result": "pass", "cleanup": "ok", "results": 1}))
        profile["download_all_before_metadata"] = "confirmed"
        profile["force_recheck"] = "failed"
        with self.assertRaisesRegex(smoke.SmokeFailure, "invalid_runtime_evidence"):
            smoke.summarize(json.dumps(profile) + '\n' + json.dumps({"result": "pass", "cleanup": "ok", "results": 1}))

    def test_missing_or_duplicate_cohort_does_not_pass(self):
        with self.assertRaisesRegex(smoke.SmokeFailure, "missing_runtime_evidence"):
            smoke.summarize('{"result":"pass","cleanup":"ok","results":1}')

    @unittest.skipUnless(os.name == "posix", "owned process groups require POSIX")
    def test_deadline_terminates_and_reaps_owned_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(smoke.SmokeFailure, "runtime_timeout"):
                smoke.run_owned([sys.executable, "-c", "import os,time; print(os.getpid(),flush=True); time.sleep(60)"],
                                dict(os.environ), root, timeout=0.3)
            pid = int((root / "runner.log").read_text().strip())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def test_output_limit_is_enforced_before_retaining_excess_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(smoke.SmokeFailure, "output_limit"):
                smoke.run_owned([sys.executable, "-c", "import sys; sys.stdout.write('x' * (5 * 1024 * 1024))"],
                                dict(os.environ), root)
            self.assertLessEqual((root / "runner.log").stat().st_size, smoke.MAX_OUTPUT_BYTES)

    def test_child_failure_cannot_produce_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(smoke.SmokeFailure, "runtime_failed"):
                smoke.run_owned([sys.executable, "-c", "raise SystemExit(3)"], dict(os.environ), Path(temporary))


if __name__ == "__main__":
    unittest.main()

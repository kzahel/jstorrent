#!/usr/bin/env python3
"""Adversarial and privacy checks for the Android generated format audit."""
import base64
import copy
import importlib.util
import json
import unittest

import legacy_android_inventory as inventory


class AndroidInventoryTest(unittest.TestCase):
    def setUp(self):
        self.cohort = inventory.bounded_json(inventory.FIXTURES)
        self.case = copy.deepcopy(self.cohort["cases"][0])

    def report(self):
        return inventory.audit(self.case["kv"], self.case["roots"]["roots"], self.case["preferences"])

    def test_committed_wal_nullable_values_and_source_preservation(self):
        reports = inventory.verify_cohort()
        self.assertEqual(len(reports), 13)
        self.assertEqual(sum(row["format_candidates"] for row in reports), 7)
        self.assertTrue(all(row["verified_pieces"] == 0 for row in reports))

    def test_fixtures_reproduce_from_independent_generator(self):
        path = inventory.FIXTURES.with_name("generate.py")
        spec = importlib.util.spec_from_file_location("android_fixture_generator", path)
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        self.assertEqual(generator.generate(), self.cohort)

    def test_stored_availability_never_proves_a_grant(self):
        revoked = self.cohort["cases"][2]
        self.assertTrue(revoked["roots"]["roots"][0]["last_stat_ok"])
        self.assertEqual(revoked["runtime_scenario"]["grant"], "revoked")
        self.assertEqual(inventory.audit(revoked["kv"], revoked["roots"]["roots"], revoked["preferences"])["roots_require_runtime_grant_check"], 1)

    def test_future_index_is_refused(self):
        self.case["kv"]["session:torrents"] = '{"version":3,"torrents":[]}'
        with self.assertRaisesRegex(ValueError, "unsupported session"):
            self.report()

    def test_private_fallback_is_distinguished_from_unknown_saf_root(self):
        self.case = copy.deepcopy(self.cohort["cases"][-1])
        self.assertEqual(self.report()["outcomes"][0]["disposition"], "private_storage_requires_handoff")

    def test_released_binary_reader_accepts_urlsafe_and_whitespace(self):
        value = bytes(range(256))
        encoded = base64.urlsafe_b64encode(value).decode()
        self.assertEqual(inventory.binary(json.dumps(encoded[:12] + "\n\t" + encoded[12:])), value)

    def test_root_bound_and_ambiguous_identity(self):
        root = self.case["roots"]["roots"][0]
        self.case["roots"]["roots"] = [root] * 2
        self.assertEqual(self.report()["format_candidates"], 0)
        self.case["roots"]["roots"] = [root] * 33
        with self.assertRaisesRegex(ValueError, "too many roots"):
            self.report()

    def test_vpn_and_unknown_privacy_preference_require_review(self):
        self.case["preferences"] = {"vpn_only_enabled": True}
        self.assertTrue(self.report()["requires_policy_review"])
        self.case["preferences"] = {"wifi_only_enabled": "true"}
        self.assertTrue(self.report()["requires_policy_review"])
        self.case["preferences"] = {"wifi_only_enabled": True}
        self.assertFalse(self.report()["requires_policy_review"])

    def test_mismatched_cached_info_is_rejected(self):
        self.case = copy.deepcopy(self.cohort["cases"][3])
        key = next(key for key in self.case["kv"] if key.endswith(":infodict"))
        self.case["kv"][key] = '"eA=="'
        self.assertEqual(self.report()["format_candidates"], 0)

    def test_output_has_no_source_identifiers_or_unrelated_preferences(self):
        self.case["kv"]["unrelated"] = "PRIVATE_SENTINEL"
        self.case["preferences"]["standalone_token"] = "PRIVATE_SENTINEL"
        rendered = json.dumps(self.report())
        for secret in ("PRIVATE_SENTINEL", "content://", "generated.bin", self.case["roots"]["roots"][0]["key"]):
            self.assertNotIn(secret, rendered)


if __name__ == "__main__":
    unittest.main()

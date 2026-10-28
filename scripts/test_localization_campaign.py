import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("localization_campaign", Path(__file__).with_name("localization-campaign.py"))
campaign = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(campaign)


class CampaignTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="jst campaign ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.data = campaign.read(campaign.ROOT / campaign.MANIFEST)
        self.manifest = self.root / campaign.MANIFEST
        self.write(self.manifest, self.data)
        for platform, relative in campaign.SOURCES.items():
            path = self.root / relative
            if platform == "android":
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('<resources><string name="a">A</string><plurals name="b"><item quantity="other">%1$d B</item></plurals><string name="brand" translatable="false">JSTorrent</string></resources>')
            else:
                self.write(path, {"a": {"defaultMessage": "A"} if platform == "web" else "A"})
        for relative in campaign.CONTEXT:
            self.write(self.root / relative, {})
        self.registry = {"supportedLocales": {key: ["en", "de", "fr"] for key in campaign.SOURCES},
                         "previewLocales": {key: [] for key in campaign.SOURCES}}
        self.write(self.root / "localization/locales.json", self.registry)
        self.write(self.root / "localization/android/locales.json", {"locales": {}})
        self.work = self.root / ".local/campaign"

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False))

    def plan(self):
        return campaign.make_plan(self.root, self.manifest, self.work, None)

    def test_exact_legacy_inventory_and_current_locale_plural_profiles(self):
        campaign.validate_manifest(self.data)
        campaign.locale_runtime_check(self.data)
        self.assertEqual(16, len(self.data["locales"]))
        legacy = self.root / "legacy"
        for qualifier in [row["legacyAndroidQualifier"] for row in self.data["locales"]] + ["de", "fr"]:
            path = legacy / f"android/app/src/main/res/values-{qualifier}/strings.xml"
            path.parent.mkdir(parents=True); path.write_text("<resources/>")
        self.assertIn("matched all 18", campaign.inventory_check(self.data, legacy))
        extra = legacy / "android/app/src/main/res/values-ar/strings.xml"
        extra.parent.mkdir(); extra.write_text("<resources/>")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            campaign.inventory_check(self.data, legacy)

    def test_profiles_reject_routing_changes_duplicate_tags_and_unsafe_paths(self):
        changes = [lambda d: d["workerSettings"].update(serviceTier="fast"),
                   lambda d: d["workerSettings"].update(model="another-model"),
                   lambda d: d["workerSettings"].update(concurrency=4),
                   lambda d: d["qualification"].update(publish=True),
                   lambda d: d["locales"].append(copy.deepcopy(d["locales"][0])),
                   lambda d: d["locales"][0].update(tag="../es"),
                   lambda d: d["locales"][0].update(androidQualifier="../../res"),
                   lambda d: d["locales"][0].update(androidQuantities=["one"])]
        for change in changes:
            data = copy.deepcopy(self.data); change(data)
            with self.subTest(change=change), self.assertRaises(ValueError):
                campaign.validate_manifest(data)
        with self.assertRaises(ValueError):
            campaign.contained(self.root, self.root.parent / "outside")

    def test_plan_contains_only_explicit_local_commands_and_excludes_nontranslatable_resources(self):
        with patch.object(campaign, "locale_runtime_check"), patch.object(campaign.subprocess, "Popen", side_effect=AssertionError("must not launch workers")):
            plan = self.plan()
        self.assertEqual({"web": 1, "desktop": 1, "android": 2}, plan["sourceCounts"])
        self.assertEqual(64, plan["resourceCount"])
        for locale in plan["locales"]:
            self.assertEqual(3, len(locale["jobs"]))
            for job in locale["jobs"]:
                command = job["run"]
                self.assertEqual(["python3", "scripts/localization-codex.py", "run"], command[:3])
                for flag, value in [("--model", "gpt-6.1-sol"), ("--effort", "high"),
                                    ("--service-tier", "normal"), ("--permission-mode", "bypassPermissions"),
                                    ("--concurrency", "3"), ("--jobs-per-worker", "3")]:
                    self.assertEqual(value, command[command.index(flag) + 1])

    def test_source_context_settings_and_command_tampering_invalidate_plan(self):
        plan = self.plan()
        campaign.verify_plan(self.root, plan, self.manifest, self.work)
        for relative in [*campaign.SOURCES.values(), *campaign.CONTEXT]:
            path = self.root / relative
            before = path.read_bytes(); path.write_bytes(before + b"\n")
            with self.subTest(input=relative), self.assertRaisesRegex(ValueError, "changed"):
                campaign.verify_plan(self.root, plan, self.manifest, self.work)
            path.write_bytes(before)
        for mutate in [lambda p: p["workerSettings"].update(effort="low"),
                       lambda p: p["locales"][0]["jobs"][0]["run"].append("--fast"),
                       lambda p: p["frozenInputs"].clear(),
                       lambda p: p.update(resourceCount=0)]:
            damaged = copy.deepcopy(plan); mutate(damaged)
            with self.assertRaisesRegex(ValueError, "changed"):
                campaign.verify_plan(self.root, damaged, self.manifest, self.work)

    def test_declaring_shipping_or_preview_never_substitutes_for_review_or_qualification(self):
        self.registry["supportedLocales"]["web"].append("es")
        self.registry["previewLocales"]["desktop"].append("es")
        self.write(self.root / "localization/locales.json", self.registry)
        with patch.object(campaign.subprocess, "run", side_effect=AssertionError("missing catalogs need no subprocess")):
            row = campaign.status(self.root, self.data)[0]
        self.assertFalse(row["terminologyReady"])
        self.assertTrue(row["platforms"]["web"]["releaseRegistered"])
        self.assertTrue(row["platforms"]["desktop"]["previewRegistered"])
        self.assertTrue(all(not value["reviewComplete"] for value in row["platforms"].values()))
        self.assertIn("not inferred", row["qualification"])

    def test_duplicate_json_and_symlink_escape_are_rejected(self):
        path = self.root / "duplicate.json"; path.write_text('{"locale":"es","locale":"fr"}')
        with self.assertRaisesRegex(ValueError, "duplicate"):
            campaign.read(path)
        if hasattr(Path, "symlink_to"):
            link = self.root / "escape"
            try: link.symlink_to(self.root.parent, target_is_directory=True)
            except OSError: self.skipTest("symlink creation unavailable")
            with self.assertRaises(ValueError): campaign.contained(self.root, link / "outside")


if __name__ == "__main__":
    unittest.main()

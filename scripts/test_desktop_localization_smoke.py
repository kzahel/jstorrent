#!/usr/bin/env python3
"""Registry-driven QA configuration; no actual French catalog or native run."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("desktop_locale_smoke", Path(__file__).with_name("desktop-locale-smoke.py"))
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


class LocaleSmokeConfigurationTests(unittest.TestCase):
    def fixture(self, root):
        (root / "localization").mkdir()
        (root / "web").mkdir()
        (root / "native").mkdir()
        manifest = {"sourceLocale": "en", "fallbackLocale": "en", "supportedLocales": {"web": ["en"], "desktop": ["en"]}, "previewLocales": {"web": ["fr"], "desktop": ["fr"]}, "catalogs": {"web": "web/en.json", "desktop": "native/en.json"}}
        (root / "localization/locales.json").write_text(json.dumps(manifest))
        for tag, settings, language in [("en", "Settings", "Language"), ("fr", "Paramètres", "Langue")]:
            (root / f"web/{tag}.json").write_text(json.dumps({"inspection.components.app.settings": {"defaultMessage": settings}, "localization.language.title": {"defaultMessage": language}}))
            (root / f"native/{tag}.json").write_text(json.dumps({"show": settings}))
        return manifest

    def test_synthetic_french_reads_manifest_catalog_paths_and_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            value = smoke.catalog_configuration(root, "fr")
            self.assertEqual(value["locale"], "fr")
            self.assertEqual(value["fallback"], "en")
            self.assertEqual(value["availableLocales"], ["en", "fr"])
            self.assertEqual(value["text"]["target"]["language"], "Langue")

    def test_undeclared_or_native_unavailable_target_fails_before_cargo(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.fixture(root)
            manifest["previewLocales"]["desktop"] = []
            (root / "localization/locales.json").write_text(json.dumps(manifest))
            with patch.object(smoke, "ROOT", root), patch.object(smoke, "cargo") as cargo:
                with self.assertRaisesRegex(smoke.Failure, "not registered for desktop"):
                    smoke.run(SimpleNamespace(locale="fr"))
                cargo.assert_not_called()
            manifest["previewLocales"]["desktop"] = ["fr"]
            (root / "localization/locales.json").write_text(json.dumps(manifest))
            (root / "native/fr.json").unlink()
            with self.assertRaisesRegex(smoke.Failure, "Missing or oversized"):
                smoke.catalog_configuration(root, "fr")

    def test_incomplete_target_catalog_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / "web/fr.json").write_text("{}")
            with self.assertRaisesRegex(smoke.Failure, "incomplete"):
                smoke.catalog_configuration(root, "fr")

    def test_oversized_target_is_rejected_before_reading_inputs(self):
        with self.assertRaisesRegex(smoke.Failure, "Invalid target locale tag"):
            smoke.catalog_configuration(Path("/nonexistent-locale-fixture"), "f" * 65)


if __name__ == "__main__":
    unittest.main()

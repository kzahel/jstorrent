import argparse
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("translation_runner", Path(__file__).with_name("localization-ya.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class FakeApi:
    def __init__(self):
        self.payloads = []
        self.sessions = {}
        self.aborted = []

    def request(self, path, body=None):
        if path == "/agent-auth-router/selection":
            return {"pools": [{"id": "pool-id", "name": "Test pool", "provider": "claude", "accountIds": ["account"]}],
                    "accounts": [{"id": "account", "enabled": True, "models": [{"id": "claude-opus-5-5"}],
                                  "cliModels": [{"id": "opus", "resolvedModel": "claude-opus-5-5[1m]"}]}]}
        if path.endswith("/sessions"):
            self.payloads.append(body)
            identifier = str(len(self.payloads))
            tasks = json.loads(body["message"].rsplit("Tasks:\n", 1)[1])
            for task in tasks:
                job = runner.read_json(Path(task["job"]))
                resources = {key: {"sourceHash": row["sourceHash"], "terminologyHash": row["terminologyHash"],
                                   "kind": row["kind"], "translation": "Übersetzung"} for key, row in job["resources"].items()}
                runner.save(Path(task["output"]), {"schemaVersion": 1, "platform": "web", "locale": "de", "resources": resources})
            self.sessions[identifier] = {"polls": 0, "payload": body}
            return {"sessionId": identifier, "processId": identifier}
        if path.endswith("/metadata"):
            identifier = path.split("/")[-2]
            record = self.sessions[identifier]
            record["polls"] += 1
            return {"processState": "in-turn" if record["polls"] == 1 else "idle",
                    "session": {"model": record["payload"]["model"], "effectiveLaunchSettings": {
                        "requestedModel": record["payload"]["model"], "effort": "high", "permissionMode": "bypassPermissions"}}}
        if path.endswith("/abort"):
            self.aborted.append(path.split("/")[-2])
            return {"aborted": True}
        raise AssertionError(path)


class TranslationRunnerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.jobs = self.root / "jobs"
        self.jobs.mkdir()
        for number in (1, 2):
            runner.save(self.jobs / f"web-de-{number}.json", {"schemaVersion": 1, "platform": "web", "locale": "de", "resources": {
                f"message-{number}": {"sourceHash": f"source-{number}", "terminologyHash": "terms", "kind": "icu", "source": "Original"}}})
        self.work = self.root / ".local/run"
        self.api = FakeApi()
        self.args = argparse.Namespace(command="run", work_dir=self.work, endpoint="http://localhost:3400", pool="Test pool",
            model="opus", platform="web", locale="de", policy="weekly-pace", effort="high", permission_mode="bypassPermissions",
            jobs_per_worker=1, jobs=self.jobs, concurrency=2, poll_seconds=0.1, timeout_seconds=30, import_reviewed=True)
        self.imports = []

    def validate(self, platform, locale, job, response):
        request, result = runner.read_json(Path(job["path"])), runner.read_json(response)
        self.assertEqual(set(request["resources"]), set(result["resources"]))
        for key, value in request["resources"].items():
            self.assertEqual(value["sourceHash"], result["resources"][key]["sourceHash"])

    def import_command(self, argv, **_kwargs):
        self.assertEqual(argv[2], "import")
        self.assertIn("--idempotent", argv)
        translator = argv[argv.index("--translator") + 1]
        reviewer = argv[argv.index("--reviewer") + 1]
        self.assertNotEqual(translator, reviewer)
        self.imports.append((translator, reviewer))

    def execute(self):
        with patch.object(runner, "ROOT", self.root), patch.object(runner, "Api", return_value=self.api), \
             patch.object(runner, "validate", side_effect=self.validate), patch.object(runner, "validate_jobs"), \
             patch.object(runner.subprocess, "run", side_effect=self.import_command), patch.object(runner.time, "sleep"):
            runner.run(self.args)

    def test_concurrent_translation_review_import_and_resume(self):
        self.execute()
        self.assertEqual(4, len(self.api.payloads))
        self.assertEqual(2, len(self.imports))
        self.assertEqual(4, len(self.api.aborted))
        for payload in self.api.payloads:
            self.assertEqual("claude-opus-5-5", payload["model"])
            self.assertEqual("on:high", payload["thinking"])
            self.assertEqual("weekly-pace", payload["routerPolicy"])
            self.assertEqual("bypassPermissions", payload["mode"])
        self.execute()
        self.assertEqual(4, len(self.api.payloads), "completed resume must not start or bill new workers")
        self.assertEqual(4, len(self.imports), "resume must recheck both catalog/provenance pairs idempotently")
        state = runner.read_json(self.work / "state.json")
        self.assertEqual(2, len(state["imported"]), "verified repeat jobs must not duplicate import records")

    def test_resume_rechecks_imported_catalog_and_propagates_manual_edit_failure(self):
        self.execute()
        target = self.root / "catalog.json"
        runner.save(target, {"message": "Maintainer's manual correction"})
        before = target.read_bytes()
        def reject_changed_target(argv, **_kwargs):
            self.assertEqual("import", argv[2])
            self.assertIn("--idempotent", argv)
            raise runner.subprocess.CalledProcessError(1, argv, stderr="translation changed since export")
        with patch.object(self, "import_command", side_effect=reject_changed_target) as importer:
            with self.assertRaises(runner.subprocess.CalledProcessError):
                self.execute()
            importer.assert_called_once()
        self.assertEqual(before, target.read_bytes(), "resume must preserve the manually corrected catalog")
        self.assertEqual(4, len(self.api.payloads), "catalog conflicts must not launch replacement workers")
        self.assertEqual(2, len(runner.read_json(self.work / "state.json")["imported"]))

    def test_changed_export_or_partition_rejects_resume(self):
        self.execute()
        self.args.jobs_per_worker = 2
        with self.assertRaisesRegex(ValueError, "resume settings"):
            self.execute()
        self.args.jobs_per_worker = 1
        p = next(self.jobs.glob("*.json"))
        data = runner.read_json(p)
        next(iter(data["resources"].values()))["sourceHash"] = "new source"
        runner.save(p, data)
        with self.assertRaisesRegex(ValueError, "source jobs changed"):
            self.execute()
        self.assertEqual(4, len(self.api.payloads))

    def test_changed_review_file_cannot_be_imported_on_resume(self):
        self.args.import_reviewed = False
        self.execute()
        p = next((self.work / "review").glob("*.json"))
        data = runner.read_json(p)
        next(iter(data["resources"].values()))["translation"] = "Unreviewed manual change"
        runner.save(p, data)
        self.args.import_reviewed = True
        with self.assertRaisesRegex(ValueError, "reviewed output changed"):
            self.execute()
        self.assertEqual([], self.imports)

    def test_failed_candidate_validation_cancels_owned_jobs(self):
        with patch.object(runner, "ROOT", self.root), patch.object(runner, "Api", return_value=self.api), \
             patch.object(runner, "validate_jobs"), patch.object(runner, "validate", side_effect=ValueError("bad placeholders")), \
             patch.object(runner.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "bad placeholders"):
                runner.run(self.args)
        state = runner.read_json(self.work / "state.json")
        self.assertTrue(all(w["status"] == "cancelled" for w in state["workers"]))
        self.assertEqual(2, len(self.api.aborted))
        self.assertEqual([], self.imports)

    def test_retried_worker_cannot_claim_an_earlier_output(self):
        job = runner.snapshot_jobs(self.jobs, "web", "de")[0]
        output = self.work / "translate" / Path(job["path"]).name
        runner.save(output, {"old": "cancelled session output"})
        class NoOutputApi:
            def request(self, _path, _body):
                self.asserted_absent = not output.exists()
                return {"sessionId": "new-session", "processId": "new-process"}
        api = NoOutputApi()
        settings = {"platform": "web", "locale": "de", "policy": "weekly-pace",
                    "model": "claude-opus-5-5", "effort": "high", "permissionMode": "bypassPermissions"}
        runner.launch_worker(api, settings, "pool", "translate", [job], self.work, 0)
        self.assertTrue(api.asserted_absent)
        self.assertFalse(output.exists())

    def test_changed_completed_candidate_prevents_review_launch(self):
        finish = runner.finish_worker
        def mutate_after_completion(api, worker, settings):
            finish(api, worker, settings)
            if worker["phase"] == "translate":
                path = Path(worker["outputs"][0])
                value = runner.read_json(path)
                next(iter(value["resources"].values()))["translation"] = "Unattributed candidate edit"
                runner.save(path, value)
        with patch.object(runner, "finish_worker", side_effect=mutate_after_completion):
            with self.assertRaisesRegex(ValueError, "completed translation output changed"):
                self.execute()
        self.assertEqual(2, len(self.api.payloads), "no independent review may start from an altered candidate")
        self.assertEqual([], self.imports)

    def test_candidate_snapshot_precedes_session_launch(self):
        job = runner.snapshot_jobs(self.jobs, "web", "de")[0]
        candidate = self.work / "translate" / Path(job["path"]).name
        runner.save(candidate, {"translation": "Before session"})
        expected = runner.fingerprint(candidate)
        class MutatingApi:
            def request(self, _path, _body):
                runner.save(candidate, {"translation": "Changed while launching"})
                return {"sessionId": "review-session", "processId": "review-process"}
        settings = {"platform": "web", "locale": "de", "policy": "weekly-pace",
                    "model": "claude-opus-5-5", "effort": "high", "permissionMode": "bypassPermissions"}
        worker = runner.launch_worker(MutatingApi(), settings, "pool", "review", [job], self.work, 0, [candidate])
        self.assertEqual(expected, worker["candidates"][str(candidate)])
        self.assertNotEqual(runner.fingerprint(candidate), worker["candidates"][str(candidate)])

    def test_unconfirmed_abort_remains_owned_and_is_stopped_on_resume(self):
        request = self.api.request
        def fail_abort(path, body=None):
            if path.endswith("/abort"):
                raise OSError("temporary local API outage")
            return request(path, body)
        with patch.object(self.api, "request", side_effect=fail_abort), \
             patch.object(runner, "ROOT", self.root), patch.object(runner, "Api", return_value=self.api), \
             patch.object(runner, "validate_jobs"), patch.object(runner, "validate", side_effect=ValueError("bad response")), \
             patch.object(runner.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "bad response"):
                runner.run(self.args)
        state = runner.read_json(self.work / "state.json")
        self.assertTrue(all(w["status"] == "running" and w["abortPending"] for w in state["workers"]))
        self.execute()
        resumed = runner.read_json(self.work / "state.json")
        self.assertTrue(all(w["status"] == "cancelled" for w in resumed["workers"][:2]))
        self.assertTrue(all(w["status"] == "complete" for w in resumed["workers"][2:]))
        self.assertEqual(2, len(self.imports))

    def test_cancel_uses_recorded_endpoint_for_owned_process_ids(self):
        runner.save(self.work / "state.json", {
            "schemaVersion": 1, "settings": {"endpoint": "http://localhost:3500"},
            "workers": [{"status": "running", "processId": "owned-process"}], "imported": []})
        self.args.command = "cancel"
        with patch.object(runner, "ROOT", self.root), patch.object(runner, "Api", return_value=self.api) as api:
            runner.run(self.args)
        self.assertEqual("http://localhost:3500", api.call_args.args[0])
        self.assertEqual(["owned-process"], self.api.aborted)

    def test_changed_live_source_prevents_launch(self):
        with patch.object(runner, "ROOT", self.root), patch.object(runner, "Api", return_value=self.api), \
             patch.object(runner, "validate_jobs", side_effect=ValueError("stale current source")):
            with self.assertRaisesRegex(ValueError, "stale current source"):
                runner.run(self.args)
        self.assertEqual([], self.api.payloads)

    def test_alias_must_resolve_to_catalog_id_without_account_substitution(self):
        selection = self.api.request("/agent-auth-router/selection")
        self.assertEqual(("pool-id", "claude-opus-5-5"), runner.resolve_route(selection, "test POOL", "opus"))
        with self.assertRaisesRegex(ValueError, "unambiguous"):
            runner.resolve_route(selection, "Test pool", "unknown")
        selection["accounts"].append({"id": "other", "enabled": True, "models": [{"id": "different"}],
            "cliModels": [{"id": "opus", "resolvedModel": "different"}]})
        selection["pools"][0]["accountIds"].append("other")
        with self.assertRaisesRegex(ValueError, "unambiguous"):
            runner.resolve_route(selection, "Test pool", "opus")

    def test_optional_router_evidence_rejects_mismatches(self):
        worker = {"requestedPoolId": "pool-id"}
        settings = {"policy": "weekly-pace", "pool": "Test pool"}
        runner.check_router_evidence(worker, settings, {})
        good = {"provider": "claude", "policy": "weekly-pace", "poolId": "pool-id", "poolName": "test POOL"}
        runner.check_router_evidence(worker, settings, {"routerBinding": good})
        for key, value in (("provider", "codex"), ("policy", "round-robin"), ("poolId", "other-pool"), ("poolName", "Other pool")):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "router.*evidence differs"):
                runner.check_router_evidence(worker, settings, {"routerBinding": {**good, key: value}})

    def test_duplicate_json_and_mutated_snapshot_are_rejected(self):
        p = self.jobs / "duplicate.json"
        p.write_text('{"resources":{},"resources":{}}')
        with self.assertRaisesRegex(ValueError, "duplicate JSON"):
            runner.read_json(p)
        p.unlink()
        snapshot = runner.snapshot_jobs(self.jobs, "web", "de")
        p = Path(snapshot[0]["path"])
        data = runner.read_json(p)
        next(iter(data["resources"].values()))["sourceHash"] = "new source"
        runner.save(p, data)
        with self.assertRaisesRegex(ValueError, "exported job changed"):
            runner.check_snapshot(snapshot)

    def test_overlapping_job_resource_ids_rejected_before_launch(self):
        first = runner.read_json(self.jobs / "web-de-1.json")
        runner.save(self.jobs / "web-de-2.json", first)
        with self.assertRaisesRegex(ValueError, "overlapping resource IDs"):
            self.execute()
        self.assertEqual([], self.api.payloads)


class TerminologyApi(FakeApi):
    def __init__(self, snapshot):
        super().__init__()
        self.snapshot = snapshot
        self.approved = True
        self.corrections = {}
        self.bad_count = False

    def request(self, path, body=None):
        if not path.endswith("/sessions"):
            return super().request(path, body)
        self.payloads.append(body)
        identifier = str(len(self.payloads))
        output = Path(re.search(r"Write ONLY (.+), creating its parent", body["message"]).group(1))
        data = runner.read_json(self.snapshot)
        runner.save(output, {"schemaVersion": 1, "platform": "android", "locale": "de",
                            "snapshotHash": runner.fingerprint(self.snapshot),
                            "reviewedCount": len(data["resources"]) + int(self.bad_count),
                            "approved": self.approved, "corrections": self.corrections, "notes": []})
        self.sessions[identifier] = {"polls": 0, "payload": body}
        return {"sessionId": identifier, "processId": identifier}


class TerminologyLifecycleTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.snapshot = self.root / "snapshot.json"
        runner.save(self.snapshot, {"schemaVersion": 1, "platform": "android", "locale": "de", "resources": {
            "remove": {"source": "Remove", "existingTranslation": "Entfernen", "sourceHash": "source", "terminologyHash": "terms"},
            "archive": {"source": "Archive", "existingTranslation": "Archivieren", "sourceHash": "source2", "terminologyHash": "terms"}}})
        self.api = TerminologyApi(self.snapshot)
        self.work = self.root / ".local/terms"
        self.args = argparse.Namespace(command="terms-review", work_dir=self.work, endpoint="http://localhost:3400",
            pool="Test pool", model="opus", platform="android", locale="de", policy="weekly-pace", effort="high",
            permission_mode="bypassPermissions", snapshot=self.snapshot, timeout_seconds=30, poll_seconds=0.1,
            adopt_terminology=True)

    def execute(self):
        with patch.object(runner, "ROOT", self.root), patch.object(runner, "Api", return_value=self.api), \
             patch.object(runner.time, "sleep"), patch.object(runner.subprocess, "run") as adopt:
            self.adoption = adopt
            runner.run(self.args)
        return adopt

    def test_approval_only_adopts_complete_snapshot_and_resume_does_not_relaunch(self):
        adopt = self.execute()
        adopt.assert_called_once()
        command = adopt.call_args.args[0]
        self.assertIn("adopt-terminology", command)
        self.assertEqual(str(self.snapshot.resolve()), command[command.index("--snapshot") + 1])
        self.assertEqual("claude-opus-5-5/1", command[command.index("--reviewer") + 1])
        state = runner.read_json(self.work / "state.json")
        self.assertEqual("complete", state["workers"][0]["status"])
        self.assertEqual(["1"], self.api.aborted)
        self.execute()
        self.assertEqual(1, len(self.api.payloads))

    def test_corrections_or_unresolved_approval_stop_adoption(self):
        for approved, corrections in ((True, {"remove": "Korrigieren"}), (False, {})):
            with self.subTest(approved=approved):
                self.api.approved, self.api.corrections = approved, corrections
                with self.assertRaisesRegex(ValueError, "resolve.*corrections"):
                    self.execute()
                self.adoption.assert_not_called()
                # Each case gets an independent state/output directory.
                self.work = self.work.with_name(self.work.name + "-next")
                self.args.work_dir = self.work

    def test_changed_snapshot_and_review_report_prevent_adoption(self):
        self.args.adopt_terminology = False
        self.execute()
        report_path = self.work / "terminology" / self.snapshot.name
        report = runner.read_json(report_path)
        report["approved"] = False
        runner.save(report_path, report)
        self.args.adopt_terminology = True
        with self.assertRaisesRegex(ValueError, "report changed"):
            self.execute()
        self.adoption.assert_not_called()
        value = runner.read_json(self.snapshot)
        value["resources"]["remove"]["existingTranslation"] = "Changed source snapshot"
        runner.save(self.snapshot, value)
        with self.assertRaisesRegex(ValueError, "snapshot/settings changed"):
            self.execute()
        self.adoption.assert_not_called()
        self.assertEqual(1, len(self.api.payloads))

    def test_bad_report_cancels_worker_and_does_not_adopt(self):
        self.api.bad_count = True
        with self.assertRaisesRegex(ValueError, "bind the complete current snapshot"):
            self.execute()
        self.adoption.assert_not_called()
        state = runner.read_json(self.work / "state.json")
        self.assertEqual("cancelled", state["workers"][0]["status"])
        self.assertEqual(["1"], self.api.aborted)

    def test_snapshot_changed_during_final_observation_cannot_be_adopted(self):
        request = self.api.request
        def change_when_idle(path, body=None):
            result = request(path, body)
            if path.endswith("/metadata") and result["processState"] == "idle":
                value = runner.read_json(self.snapshot)
                value["resources"]["remove"]["existingTranslation"] = "Unreviewed change"
                runner.save(self.snapshot, value)
            return result
        with patch.object(self.api, "request", side_effect=change_when_idle):
            with self.assertRaisesRegex(ValueError, "exported job changed"):
                self.execute()
        self.adoption.assert_not_called()
        self.assertEqual(["1"], self.api.aborted)


if __name__ == "__main__":
    unittest.main()

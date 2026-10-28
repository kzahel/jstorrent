#!/usr/bin/env python3
"""Run resumable, independently reviewed translation jobs through local YA."""

from __future__ import annotations

import argparse
import hashlib
import json
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAX_JSON = 16 * 1024 * 1024


def read_json(path):
    if path.stat().st_size > MAX_JSON:
        raise ValueError(f"JSON exceeds {MAX_JSON} bytes: {path}")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def fingerprint(path):
    return hashlib.sha256(json.dumps(read_json(path), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


class Api:
    def __init__(self, endpoint, timeout=20):
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout

    def request(self, path, body=None):
        request = urllib.request.Request(
            self.endpoint + "/api" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-Yep-Anywhere": "true"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = response.read(MAX_JSON + 1)
                if len(data) > MAX_JSON:
                    raise ValueError("YA response exceeds bounded JSON size")
                return json.loads(data)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"YA HTTP {error.code}: {error.read(2048).decode(errors='replace')}") from error


def resolve_route(selection, pool_name, requested_model):
    pools = [p for p in selection.get("pools", []) if p.get("name", "").casefold() == pool_name.casefold()]
    if len(pools) != 1:
        raise ValueError("YA pool name must resolve to exactly one pool")
    pool = pools[0]
    if pool.get("provider") != "claude":
        raise ValueError("this translation runner currently supports the Claude provider")
    members = [a for a in selection.get("accounts", []) if a["id"] in pool["accountIds"] and a.get("enabled")]
    concrete = {m["id"] for a in members for m in a.get("models", [])}
    if requested_model in concrete:
        return pool["id"], requested_model
    targets = {
        m["resolvedModel"].removesuffix("[1m]")
        for a in members for m in a.get("cliModels", [])
        if m.get("id") == requested_model and m.get("resolvedModel")
    }
    if len(targets) != 1 or next(iter(targets)) not in concrete:
        raise ValueError("model alias has no unambiguous concrete pool catalog target")
    return pool["id"], next(iter(targets))


def snapshot_jobs(directory, platform, locale):
    jobs = []
    seen = set()
    for path in sorted(directory.glob("*.json")):
        data = read_json(path)
        if data.get("platform") != platform or data.get("locale") != locale or data.get("schemaVersion") != 1:
            raise ValueError(f"job does not match requested platform/locale: {path}")
        snapshot_guidance(data, locale)
        resources = data.get("resources")
        if not isinstance(resources, dict) or not 1 <= len(resources) <= 100:
            raise ValueError(f"job must contain 1–100 messages: {path}")
        if seen.intersection(resources):
            raise ValueError("exported jobs contain overlapping resource IDs")
        seen.update(resources)
        jobs.append({"path": str(path.resolve()), "hash": fingerprint(path), "count": len(resources)})
    if not jobs or len(jobs) > 1000:
        raise ValueError("expected 1–1000 exported job files")
    return jobs


def snapshot_guidance(data, locale):
    """Use the register bound to the exported job, never a language default."""
    terms = data.get("terminology")
    if not isinstance(terms, dict) or terms.get("schemaVersion") != 1 or terms.get("locale") != locale:
        raise ValueError("job needs terminology for its target locale; configure guidance and re-export")
    register = terms.get("register")
    if not isinstance(register, str) or not register.strip() or len(register) > 8192:
        raise ValueError("job needs nonempty locale-specific register guidance (maximum 8192 characters)")
    return register


def check_snapshot(jobs):
    for job in jobs:
        if fingerprint(Path(job["path"])) != job["hash"]:
            raise ValueError(f"exported job changed; use a new work directory: {job['path']}")


def validate(platform, locale, job, response):
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/localization.py"), "validate-response", platform, locale,
         "--job", job["path"], "--response", str(response)],
        cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )


def validate_jobs(platform, locale, jobs):
    for job in jobs:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/localization.py"), "validate-job", platform, locale,
             "--job", job["path"]],
            cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )


def worker_prompt(phase, platform, locale, jobs, outputs, candidates):
    guidance = {snapshot_guidance(read_json(Path(job["path"])), locale) for job in jobs}
    if len(guidance) != 1:
        raise ValueError("translation batches have inconsistent locale register guidance; re-export together")
    register = next(iter(guidance))
    paths = [{"job": j["path"], "output": str(o)} for j, o in zip(jobs, outputs)]
    if phase == "review":
        for entry, candidate in zip(paths, candidates):
            entry["candidate"] = str(candidate)
    return f"""Complete the authorized {locale} {platform} localization {phase} job.
Only write the exact output files below and create their parent directories.
Do not edit product source, catalogs, metadata, tooling or documentation. Do not
commit, create branches/worktrees, inspect devices, run builds, launch subagents,
send messages or run import. Work autonomously to completed files, then give a
brief final summary; do not ask for permission or leave a proposed plan.

Read every exported resource, context, terminology and suggestions. Suggestions
are reference only; confirm actual meaning and grammar. Target locale: {locale}.
Follow this locale's register and wording guidance from the exported snapshot:
{register}
Preserve destructive/privacy consequences and the difference between removing a
torrent and deleting its data. Use shared terminology naturally with grammatical
inflection. Never copy strings from another project.

Write raw JSON text, not XML/Android-escaped strings. Each response is exactly:
{{"schemaVersion":1,"platform":"{platform}","locale":"{locale}","resources":{{ID:
{{"sourceHash":COPY,"terminologyHash":COPY,"kind":COPY,"translation":TEXT}}}}}}.
Return every requested resource and no extra IDs; copy hashes and kind exactly.
TEXT is a raw string; Android plurals instead use an object with every required
quantity key and its raw translated string.
For Android plurals, include the count formatting argument in any category that
can match multiple numbers in the target language, even if the English branch
omits it. For example, Portuguese one includes 0 and 1, and Slavic one includes
1 and 21. A count-free singular phrase is ambiguous in those categories.
Keep all named/positional arguments, ICU argument types, tags and select keys.
Use target-language plural branches; preserve =number special cases, nesting,
apostrophe escaping and # meaning. Native named placeholders retain their names.
Use complete sentences rather than language-specific assembled fragments.

{"You are the independent reviewer. Review EVERY candidate against English, context and terminology, correct errors in a separate output, and retain correct translations. Do not claim native-speaker approval." if phase == "review" else "Translate EVERY source resource; use prior reviewed translations only after checking context and argument roles."}

Validate every file with the nonmutating command:
python3 scripts/localization.py validate-response {platform} {locale} --job INPUT --response OUTPUT
Fix errors before finishing. Do not run import. Files are the deliverable; do
not paste full JSON into chat. Tasks:
{json.dumps(paths, ensure_ascii=False)}
"""


def launch_worker(api, settings, pool_id, phase, jobs, work, index, candidates=None, prompt=None):
    outputs = [work / phase / Path(job["path"]).name for job in jobs]
    candidates = candidates or []
    # A cancelled attempt may have left valid-looking files behind. Only files
    # produced during this session may be attributed to its model/session.
    for output in outputs:
        output.unlink(missing_ok=True)
    candidate_hashes = {str(path): fingerprint(path) for path in candidates}
    project = __import__("base64").urlsafe_b64encode(str(ROOT).encode()).decode().rstrip("=")
    payload = {
        "provider": "claude", "routerPoolId": pool_id, "routerPolicy": settings["policy"],
        "model": settings["model"], "thinking": "on:" + settings["effort"],
        "mode": settings["permissionMode"], "recapMode": "off", "promptSuggestionMode": "off",
        "message": prompt or worker_prompt(phase, settings["platform"], settings["locale"], jobs, outputs, candidates),
    }
    result = api.request(f"/projects/{project}/sessions", payload)
    if "sessionId" not in result or "processId" not in result:
        raise RuntimeError("YA did not return a started session/process; no job was accepted")
    return {
        "phase": phase, "index": index, "jobs": jobs, "outputs": list(map(str, outputs)),
        "candidates": candidate_hashes,
        "requestedPoolId": pool_id,
        "sessionId": result["sessionId"], "processId": result["processId"],
        "projectId": project, "startedAt": time.time(), "status": "running",
    }


def worker_state(api, worker):
    path = f"/projects/{worker['projectId']}/sessions/{worker['sessionId']}/metadata"
    data = api.request(path)
    state = data.get("processState")
    if state in ("in-turn", "starting", "queued", "waiting"):
        return state, data
    if data.get("pendingInputRequest"):
        raise RuntimeError("translation worker unexpectedly requires input")
    return state, data


def check_router_evidence(worker, settings, session):
    # Older YA metadata may omit these optional fields. When supplied, they
    # must agree with the route requested for this worker.
    binding = session.get("routerBinding") or {}
    if binding.get("provider") is not None and binding["provider"] != "claude":
        raise ValueError("worker router provider evidence differs")
    if binding.get("policy") is not None and binding["policy"] != settings["policy"]:
        raise ValueError("worker router policy evidence differs")
    if binding.get("poolId") is not None and worker.get("requestedPoolId") is not None and binding["poolId"] != worker["requestedPoolId"]:
        raise ValueError("worker router pool evidence differs")
    if binding.get("poolName") is not None and binding["poolName"].casefold() != settings["pool"].casefold():
        raise ValueError("worker router pool name evidence differs")


def finish_worker(api, worker, settings):
    check_snapshot(worker["jobs"])
    for path, expected in worker.get("candidates", {}).items():
        if fingerprint(Path(path)) != expected:
            raise ValueError("candidate changed while independent review was running")
    for job, output in zip(worker["jobs"], worker["outputs"]):
        validate(settings["platform"], settings["locale"], job, Path(output))
    _, metadata = worker_state(api, worker)
    session = metadata.get("session", {})
    check_router_evidence(worker, settings, session)
    launch = session.get("effectiveLaunchSettings", {})
    actual_model = session.get("model") or launch.get("requestedModel")
    if actual_model != settings["model"] or launch.get("effort") != settings["effort"]:
        raise ValueError("worker model/effort evidence differs from requested settings")
    if launch.get("permissionMode") != settings["permissionMode"]:
        raise ValueError("worker permission-mode evidence differs from requested settings")
    worker["actualModel"] = actual_model
    worker["effort"] = launch["effort"]
    worker["outputHashes"] = {p: fingerprint(Path(p)) for p in worker["outputs"]}
    api.request(f"/processes/{worker['processId']}/abort", {})
    worker["status"] = "complete"
    worker["completedAt"] = time.time()


def check_worker_outputs(worker):
    for path in worker["outputs"]:
        if fingerprint(Path(path)) != worker.get("outputHashes", {}).get(path):
            raise ValueError("completed translation output changed before independent review")


def cancel_workers(api, state):
    for worker in state.get("workers", []):
        if worker.get("status") == "running":
            try:
                api.request(f"/processes/{worker['processId']}/abort", {})
            except (RuntimeError, OSError, TimeoutError, ValueError):
                # An unconfirmed abort is still an owned, potentially writing
                # process. Resume must stop it before replacing its outputs.
                worker["abortPending"] = True
            else:
                worker["status"] = "cancelled"
                worker.pop("abortPending", None)


def review_terminology(args, api, work, state_path):
    selection = api.request("/agent-auth-router/selection", {"provider": "claude"})
    pool_id, model = resolve_route(selection, args.pool, args.model)
    snapshot = args.snapshot.resolve()
    data = read_json(snapshot)
    if data.get("platform") != args.platform or data.get("locale") != args.locale:
        raise ValueError("terminology snapshot platform/locale differs")
    register = snapshot_guidance(data, args.locale)
    count = len(data.get("resources", {}))
    if not 1 <= count <= 1000:
        raise ValueError("terminology review snapshot must contain 1–1000 resources")
    expected_hash = fingerprint(snapshot)
    settings = {"platform": args.platform, "locale": args.locale, "pool": args.pool,
                "endpoint": args.endpoint, "policy": args.policy, "model": model,
                "effort": args.effort, "permissionMode": args.permission_mode}
    job = {"path": str(snapshot), "hash": expected_hash, "count": count}
    state = read_json(state_path) if state_path.exists() else {"schemaVersion": 1, "settings": settings, "jobs": [job], "workers": [], "imported": []}
    if state.get("settings") != settings or state.get("jobs") != [job]:
        raise ValueError("terminology review snapshot/settings changed; use a new work directory")
    output = work / "terminology" / snapshot.name
    prompt = f"""Independently review shared {args.locale} terminology across the existing
{args.platform} translations in {snapshot}. Read the complete snapshot, its
English/source context, existing translations and shared terminology. This is
terminology harmonization of an already independently reviewed catalog, not a
request to rewrite all messages. Inspect every entry for applicability and
consistency. Allow grammatical inflection and deliberate semantic differences
(e.g. Complete availability versus completed torrent status). Keep privacy,
destructive-action and network-cost consequences exact. Target locale: {args.locale}.
Follow the snapshot's locale-specific register and wording guidance:
{register}

Write ONLY {output}, creating its parent directories. Do not edit source,
catalogs, metadata or scripts, do not import/adopt, commit, run builds, inspect
devices or launch subagents. Your structured review is:
{{"schemaVersion":1,"platform":"{args.platform}","locale":"{args.locale}",
"snapshotHash":"{expected_hash}","reviewedCount":{count},"approved":true,
"corrections":{{RESOURCE_ID:CORRECTED_RAW_STRING_OR_PLURAL_OBJECT}},"notes":["..."]}}
Corrections may be empty when the existing catalog is consistent. approved
means terminology is acceptable after exactly those proposed corrections;
set false for unresolved material issues and explain them. Do not claim native
speaker approval or block on a human reviewer. Preserve placeholder formats,
meaning and the target locale's plural branches in any corrections. Finish with the file
and a short final summary, not a permission question.
"""
    worker = next((w for w in reversed(state["workers"]) if w["status"] in ("running", "complete")), None)
    try:
        if worker is not None and worker.get("abortPending"):
            api.request(f"/processes/{worker['processId']}/abort", {})
            worker["status"] = "cancelled"
            worker.pop("abortPending", None)
            save(state_path, state)
            worker = None
        if worker is None:
            worker = launch_worker(api, settings, pool_id, "terminology", [job], work, 0, prompt=prompt)
            state["workers"].append(worker)
            save(state_path, state)
            print("Started independent terminology review: " + worker["sessionId"], flush=True)
        while worker["status"] == "running":
            check_snapshot([job])
            observed, metadata = worker_state(api, worker)
            if observed in ("in-turn", "starting", "queued", "waiting"):
                if time.time() - worker["startedAt"] > args.timeout_seconds:
                    raise TimeoutError("terminology reviewer exceeded its bounded duration")
                time.sleep(args.poll_seconds)
                continue
            report = read_json(output)
            if report.get("schemaVersion") != 1 or report.get("platform") != args.platform or report.get("locale") != args.locale or report.get("snapshotHash") != expected_hash or report.get("reviewedCount") != count:
                raise ValueError("terminology review does not bind the complete current snapshot")
            if not isinstance(report.get("approved"), bool) or not isinstance(report.get("corrections"), dict) or not set(report["corrections"]) <= set(data["resources"]):
                raise ValueError("invalid terminology approval/corrections")
            session = metadata.get("session", {})
            check_router_evidence(worker, settings, session)
            launch = session.get("effectiveLaunchSettings", {})
            if session.get("model") != model or launch.get("effort") != args.effort or launch.get("permissionMode") != args.permission_mode:
                raise ValueError("terminology reviewer launch evidence differs")
            api.request(f"/processes/{worker['processId']}/abort", {})
            worker.update({"status": "complete", "actualModel": model, "effort": args.effort,
                           "outputHashes": {str(output): fingerprint(output)}, "completedAt": time.time()})
            save(state_path, state)
        check_snapshot([job])
        if fingerprint(output) != worker["outputHashes"][str(output)]:
            raise ValueError("terminology report changed after independent review")
        report = read_json(output)
        if args.adopt_terminology:
            if not report["approved"] or report["corrections"]:
                raise ValueError("resolve the reported terminology corrections before adoption")
            subprocess.run([sys.executable, str(ROOT / "scripts/localization.py"), "adopt-terminology", args.platform, args.locale,
                            "--snapshot", str(snapshot), "--reviewer", model + "/" + worker["sessionId"]], cwd=ROOT, check=True)
        print(json.dumps({"approved": report["approved"], "corrections": list(report["corrections"]), "report": str(output)}), flush=True)
    except BaseException:
        cancel_workers(api, state)
        save(state_path, state)
        raise


def run(args):
    work = args.work_dir.resolve()
    if not work.is_relative_to(ROOT.resolve() / ".local"):
        raise ValueError("YA task state/output must be under the repository's ignored .local directory")
    work.mkdir(parents=True, exist_ok=True)
    state_path = work / "state.json"
    api = Api(args.endpoint)
    if args.command in ("status", "cancel"):
        state = read_json(state_path)
        if args.command == "cancel":
            # Process IDs belong to the endpoint recorded when launched.
            # The CLI's default endpoint must not cancel unrelated local work.
            api = Api(state["settings"]["endpoint"])
            cancel_workers(api, state)
            save(state_path, state)
        print(json.dumps({"workers": [{k: w.get(k) for k in ("phase", "index", "status", "sessionId")} for w in state["workers"]], "imported": len(state.get("imported", []))}, indent=2))
        return
    if args.command == "terms-review":
        return review_terminology(args, api, work, state_path)
    selection = api.request("/agent-auth-router/selection", {"provider": "claude"})
    pool_id, model = resolve_route(selection, args.pool, args.model)
    settings = {"platform": args.platform, "locale": args.locale, "endpoint": args.endpoint,
                "pool": args.pool, "policy": args.policy, "model": model,
                "effort": args.effort, "permissionMode": args.permission_mode,
                "jobsPerWorker": args.jobs_per_worker}
    jobs = snapshot_jobs(args.jobs.resolve(), args.platform, args.locale)
    state = read_json(state_path) if state_path.exists() else {"schemaVersion": 1, "settings": settings, "jobs": jobs, "workers": [], "imported": []}
    if state.get("settings") != settings or state.get("jobs") != jobs:
        raise ValueError("resume settings or exported source jobs changed; export into a new work directory")
    validate_jobs(args.platform, args.locale, jobs)
    groups = [jobs[i:i + args.jobs_per_worker] for i in range(0, len(jobs), args.jobs_per_worker)]
    def worker_for(phase, index):
        return next((w for w in reversed(state["workers"]) if w["phase"] == phase and w["index"] == index and w["status"] in ("running", "complete")), None)
    save(state_path, state)
    try:
        while True:
            check_snapshot(jobs)
            for worker in state["workers"]:
                if worker["status"] != "running":
                    continue
                if worker.get("abortPending"):
                    api.request(f"/processes/{worker['processId']}/abort", {})
                    worker["status"] = "cancelled"
                    worker.pop("abortPending", None)
                    save(state_path, state)
                    continue
                try:
                    observed, _ = worker_state(api, worker)
                    worker["pollErrors"] = 0
                except (TimeoutError, OSError) as error:
                    worker["pollErrors"] = worker.get("pollErrors", 0) + 1
                    if worker["pollErrors"] >= 3:
                        raise
                    print(f"Temporary YA observation failure: {type(error).__name__}", file=sys.stderr, flush=True)
                    continue
                if observed in ("in-turn", "starting", "queued", "waiting"):
                    if time.time() - worker["startedAt"] > args.timeout_seconds:
                        raise TimeoutError("translation worker exceeded its bounded duration")
                    continue
                finish_worker(api, worker, settings)
                save(state_path, state)
                print(f"Completed {worker['phase']} group {worker['index'] + 1}", flush=True)
            active = sum(w["status"] == "running" for w in state["workers"])
            for phase in ("review", "translate"):
                for index, group in enumerate(groups):
                    if active >= args.concurrency or worker_for(phase, index):
                        continue
                    translator = worker_for("translate", index)
                    if phase == "review" and (not translator or translator["status"] != "complete"):
                        continue
                    if phase == "review":
                        check_worker_outputs(translator)
                    candidates = list(map(Path, translator["outputs"])) if phase == "review" else None
                    worker = launch_worker(api, settings, pool_id, phase, group, work, index, candidates)
                    state["workers"].append(worker)
                    save(state_path, state)
                    print(f"Started {phase} group {index + 1}: {worker['sessionId']}", flush=True)
                    active += 1
            complete = all((worker_for("review", i) or {}).get("status") == "complete" for i in range(len(groups)))
            if complete:
                break
            time.sleep(args.poll_seconds)
        if args.import_reviewed:
            validate_jobs(args.platform, args.locale, jobs)
            # Check the whole reviewed set before writing the first catalog.
            # Otherwise an altered later file could leave a partial import.
            for index in range(len(groups)):
                reviewer = worker_for("review", index)
                for output in reviewer["outputs"]:
                    if fingerprint(Path(output)) != reviewer["outputHashes"][output]:
                        raise ValueError("reviewed output changed after validation")
            for index, group in enumerate(groups):
                translator, reviewer = worker_for("translate", index), worker_for("review", index)
                for job, output in zip(group, reviewer["outputs"]):
                    # State records completed work, not current catalog proof.
                    # Recheck even imported jobs: exact repeats are read-only,
                    # while later manual catalog/metadata changes must fail.
                    subprocess.run([sys.executable, str(ROOT / "scripts/localization.py"), "import", args.platform, args.locale,
                                    "--job", job["path"], "--response", output,
                                    "--translator", translator["actualModel"] + "/" + translator["sessionId"],
                                    "--reviewer", reviewer["actualModel"] + "/" + reviewer["sessionId"],
                                    "--idempotent"], cwd=ROOT, check=True)
                    if job["hash"] not in state["imported"]:
                        state["imported"].append(job["hash"])
                        save(state_path, state)
        print(f"All {len(jobs)} jobs independently reviewed; {len(state['imported'])} imported.", flush=True)
    except BaseException:
        cancel_workers(api, state)
        save(state_path, state)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["run", "status", "cancel", "terms-review"])
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--endpoint", default="http://localhost:3400")
    parser.add_argument("--platform", choices=["android", "web", "desktop"])
    parser.add_argument("--locale")
    parser.add_argument("--jobs", type=Path)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--pool")
    parser.add_argument("--policy", default="weekly-pace")
    parser.add_argument("--model", default="opus")
    parser.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"], default="high")
    parser.add_argument("--permission-mode", choices=["default", "acceptEdits", "bypassPermissions"], default="acceptEdits")
    parser.add_argument("--concurrency", type=int, choices=range(1, 4), default=2)
    parser.add_argument("--jobs-per-worker", type=int, choices=range(1, 5), default=3)
    parser.add_argument("--poll-seconds", type=float, default=3)
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--import-reviewed", action="store_true")
    parser.add_argument("--adopt-terminology", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "run" and (not args.jobs or not args.platform or not args.locale or not args.pool):
        parser.error("run requires --jobs, --platform, --locale and --pool")
    if args.command == "terms-review" and (not args.snapshot or not args.platform or not args.locale or not args.pool):
        parser.error("terms-review requires --snapshot, --platform, --locale and --pool")
    if not 0.1 <= args.poll_seconds <= 30 or not 30 <= args.timeout_seconds <= 7200:
        parser.error("poll interval/duration is outside bounded limits")
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        run(args)
        return 0
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError, TimeoutError) as error:
        print(f"localization-ya: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.strip(), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("localization-ya: cancelled owned workers; task state can be resumed", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Prepare and inspect an overnight localization queue; never launch workers."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path("localization/campaigns/legacy-android.json")
SOURCES = {
    "web": "clients/web/src/localization/messages/en.json",
    "desktop": "clients/desktop/src-tauri/locales/en.json",
    "android": "clients/android/app/src/main/res/values/strings.xml",
}
CONTEXT = ["clients/desktop/src-tauri/locales/en.comments.json", "localization/glossary.json"]
SETTINGS = {"model": "gpt-6.1-sol", "effort": "high", "serviceTier": "normal",
            "permissionMode": "bypassPermissions", "concurrency": 3,
            "batchSize": 80, "jobsPerWorker": 3}
TERMS = {"torrent", "peer", "tracker", "remove", "delete_data", "download_folder",
         "share_link", "magnet_link", "checking", "verified", "completed", "done_button",
         "archive", "restore", "paused", "resume", "seeding", "share_ratio", "wifi_only"}


def read(path, limit=1024 * 1024):
    if path.stat().st_size > limit:
        raise ValueError(f"oversized campaign input: {path}")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def contained(root, path):
    path = (root / path).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("campaign paths must stay within the repository")
    return path


def validate_manifest(data):
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or data.get("platforms") != list(SOURCES):
        raise ValueError("campaign requires web, desktop and Android")
    if data.get("baselineLocales") != ["en", "de", "fr"] or data.get("targetDistribution") != "release":
        raise ValueError("preserve the English/German/French release baseline")
    if data.get("workerSettings") != SETTINGS:
        raise ValueError("campaign settings differ from the requested local Sol/high/normal/bypass settings")
    qualification = data.get("qualification", {})
    if (qualification.get("publish") is not False or qualification.get("androidApis") != [28, 35]
            or qualification.get("browserWidths") != [1440, 390]
            or qualification.get("minimumFreeGiB") != 10 or qualification.get("stopBelowFreeGiB") != 4):
        raise ValueError("campaign qualification/resource bounds changed")
    rows = data.get("locales")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise ValueError("campaign requires a bounded locale list")
    tags, qualifiers = set(), set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("locale profile must be an object")
        tag, qualifier = row.get("tag", ""), row.get("androidQualifier", "")
        if (not re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", tag)
                or tag in tags or tag in data["baselineLocales"]
                or not re.fullmatch(r"[a-z]{2,3}(?:-r[A-Z]{2})?", qualifier)
                or qualifier in qualifiers or qualifier.replace("-r", "-") != tag
                or row.get("legacyAndroidQualifier") != qualifier):
            raise ValueError("duplicate, unsafe or mismatched locale/resource qualifier")
        tags.add(tag)
        qualifiers.add(qualifier)
        if (row.get("direction") not in ("ltr", "rtl") or not row.get("name")
                or not isinstance(row.get("register"), str) or not 20 <= len(row["register"]) <= 8192):
            raise ValueError(f"missing locale-specific direction/register: {tag}")
        quantities = row.get("androidQuantities")
        if (not isinstance(quantities, list) or len(quantities) != len(set(quantities))
                or "other" not in quantities or not set(quantities) <= {"zero", "one", "two", "few", "many", "other"}):
            raise ValueError(f"invalid Android quantities: {tag}")
        probes = row.get("systemLocaleProbes")
        if not isinstance(probes, list) or not probes or any(not isinstance(p, str) or len(p) > 64 for p in probes):
            raise ValueError(f"missing System-language probes: {tag}")
    return data


def source_snapshot(root):
    fingerprints = {}
    for relative in [*SOURCES.values(), *CONTEXT]:
        path = contained(root, relative)
        if path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError(f"source input exceeds 16 MiB: {relative}")
        fingerprints[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    counts = {key: len(read(root / relative, 16 * 1024 * 1024)) for key, relative in SOURCES.items() if key != "android"}
    counts["android"] = sum(1 for element in ET.parse(root / SOURCES["android"]).getroot()
                            if element.tag in ("string", "plurals") and element.get("translatable") != "false")
    if any(not 0 < value <= 10000 for value in counts.values()):
        raise ValueError("source catalog counts are outside the supported bounds")
    return fingerprints, counts


def locale_runtime_check(data):
    request = [{"tag": row["tag"], "quantities": row["androidQuantities"], "probes": row["systemLocaleProbes"]}
               for row in data["locales"]]
    script = """let text='';for await(const part of process.stdin)text+=part;
for(const row of JSON.parse(text)){
 if(Intl.getCanonicalLocales(row.tag)[0]!==row.tag||!Intl.PluralRules.supportedLocalesOf([row.tag]).length)throw Error('Unsupported/noncanonical '+row.tag);
 if(JSON.stringify([...new Intl.PluralRules(row.tag).resolvedOptions().pluralCategories].sort())!==JSON.stringify([...row.quantities].sort()))throw Error('Plural profile differs from Intl: '+row.tag);
 for(const probe of row.probes)if(Intl.getCanonicalLocales(probe)[0]!==probe)throw Error('Noncanonical System probe '+probe);
}"""
    subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(request),
                   text=True, check=True, capture_output=True, timeout=30)


def inventory_check(data, legacy_root):
    resources = legacy_root / "android/app/src/main/res"
    if not resources.is_dir():
        return "unavailable; use the recorded inventory in Tactical 383"
    actual = {path.parent.name.removeprefix("values-") for path in resources.glob("values-*/strings.xml")}
    expected = {row["legacyAndroidQualifier"] for row in data["locales"]} | {"de", "fr"}
    if actual != expected:
        raise ValueError(f"legacy inventory differs: {sorted(actual ^ expected)}")
    return "matched all 18 translated legacy locales; English is separate"


def make_plan(root, manifest, work, legacy_root):
    data = validate_manifest(read(manifest))
    locale_runtime_check(data)
    fingerprints, counts = source_snapshot(root)
    fingerprints[str(manifest.relative_to(root))] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    registry = read(root / "localization/locales.json")
    for platform in SOURCES:
        if not set(data["baselineLocales"]) <= set(registry["supportedLocales"][platform]):
            raise ValueError(f"finish German/French release registration first: {platform}")
    profiles = []
    for row in data["locales"]:
        jobs = []
        for platform in SOURCES:
            exported = work / "jobs" / row["tag"] / platform
            state = work / "workers" / row["tag"] / platform
            jobs.append({"platform": platform,
                "export": ["python3", "scripts/localization.py", "export", platform, row["tag"],
                           "--batch-size", "80", "--out-dir", str(exported.relative_to(root))],
                "run": ["python3", "scripts/localization-codex.py", "run", "--platform", platform,
                        "--locale", row["tag"], "--jobs", str(exported.relative_to(root)),
                        "--work-dir", str(state.relative_to(root)), "--model", SETTINGS["model"],
                        "--effort", "high", "--service-tier", "normal", "--permission-mode", "bypassPermissions",
                        "--concurrency", "3", "--jobs-per-worker", "3", "--import-reviewed"]})
        profiles.append({**row, "jobs": jobs})
    return {"schemaVersion": 1, "manifest": str(manifest.relative_to(root)), "frozenInputs": fingerprints,
            "workerSettings": dict(SETTINGS), "sourceCounts": counts, "localeCount": len(profiles),
            "resourceCount": sum(counts.values()) * len(profiles),
            "legacyInventory": inventory_check(data, legacy_root) if legacy_root else "not inspected", "locales": profiles,
            "execution": "supervising agent runs one platform runner at a time; this planner starts nothing",
            "qualification": "independent native/browser/release evidence required; never inferred from catalog completion"}


def verify_plan(root, plan, manifest, work):
    expected = make_plan(root, manifest, work, None)
    if (set(plan) != set(expected)
            or any(plan[key] != value for key, value in expected.items() if key != "legacyInventory")):
        raise ValueError("campaign source/profile/settings changed; reconcile active jobs before creating a new plan")
    return validate_manifest(read(manifest))


def environment_check(root):
    if os.name != "posix":
        raise ValueError("the local worker owner currently requires macOS/Linux")
    tools = {name: shutil.which(name) is not None for name in ("codex", "node", "cargo", "java", "adb", "emulator")}
    if not all(tools.values()):
        raise ValueError("source scripts/dev-env.sh and install missing tools: " + ", ".join(k for k, v in tools.items() if not v))
    login = subprocess.run(["codex", "login", "status"], capture_output=True, text=True, timeout=30)
    if login.returncode or "Logged in using ChatGPT" not in login.stdout + login.stderr:
        raise ValueError("an existing local ChatGPT CLI login is required; do not route through an API key or work pool")
    free = shutil.disk_usage(root).free / 1024**3
    if free < 10:
        raise ValueError(f"campaign needs at least 10 GiB free; available {free:.1f} GiB")
    return {"tools": tools, "chatgptCliLogin": True, "freeGiB": round(free, 1), "workersStartedByThisCommand": 0}


def status(root, data):
    registry = read(root / "localization/locales.json")
    android = read(root / "localization/android/locales.json")["locales"]
    result = []
    for row in data["locales"]:
        tag = row["tag"]
        glossary = root / f"localization/terminology/{tag}.json"
        guidance = read(glossary) if glossary.exists() else {}
        ready = (guidance.get("locale") == tag and isinstance(guidance.get("register"), str)
                 and guidance["register"].startswith(row["register"]) and TERMS <= set(guidance.get("terms", {})))
        platforms = {}
        for platform in SOURCES:
            relative = (f"clients/web/src/localization/messages/{tag}.json" if platform == "web"
                        else f"clients/desktop/src-tauri/locales/{tag}.json" if platform == "desktop"
                        else android.get(tag, {}).get("catalog"))
            present = bool(relative and contained(root, relative).is_file() and (root / f"localization/{platform}/{tag}.json").is_file())
            issues = {"missingCatalogOrLedger": 1}
            if present:
                report = subprocess.run([sys.executable, str(root / "scripts/localization.py"), "check", platform, tag],
                                        cwd=root, capture_output=True, text=True, timeout=60)
                if len(report.stdout) > 16 * 1024 * 1024:
                    raise ValueError("catalog report exceeds 16 MiB")
                if report.returncode not in (0, 1) or not report.stdout.lstrip().startswith("{"):
                    raise ValueError(f"catalog check failed for {platform}/{tag}: {report.stderr[:1000]}")
                values = json.loads(report.stdout)
                issues = {key: len(value) for key, value in values.items() if isinstance(value, list) and value}
                if report.returncode and not issues:
                    raise ValueError(f"catalog check returned an unexplained failure: {platform}/{tag}")
            platforms[platform] = {"reviewComplete": not issues, "issues": issues,
                "releaseRegistered": tag in registry["supportedLocales"][platform],
                "previewRegistered": tag in registry["previewLocales"].get(platform, [])}
        result.append({"locale": tag, "terminologyReady": ready, "platforms": platforms,
                       "qualification": "requires recorded platform evidence; not inferred"})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "verify", "status"])
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--work-dir", type=Path, default=Path(".local/localization-overnight"))
    parser.add_argument("--legacy-root", type=Path, default=ROOT.parent / "jstorrent-typescript")
    parser.add_argument("--check-env", action="store_true", help="read-only tool/login/disk preflight; starts no workers")
    args = parser.parse_args()
    try:
        manifest, work = contained(ROOT, args.manifest), contained(ROOT, args.work_dir)
        if not work.is_relative_to((ROOT / ".local").resolve()) or work == (ROOT / ".local").resolve():
            raise ValueError("campaign task state must use a directory under .local")
        path = work / "plan.json"
        if path.is_symlink():
            raise ValueError("campaign plan must not be a symlink")
        if args.command == "plan":
            current = make_plan(ROOT, manifest, work, args.legacy_root)
            if path.exists() and read(path) != current:
                raise ValueError("existing plan differs; reconcile it or choose a new work directory")
            if not path.exists():
                work.mkdir(parents=True, exist_ok=True)
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile("w", dir=work, encoding="utf-8", delete=False) as handle:
                        temporary = Path(handle.name)
                        handle.write(json.dumps(current, ensure_ascii=False, indent=2) + "\n")
                        handle.flush()
                        os.fsync(handle.fileno())
                    temporary.replace(path)
                finally:
                    if temporary:
                        temporary.unlink(missing_ok=True)
            output = {"plan": str(path.relative_to(ROOT)), "locales": current["localeCount"],
                      "resources": current["resourceCount"], "sourceCounts": current["sourceCounts"], "workersStartedByThisCommand": 0}
        else:
            plan = read(path)
            data = verify_plan(ROOT, plan, manifest, work)
            output = {"planCurrent": True, "workersStartedByThisCommand": 0}
            if args.command == "status":
                output["locales"] = status(ROOT, data)
        if args.check_env:
            output["environment"] = environment_check(ROOT)
        print(json.dumps(output, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f"localization campaign: {error}\n")


if __name__ == "__main__":
    main()

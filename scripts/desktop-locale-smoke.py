#!/usr/bin/env python3
"""Opt-in real desktop IPC/React locale smoke with disposable assets and data.

Build the chosen locale’s preview frontend first, then run this script from any folder.
The ordinary product binary runs twice; only its copied frontend gets the test
script. No test commands or diagnostics are added to the product API. The native
catalog/menu smoke example complements this without showing OS notifications.
"""
from __future__ import annotations

import argparse
from collections import deque
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MAX_REPORT = 64 * 1024
IDENTIFIER = "org.jstorrent.desktop-locale-smoke"
LANGUAGE_KEY = "rstorrent.presentation.language"

SCRIPT = r"""
(async () => {
  const config = __CONFIG__;
  const checks = [];
  const assert = (name, ok) => { checks.push({name, passed:!!ok}); if (!ok) throw new Error(name); };
  const wait = async (test, description) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Timed out: ' + description);
  };
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const events = [];
  let eventId, viewSetId, error, initialLocale, systemLocale;
  const views = [{type:'torrent_list', view_id:'locale-smoke'}];
  const heading = () => document.getElementById('language-heading')?.textContent;
  const selected = () => document.querySelector('input[name="language"]:checked')?.value;
  const radio = value => [...document.querySelectorAll('input[name="language"]')].find(control => control.value === value);
  try {
    await wait(() => document.querySelector('header button[aria-haspopup="dialog"]'), 'React shell');
    const storageBefore = localStorage.getItem(config.languageKey);
    const initial = await invoke('load_desktop_locale');
    initialLocale = initial.locale;
    assert('native preview locales available', JSON.stringify(initial.availableLocales) === JSON.stringify(config.availableLocales));
    assert('initial preference', initial.preference === (config.phase === 'exercise' ? 'system' : config.locale));
    await wait(() => document.documentElement.lang === initial.locale, 'initial native locale in document');
    assert('document follows initial native locale', document.documentElement.lang === initial.locale);
    const hello = await invoke('application_view_hello');
    assert('isolated native product profile', hello.product?.identifier === config.identifier && hello.product?.profile_location === config.profile);
    const opened = await invoke('application_view_open', {request:{views}});
    viewSetId = opened.view_set_id;
    assert('application view owned before locale changes', typeof viewSetId === 'string' && viewSetId.length > 0);
    const handler = window.__TAURI_INTERNALS__.transformCallback(event => events.push(event.payload));
    eventId = await invoke('plugin:event|listen', {event:'desktop://locale-changed', target:{kind:'Any'}, handler});
    if (config.phase === 'exercise') {
      const fallback = await invoke('set_desktop_locale', {preference:config.fallback});
      await wait(() => document.documentElement.lang === config.fallback, 'fallback document');
      assert('production setter selects fallback locale', fallback.preference === config.fallback && fallback.locale === config.fallback);
      assert('React shell fallback text', document.querySelector('header button[aria-haspopup="dialog"]').getAttribute('aria-label') === config.text.fallback.settings);
      document.querySelector('header button[aria-haspopup="dialog"]').click();
      await wait(() => heading() === config.text.fallback.language, 'fallback appearance settings');
      assert('fallback radio selected', selected() === config.fallback);
      const target = await invoke('set_desktop_locale', {preference:config.locale});
      await wait(() => heading() === config.text.target.language && document.documentElement.lang === config.locale && selected() === config.locale, 'native event updates React to target locale');
      assert('production setter selects target locale', target.preference === config.locale && target.locale === config.locale);
      assert('React shell target text', document.querySelector('header button[aria-haspopup="dialog"]').getAttribute('aria-label') === config.text.target.settings);
      const fallbackRadio = radio(config.fallback);
      fallbackRadio.focus();
      fallbackRadio.click();
      await wait(async () => heading() === config.text.fallback.language && (await invoke('load_desktop_locale')).preference === config.fallback, 'React picker saves through native owner');
      assert('React picker returns to fallback locale', selected() === config.fallback && document.documentElement.lang === config.fallback);
      await wait(() => document.activeElement === fallbackRadio && !fallbackRadio.disabled, 'picker focus restored after save');
      assert('fallback picker retains keyboard focus', document.activeElement === fallbackRadio);
      await invoke('set_desktop_locale', {preference:config.locale});
      await wait(() => heading() === config.text.target.language && selected() === config.locale, 'target locale before restart');
      assert('native event includes both locales', events.some(event => event.locale === config.fallback) && events.some(event => event.locale === config.locale));
    } else {
      assert('target locale restored before interaction', document.documentElement.lang === config.locale);
      document.querySelector('header button[aria-haspopup="dialog"]').click();
      await wait(() => heading() === config.text.target.language && selected() === config.locale, 'persisted target settings');
      assert('target preference restored in React', selected() === config.locale);
      const systemRadio = document.querySelector('input[name="language"][value="system"]');
      systemRadio.focus();
      systemRadio.click();
      let system;
      await wait(async () => { system = await invoke('load_desktop_locale'); return system.preference === 'system' && selected() === 'system' && document.documentElement.lang === system.locale; }, 'System picker follows native resolution');
      assert('System clears override and matches native locale', system.preference === 'system' && config.availableLocales.includes(system.locale));
      systemLocale = system.locale;
      await wait(() => document.activeElement === systemRadio && !systemRadio.disabled, 'System picker focus restored after save');
      assert('System picker retains keyboard focus', document.activeElement === systemRadio);
      assert('System event received', events.some(event => event.preference === 'system'));
    }
    await invoke('application_view_update', {viewSetId, request:{views}});
    assert('existing application view survives locale changes', true);
    const after = await invoke('application_view_hello');
    assert('host profile identity unchanged', JSON.stringify(after.product) === JSON.stringify(hello.product));
    assert('native choice has no browser preference shadow', storageBefore === null && localStorage.getItem(config.languageKey) === null);
  } catch (failure) { error = String(failure); }
  try { if (viewSetId) await invoke('application_view_close', {viewSetId}); } catch (failure) { error ??= String(failure); }
  try { if (eventId !== undefined) await invoke('plugin:event|unlisten', {event:'desktop://locale-changed', eventId}); } catch (failure) { error ??= String(failure); }
  try {
    await fetch(config.report, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({phase:config.phase, checks, initialLocale, systemLocale, error:error ?? null})});
  } finally { await invoke('application_shutdown').catch(() => {}); }
})();
"""


class Failure(Exception):
    pass


def cargo(arguments, environment, timeout, *, capture=False):
    result = subprocess.run(
        ["bash", "-c", 'source scripts/dev-env.sh\nexec cargo "$@"', "cargo", *arguments],
        cwd=ROOT, env=environment, timeout=timeout, text=True,
        stdout=subprocess.PIPE if capture else None,
        check=True,
    )
    return result.stdout


def stop(process):
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            pass
        process.wait(timeout=10)


def catalog_configuration(root, locale):
    """Resolve QA inputs before building; fixtures can add a locale in isolation."""
    if not isinstance(locale, str) or len(locale) > 64 or not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", locale):
        raise Failure("Invalid target locale tag")
    def read(path):
        if not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            raise Failure(f"Missing or oversized locale input: {path}")
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise Failure(f"Locale input must be an object: {path}")
        return value

    manifest = read(root / "localization/locales.json")
    fallback = manifest["fallbackLocale"]
    def available(platform):
        shipping = manifest["supportedLocales"][platform]
        preview = manifest.get("previewLocales", {}).get(platform, [])
        if not isinstance(shipping, list) or not isinstance(preview, list):
            raise Failure(f"Invalid {platform} locale registration")
        tags = shipping + preview
        if not 0 < len(tags) <= 100 or any(not isinstance(tag, str) or len(tag) > 64 or tag.lower() == "system" or not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", tag) for tag in tags) or len(set(tag.lower() for tag in tags)) != len(tags):
            raise Failure(f"Invalid {platform} locale registration")
        if locale not in tags:
            raise Failure(f"Locale {locale!r} is not registered for {platform}")
        if fallback not in shipping:
            raise Failure(f"Fallback locale is not shipping on {platform}")
        return tags

    desktop = available("desktop")
    available("web")
    if locale == fallback:
        raise Failure("Choose a registered target locale different from the fallback locale")
    for tag in (fallback, locale):
        path = root / manifest["catalogs"]["desktop"]
        native = read(path.with_name(f"{tag}.json"))
        if not native or any(not isinstance(value, str) or not value for value in native.values()):
            raise Failure(f"Native catalog for {tag!r} is not ready")
    source = read(root / manifest["catalogs"]["web"])
    text = {}
    for kind, tag in (("fallback", fallback), ("target", locale)):
        path = (root / manifest["catalogs"]["web"]).with_name(f"{tag}.json")
        catalog = read(path)
        if set(catalog) != set(source):
            raise Failure(f"React catalog for {tag!r} is incomplete; finish translation/import before this smoke")
        text[kind] = {
            "settings": catalog["inspection.components.app.settings"]["defaultMessage"],
            "language": catalog["localization.language.title"]["defaultMessage"],
        }
    if text["fallback"] == text["target"]:
        raise Failure("Locale checks must use translated React labels")
    return {"locale": locale, "fallback": fallback, "availableLocales": desktop, "text": text}


def run(args):
    catalog = catalog_configuration(ROOT, args.locale)
    source = args.frontend_dir.resolve()
    if not (source / "index.html").is_file():
        raise Failure("Build the chosen locale’s preview frontend first (VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1)")
    environment = os.environ.copy()
    metadata = json.loads(cargo(["metadata", "--no-deps", "--format-version=1"], environment, 60, capture=True))
    binary_dir = Path(metadata["target_directory"])
    if environment.get("CARGO_BUILD_TARGET"):
        binary_dir /= environment["CARGO_BUILD_TARGET"]
    binary = binary_dir / "debug" / ("jstorrent-client.exe" if os.name == "nt" else "jstorrent-client")
    built_override = False
    server = None
    # macOS's ordinary per-user temporary directory can exceed the native
    # bootstrap socket limit before the product can create its webview.
    temporary_parent = "/tmp" if sys.platform == "darwin" else None
    baseline = tempfile.TemporaryDirectory(prefix="jst-loc-base-", dir=temporary_parent)
    baseline_assets = Path(baseline.name) / "assets"
    try:
        restore_source = (args.restore_frontend_dir or ROOT / "clients/web/dist").resolve()
        if not (restore_source / "index.html").is_file():
            raise Failure("The ordinary frontend snapshot for debug binary restoration is missing")
        shutil.copytree(restore_source, baseline_assets)
        with tempfile.TemporaryDirectory(prefix="jst-loc-", dir=temporary_parent) as temporary:
            directory = Path(temporary).resolve()
            assets, data = directory / "assets", directory / "runtime"
            shutil.copytree(source, assets)
            preferences = data / "config/presentation-preferences.json"
            preferences.parent.mkdir(parents=True)
            preferences.write_text('{"future":{"keep":true}}\n')
            token = secrets.token_hex(24)
            reports = {}
            report_ready = threading.Event()

            class Handler(http.server.BaseHTTPRequestHandler):
                def setup(self):
                    super().setup()
                    self.connection.settimeout(5)

                def log_message(self, *_):
                    pass

                def respond(self, code):
                    self.send_response(code)
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Access-Control-Allow-Headers", "Content-Type")
                    self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
                    self.send_header("Content-Length", "0")
                    self.end_headers()

                def do_OPTIONS(self):
                    self.respond(204 if urlsplit(self.path).path == f"/{token}" else 404)

                def do_POST(self):
                    if urlsplit(self.path).path != f"/{token}":
                        self.respond(404)
                        return
                    try:
                        length = int(self.headers.get("Content-Length", "0"))
                        if not 0 < length <= MAX_REPORT:
                            raise ValueError("report length")
                        value = json.loads(self.rfile.read(length))
                        if not isinstance(value, dict) or value.get("phase") not in ("exercise", "restart") or not isinstance(value.get("checks"), list) or len(value["checks"]) > 100:
                            raise ValueError("report shape")
                        if any(not isinstance(check, dict) or not isinstance(check.get("name"), str) or len(check["name"]) > 200 or not isinstance(check.get("passed"), bool) for check in value["checks"]):
                            raise ValueError("report checks")
                        reports[value["phase"]] = value
                    except (ValueError, TypeError, OSError):
                        self.respond(400)
                        return
                    self.respond(204)
                    report_ready.set()

            server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
            server.timeout = 5
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = f"http://127.0.0.1:{server.server_port}"
            override = json.loads(environment.get("TAURI_CONFIG", "{}"))
            override.update({"identifier": IDENTIFIER, "productName": "JSTorrent Locale Smoke"})
            override.setdefault("build", {})["frontendDist"] = str(assets)
            base_config = json.loads((ROOT / "clients/desktop/src-tauri/tauri.conf.json").read_text())
            window = next(window.copy() for window in base_config["app"]["windows"] if window["label"] == "main")
            window.update({"incognito": True, "title": "JSTorrent Locale Smoke"})
            override.setdefault("app", {})["windows"] = [window]
            override.setdefault("app", {}).setdefault("security", {})["csp"] = (
                "default-src 'self'; connect-src ipc: http://ipc.localhost https://link.jstorrent.com "
                + endpoint + "; img-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'"
            )
            environment["TAURI_CONFIG"] = json.dumps(override)
            environment["RSTORRENT_DESKTOP_DATA_ROOT"] = str(data)
            environment["VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES"] = "1"
            index = assets / "index.html"
            original_index = index.read_text()
            index.write_text(original_index.replace("</body>", '<script src="/desktop-locale-smoke.js"></script></body>'))
            script = assets / "desktop-locale-smoke.js"

            def phase_script(phase):
                config = {**catalog, "phase": phase, "report": endpoint + "/" + token, "identifier": IDENTIFIER,
                          "profile": str(data / "data/profile"), "languageKey": LANGUAGE_KEY}
                script.write_text(SCRIPT.replace("__CONFIG__", json.dumps(config)))

            phase_script("exercise")
            built_override = True
            cargo(["build", "-p", "rstorrent-desktop", "--bin", "jstorrent-client"], environment, args.build_timeout)
            # Rebuild only the embedded script between runs. Both runs exercise
            # the same ordinary production commands and isolated durable profile.
            for phase in ("exercise", "restart"):
                if phase == "restart":
                    phase_script(phase)
                    cargo(["build", "-p", "rstorrent-desktop", "--bin", "jstorrent-client"], environment, args.build_timeout)
                report_ready.clear()
                process = subprocess.Popen([str(binary), "--update-presentation=unfocused"], cwd=ROOT, env=environment,
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                           start_new_session=os.name == "posix")
                diagnostics = deque(maxlen=100)
                def drain():
                    for line in process.stdout:
                        diagnostics.append(line[:2048].decode(errors="replace").rstrip())
                reader = threading.Thread(target=drain, daemon=True)
                reader.start()
                try:
                    deadline = time.monotonic() + args.timeout
                    while not report_ready.wait(0.2) and process.poll() is None and time.monotonic() < deadline:
                        pass
                    if phase not in reports:
                        raise Failure(f"{phase}: no bounded webview report\n" + "\n".join(diagnostics)[-8000:])
                    report = reports[phase]
                    if report.get("error") or not report["checks"] or any(check.get("passed") is not True for check in report["checks"]):
                        raise Failure(json.dumps(report, ensure_ascii=False))
                    try:
                        process.wait(timeout=20)
                    except subprocess.TimeoutExpired as error:
                        raise Failure(f"{phase}: product did not finish graceful shutdown") from error
                    if process.returncode:
                        raise Failure(f"{phase}: product exited {process.returncode}")
                    saved = json.loads(preferences.read_text())
                    if saved.get("future") != {"keep": True} or (saved.get("language") != args.locale if phase == "exercise" else "language" in saved):
                        raise Failure(f"{phase}: native preference persistence did not preserve expected fields")
                    print(json.dumps({"locale": args.locale, "phase": phase, "cases": len(report["checks"]), "passed": len(report["checks"]), "initialLocale": report.get("initialLocale"), "systemLocale": report.get("systemLocale"), "persistence": "ok", "shutdown": "joined"}), flush=True)
                finally:
                    stop(process)
                    reader.join(timeout=2)
            server.shutdown()
            server.server_close()
            server = None
            thread.join(timeout=2)
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        try:
            if built_override:
                # Restore from a frozen ordinary snapshot; another web build
                # may mutate web/dist while the native smoke is running.
                restored_environment = os.environ.copy()
                restored_config = json.loads(restored_environment.get("TAURI_CONFIG", "{}"))
                restored_config.setdefault("build", {})["frontendDist"] = str(baseline_assets)
                restored_environment["TAURI_CONFIG"] = json.dumps(restored_config)
                cargo(["build", "-p", "rstorrent-desktop", "--bin", "jstorrent-client"], restored_environment, args.build_timeout)
        finally:
            baseline.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale", default="de", help="declared target locale to exercise (default: de)")
    parser.add_argument("--frontend-dir", type=Path, default=ROOT / "clients/web/dist")
    parser.add_argument("--restore-frontend-dir", type=Path, help="ordinary frontend snapshot restored after testing (default: web/dist copied at start)")
    parser.add_argument("--timeout", type=int, default=60, help="seconds per native run (20–180)")
    parser.add_argument("--build-timeout", type=int, default=600, help="seconds per debug build (60–1800)")
    args = parser.parse_args()
    if not 20 <= args.timeout <= 180 or not 60 <= args.build_timeout <= 1800:
        parser.error("timeouts exceed supported bounds")
    try:
        run(args)
    except (Failure, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

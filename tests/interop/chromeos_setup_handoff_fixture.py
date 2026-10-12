"""Bounded candidate HTTPS responses inside a physical ChromeOS browser.

Machine Control deploys and invokes this fixture on an explicitly selected
device. Its CDP transport remains Machine Control's cdp module. This fixture
does not publish a website, proxy ARC, or modify any production application.
Only the owned setup route/assets receive candidate bytes. The isolated
extension-ID substitution is recorded by the physical qualification.
"""

import base64
import http.client
import json
import mimetypes
from pathlib import Path
import socket
import sys
import time


def main():
    sys.path.insert(0, "/mnt/stateful_partition/c2")
    from cdp import WebSocket

    root = Path(sys.argv[1])
    mode = sys.argv[2] if len(sys.argv) > 2 else "candidate"
    assert mode in ("candidate", "offline")
    connection = http.client.HTTPConnection("127.0.0.1", 9222, timeout=5)
    connection.request("GET", "/json/version")
    browser = json.loads(connection.getresponse().read())
    connection.close()
    ws = WebSocket(browser["webSocketDebuggerUrl"])
    ws.sock.settimeout(1)
    sequence = 0

    def send(method, params, session=None):
        nonlocal sequence
        sequence += 1
        message = {"id": sequence, "method": method, "params": params}
        if session:
            message["sessionId"] = session
        ws.send(json.dumps(message))

    patterns = [
        {"urlPattern": "https://jstorrent.com/" + name, "requestStage": "Request"}
        for name in ("chrome-extension.html", "chrome-extension.js", "chrome-extension.css", "js-32.png", "favicon.ico")
    ]
    # Explicit discovery includes new top-level tabs opened through ARC. Those
    # tabs are not necessarily related targets of the browser auto-attach root.
    send("Target.setDiscoverTargets", {"discover": True})
    send("Target.setAutoAttach", {
        "autoAttach": True, "waitForDebuggerOnStart": False, "flatten": True,
        "filter": [{"type": "page"}, {"exclude": True}],
    })
    deadline = time.monotonic() + 300
    print(json.dumps({"fixture": mode, "started": True}), flush=True)
    attached = set()
    try:
        while time.monotonic() < deadline:
            try:
                event = json.loads(ws.recv())
            except socket.timeout:
                continue
            method = event.get("method")
            params = event.get("params", {})
            if method == "Target.targetCreated" and params["targetInfo"]["type"] == "page":
                target = params["targetInfo"]["targetId"]
                if target not in attached:
                    send("Target.attachToTarget", {"targetId": target, "flatten": True})
            elif method == "Target.attachedToTarget":
                session = params["sessionId"]
                attached.add(params["targetInfo"]["targetId"])
                send("Fetch.enable", {"patterns": patterns}, session)
                send("Runtime.runIfWaitingForDebugger", {}, session)
            elif "error" in event:
                print(json.dumps({"fixture_protocol_error": event["error"]["code"]}), flush=True)
            elif method == "Fetch.requestPaused":
                session = event["sessionId"]
                url = params["request"]["url"]
                name = url.removeprefix("https://jstorrent.com/")
                file = root / name
                if name not in {"chrome-extension.html", "chrome-extension.js", "chrome-extension.css", "js-32.png", "favicon.ico"}:
                    send("Fetch.continueRequest", {"requestId": params["requestId"]}, session)
                    continue
                body = file.read_bytes()
                if name == "chrome-extension.js":
                    body = body.replace(b"dbokmlpefliilbjldladbimlcfgbolhk", b"gcgoepclopkgijmclmlheafaglmbjlcc")
                if mode == "offline" and name == "chrome-extension.html":
                    send("Fetch.failRequest", {"requestId": params["requestId"], "errorReason": "InternetDisconnected"}, session)
                else:
                    headers = [{"name": "Content-Type", "value": mimetypes.guess_type(name)[0] or "application/octet-stream"},
                               {"name": "Cache-Control", "value": "no-store"},
                               {"name": "Referrer-Policy", "value": "no-referrer"}]
                    send("Fetch.fulfillRequest", {"requestId": params["requestId"], "responseCode": 200,
                         "responseHeaders": headers, "body": base64.b64encode(body).decode()}, session)
                print(json.dumps({"candidate_asset": name, "mode": mode}), flush=True)
    finally:
        # Disconnect releases interception and resumes all owned paused targets.
        ws.close()


if __name__ == "__main__":
    main()

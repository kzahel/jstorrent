#!/usr/bin/env python3
"""
Debug Input Server - runs on dev machine, serves debug page and collects events.

Usage:
    python3 debug-server.py [port]

Then open http://<dev-machine-ip>:8765/ on the Chromebook.
"""

import json
import sys
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

# Store events in memory
events = []
MAX_EVENTS = 500

def get_local_ip():
    """Get the local IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "localhost"

DEBUG_PAGE = '''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Input Debug</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: monospace;
            background: #1a1a2e;
            color: #eee;
            min-height: 100vh;
            position: relative;
        }
        .container {
            display: flex;
            height: calc(100vh - 50px);
        }
        .panel {
            flex: 1;
            padding: 10px;
            border-right: 1px solid #333;
            overflow-y: auto;
        }
        .panel:last-child { border-right: none; }
        h2 {
            color: #0ff;
            margin-bottom: 10px;
            font-size: 14px;
        }
        .event {
            background: #252545;
            padding: 8px;
            margin-bottom: 5px;
            border-radius: 4px;
            font-size: 12px;
            border-left: 3px solid #0f0;
        }
        .event.keydown { border-left-color: #0f0; }
        .event.keyup { border-left-color: #f00; }
        .event.click { border-left-color: #ff0; }
        .event.touch { border-left-color: #f0f; }
        .key { color: #0ff; font-weight: bold; }
        .code { color: #f0f; }
        .mods { color: #ff0; }
        .coords { color: #0f0; }

        .click-marker {
            position: fixed;
            width: 30px;
            height: 30px;
            border: 3px solid #ff0;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            pointer-events: none;
            z-index: 999;
            animation: pulse 0.5s ease-out forwards;
        }
        @keyframes pulse {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }

        .grid-lines {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            opacity: 0.15;
            z-index: -1;
        }

        .status {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #000;
            padding: 10px;
            font-size: 14px;
            z-index: 1002;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }
        .status-item { color: #0ff; }
        .status-item.ok { color: #0f0; }
        .status-item.error { color: #f00; }

        .focus-box {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 20px 40px;
            background: #333;
            border: 2px solid #0ff;
            border-radius: 8px;
            font-size: 18px;
            z-index: 100;
        }
        .focus-box.focused { border-color: #0f0; background: #1a3a1a; }

        .clear-btn {
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 8px 16px;
            background: #f00;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            z-index: 1003;
        }

        .coord-display {
            position: fixed;
            background: rgba(0,0,0,0.9);
            color: #0f0;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 16px;
            pointer-events: none;
            z-index: 1004;
            display: none;
        }
    </style>
</head>
<body tabindex="0">
    <div class="container">
        <div class="panel" id="keyboard-panel">
            <h2>KEYBOARD EVENTS</h2>
            <div id="keyboard-log"></div>
        </div>
        <div class="panel" id="mouse-panel">
            <h2>MOUSE/TOUCH EVENTS</h2>
            <div id="mouse-log"></div>
        </div>
    </div>

    <div class="focus-box" id="focus-box">Click to focus for keyboard input</div>
    <div class="coord-display" id="coord-display"></div>
    <button class="clear-btn" onclick="clearLogs()">Clear</button>

    <div class="status">
        <span class="status-item">Screen: <span id="screen-size"></span></span>
        <span class="status-item">Last Key: <span id="last-key">-</span></span>
        <span class="status-item">Last Click: <span id="last-click">-</span></span>
        <span class="status-item">Server: <span id="server-status">checking...</span></span>
    </div>

    <canvas id="grid-canvas" class="grid-lines"></canvas>

    <script>
        const keyboardLog = document.getElementById('keyboard-log');
        const mouseLog = document.getElementById('mouse-log');
        const coordDisplay = document.getElementById('coord-display');
        const focusBox = document.getElementById('focus-box');
        const gridCanvas = document.getElementById('grid-canvas');
        const serverStatus = document.getElementById('server-status');

        let serverConnected = false;

        async function sendEvent(event) {
            try {
                const response = await fetch('/event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(event)
                });
                if (response.ok && !serverConnected) {
                    serverConnected = true;
                    serverStatus.textContent = 'CONNECTED';
                    serverStatus.parentElement.classList.add('ok');
                }
            } catch (e) {
                serverStatus.textContent = 'ERROR';
                serverStatus.parentElement.classList.add('error');
            }
        }

        // Initial connection check
        fetch('/ping').then(() => {
            serverConnected = true;
            serverStatus.textContent = 'CONNECTED';
            serverStatus.parentElement.classList.add('ok');
        }).catch(() => {
            serverStatus.textContent = 'ERROR';
            serverStatus.parentElement.classList.add('error');
        });

        function drawGrid() {
            const ctx = gridCanvas.getContext('2d');
            gridCanvas.width = window.innerWidth;
            gridCanvas.height = window.innerHeight;
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;

            for (let x = 0; x < gridCanvas.width; x += 100) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, gridCanvas.height);
                ctx.stroke();
                ctx.fillStyle = '#666';
                ctx.font = '10px monospace';
                ctx.fillText(x.toString(), x + 2, 12);
            }

            for (let y = 0; y < gridCanvas.height; y += 100) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(gridCanvas.width, y);
                ctx.stroke();
                ctx.fillStyle = '#666';
                ctx.fillText(y.toString(), 2, y + 12);
            }
        }
        drawGrid();
        window.addEventListener('resize', drawGrid);

        document.getElementById('screen-size').textContent = `${window.innerWidth}x${window.innerHeight}`;
        window.addEventListener('resize', () => {
            document.getElementById('screen-size').textContent = `${window.innerWidth}x${window.innerHeight}`;
        });

        document.body.addEventListener('focus', () => {
            focusBox.classList.add('focused');
            focusBox.textContent = 'FOCUSED - Type to test';
        });

        document.body.addEventListener('blur', () => {
            focusBox.classList.remove('focused');
            focusBox.textContent = 'Click to focus for keyboard input';
        });

        focusBox.addEventListener('click', () => document.body.focus());

        function logKeyEvent(e, type) {
            e.preventDefault();

            const mods = [];
            if (e.ctrlKey) mods.push('Ctrl');
            if (e.altKey) mods.push('Alt');
            if (e.shiftKey) mods.push('Shift');
            if (e.metaKey) mods.push('Meta');

            const eventData = {
                type: type,
                key: e.key,
                code: e.code,
                keyCode: e.keyCode,
                which: e.which,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                modifiers: mods
            };

            sendEvent(eventData);

            const modStr = mods.length ? mods.join('+') + '+' : '';
            const div = document.createElement('div');
            div.className = `event ${type}`;
            div.innerHTML = `
                <strong>${type}</strong>: <span class="key">${e.key}</span>
                code=<span class="code">${e.code}</span>
                keyCode=<span class="code">${e.keyCode}</span>
                mods=<span class="mods">${modStr || 'none'}</span>
            `;
            keyboardLog.insertBefore(div, keyboardLog.firstChild);

            document.getElementById('last-key').textContent = `${modStr}${e.key} (${e.keyCode})`;

            while (keyboardLog.children.length > 30) {
                keyboardLog.removeChild(keyboardLog.lastChild);
            }
        }

        document.addEventListener('keydown', e => logKeyEvent(e, 'keydown'));
        document.addEventListener('keyup', e => logKeyEvent(e, 'keyup'));

        function logClickEvent(e, type) {
            const x = e.clientX ?? e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX;
            const y = e.clientY ?? e.touches?.[0]?.clientY ?? e.changedTouches?.[0]?.clientY;

            if (x === undefined || y === undefined) return;

            const eventData = {
                type: type,
                x: Math.round(x),
                y: Math.round(y)
            };

            sendEvent(eventData);

            const marker = document.createElement('div');
            marker.className = 'click-marker';
            marker.style.left = x + 'px';
            marker.style.top = y + 'px';
            document.body.appendChild(marker);
            setTimeout(() => marker.remove(), 500);

            const div = document.createElement('div');
            div.className = `event ${type.includes('touch') ? 'touch' : 'click'}`;
            div.innerHTML = `<strong>${type}</strong>: <span class="coords">(${Math.round(x)}, ${Math.round(y)})</span>`;
            mouseLog.insertBefore(div, mouseLog.firstChild);

            document.getElementById('last-click').textContent = `(${Math.round(x)}, ${Math.round(y)})`;

            while (mouseLog.children.length > 30) {
                mouseLog.removeChild(mouseLog.lastChild);
            }
        }

        document.addEventListener('click', e => logClickEvent(e, 'click'));
        document.addEventListener('touchstart', e => logClickEvent(e, 'touchstart'));
        document.addEventListener('touchend', e => logClickEvent(e, 'touchend'));

        document.addEventListener('mousemove', e => {
            coordDisplay.style.display = 'block';
            coordDisplay.style.left = (e.clientX + 15) + 'px';
            coordDisplay.style.top = (e.clientY - 10) + 'px';
            coordDisplay.textContent = `(${e.clientX}, ${e.clientY})`;
        });

        document.addEventListener('mouseleave', () => {
            coordDisplay.style.display = 'none';
        });

        function clearLogs() {
            keyboardLog.innerHTML = '';
            mouseLog.innerHTML = '';
            fetch('/clear', { method: 'POST' });
        }

        setTimeout(() => document.body.focus(), 100);
    </script>
</body>
</html>'''


class DebugHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Only log interesting requests
        if '/event' not in args[0] and '/ping' not in args[0]:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(DEBUG_PAGE.encode())

        elif self.path == '/ping':
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        elif self.path == '/events':
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(events, indent=2).encode())

        elif self.path == '/events/last':
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            last_10 = events[-10:] if events else []
            self.wfile.write(json.dumps(last_10, indent=2).encode())

        elif self.path == '/events/keyboard':
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            kb_events = [e for e in events if e.get('type') in ('keydown', 'keyup')][-20:]
            self.wfile.write(json.dumps(kb_events, indent=2).encode())

        elif self.path == '/events/mouse':
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            mouse_events = [e for e in events if e.get('type') in ('click', 'touchstart', 'touchend')][-20:]
            self.wfile.write(json.dumps(mouse_events, indent=2).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/event':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                event = json.loads(body)
                event['server_time'] = datetime.now().isoformat()
                events.append(event)

                # Trim old events
                while len(events) > MAX_EVENTS:
                    events.pop(0)

                # Print keyboard events to console for easy monitoring
                if event.get('type') == 'keydown':
                    mods = event.get('modifiers', [])
                    mod_str = '+'.join(mods) + '+' if mods else ''
                    print(f"KEY: {mod_str}{event.get('key')} (code={event.get('code')}, keyCode={event.get('keyCode')})")

                elif event.get('type') in ('click', 'touchstart'):
                    print(f"CLICK: ({event.get('x')}, {event.get('y')})")

            except json.JSONDecodeError:
                pass

            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        elif self.path == '/clear':
            events.clear()
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        else:
            self.send_response(404)
            self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    local_ip = get_local_ip()

    print(f"Debug Input Server")
    print(f"==================")
    print(f"Open on Chromebook: http://{local_ip}:{port}/")
    print(f"")
    print(f"API Endpoints:")
    print(f"  GET  /events         - All events (JSON)")
    print(f"  GET  /events/last    - Last 10 events")
    print(f"  GET  /events/keyboard - Last 20 keyboard events")
    print(f"  GET  /events/mouse   - Last 20 mouse/touch events")
    print(f"  POST /clear          - Clear all events")
    print(f"")
    print(f"Keyboard events will be printed here as they occur.")
    print(f"=" * 50)

    server = HTTPServer(('0.0.0.0', port), DebugHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()

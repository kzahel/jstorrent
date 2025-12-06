#!/usr/bin/env python3
"""
Debug server for testing touch/mouse input injection.
Serves an HTML page that logs all input events with coordinates.

Run on ChromeOS (in Crostini): python3 debug_server.py
Then open http://localhost:8765 in Chrome on ChromeOS.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json

PORT = 8765
events_log = []

HTML_PAGE = '''<!DOCTYPE html>
<html>
<head>
    <title>Input Debug</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: monospace;
            background: #1a1a2e;
            color: #eee;
            overflow: hidden;
            touch-action: none;
        }
        #canvas {
            position: absolute;
            top: 0; left: 0;
            width: 100vw;
            height: 100vh;
            cursor: crosshair;
        }
        #info {
            position: fixed;
            top: 10px; left: 10px;
            background: rgba(0,0,0,0.8);
            padding: 15px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 100;
            min-width: 300px;
        }
        #coords {
            font-size: 24px;
            color: #0f0;
            margin: 10px 0;
        }
        #log {
            position: fixed;
            bottom: 10px; left: 10px; right: 10px;
            background: rgba(0,0,0,0.8);
            padding: 10px;
            border-radius: 8px;
            max-height: 200px;
            overflow-y: auto;
            font-size: 12px;
        }
        .event { margin: 2px 0; }
        .click { color: #f00; }
        .move { color: #888; }
        .touch { color: #0ff; }
        #grid {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
        }
        .marker {
            position: absolute;
            width: 20px; height: 20px;
            border: 2px solid #f00;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            pointer-events: none;
            animation: fade 2s forwards;
        }
        @keyframes fade { to { opacity: 0; } }
        #targets {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
        }
        .target {
            position: absolute;
            width: 60px; height: 60px;
            background: rgba(255,0,0,0.3);
            border: 2px solid #f00;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            pointer-events: auto;
            cursor: pointer;
        }
        .target:hover { background: rgba(255,0,0,0.5); }
        .target.hit { background: rgba(0,255,0,0.5); border-color: #0f0; }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>
    <div id="grid"></div>
    <div id="targets"></div>

    <div id="info">
        <div>Screen: <span id="screen">?</span></div>
        <div>Window: <span id="window">?</span></div>
        <div id="coords">X: - Y: -</div>
        <div>Last event: <span id="lastEvent">none</span></div>
        <div style="margin-top:10px; font-size:11px; color:#888;">
            Click anywhere to see coordinates.<br>
            Red targets = test click areas.
        </div>
    </div>

    <div id="log"></div>

<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');
const coordsEl = document.getElementById('coords');
const lastEventEl = document.getElementById('lastEvent');

// Set canvas size
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawGrid();
    document.getElementById('screen').textContent = `${screen.width}x${screen.height}`;
    document.getElementById('window').textContent = `${window.innerWidth}x${window.innerHeight}`;
}

function drawGrid() {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;

    // Draw grid lines every 100px
    for (let x = 0; x < canvas.width; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.fillText(x, x + 2, 12);
    }
    for (let y = 0; y < canvas.height; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.fillText(y, 2, y + 12);
    }
}

function log(msg, cls='') {
    const div = document.createElement('div');
    div.className = 'event ' + cls;
    div.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
    logEl.insertBefore(div, logEl.firstChild);
    if (logEl.children.length > 50) logEl.lastChild.remove();

    // Send to server
    fetch('/log', {
        method: 'POST',
        body: JSON.stringify({time: Date.now(), msg, cls}),
        headers: {'Content-Type': 'application/json'}
    }).catch(() => {});
}

function showMarker(x, y) {
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    document.getElementById('grid').appendChild(marker);
    setTimeout(() => marker.remove(), 2000);
}

function updateCoords(x, y, type) {
    coordsEl.textContent = `X: ${x} Y: ${y}`;
    lastEventEl.textContent = type;
}

// Mouse events
canvas.addEventListener('mousemove', e => {
    updateCoords(e.clientX, e.clientY, 'mousemove');
});

canvas.addEventListener('mousedown', e => {
    const msg = `CLICK (${e.button}) at ${e.clientX}, ${e.clientY}`;
    log(msg, 'click');
    updateCoords(e.clientX, e.clientY, 'mousedown');
    showMarker(e.clientX, e.clientY);
});

canvas.addEventListener('mouseup', e => {
    log(`mouseup at ${e.clientX}, ${e.clientY}`, 'click');
});

// Touch events
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        const msg = `TOUCH START at ${Math.round(touch.clientX)}, ${Math.round(touch.clientY)}`;
        log(msg, 'touch');
        updateCoords(Math.round(touch.clientX), Math.round(touch.clientY), 'touchstart');
        showMarker(touch.clientX, touch.clientY);
    }
});

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        updateCoords(Math.round(touch.clientX), Math.round(touch.clientY), 'touchmove');
    }
});

canvas.addEventListener('touchend', e => {
    e.preventDefault();
    log('TOUCH END', 'touch');
});

// Create test targets
function createTargets() {
    const targets = document.getElementById('targets');
    const positions = [
        [100, 100], [300, 100], [500, 100],
        [100, 300], [300, 300], [500, 300],
        [100, 500], [300, 500], [500, 500],
    ];

    positions.forEach(([x, y], i) => {
        const div = document.createElement('div');
        div.className = 'target';
        div.style.left = (x - 30) + 'px';
        div.style.top = (y - 30) + 'px';
        div.textContent = `${x},${y}`;
        div.addEventListener('click', () => {
            div.classList.add('hit');
            log(`TARGET HIT: ${x},${y}`, 'click');
            setTimeout(() => div.classList.remove('hit'), 500);
        });
        targets.appendChild(div);
    });
}

resize();
createTargets();
window.addEventListener('resize', resize);
log('Debug page loaded. Screen: ' + screen.width + 'x' + screen.height);
</script>
</body>
</html>
'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {args[0]}")

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode())
        elif self.path == '/events':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(events_log[-100:]).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/log':
            length = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(length).decode()
            try:
                event = json.loads(data)
                events_log.append(event)
                print(f"EVENT: {event.get('msg', event)}")
            except:
                pass
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    print(f"Debug server starting on http://localhost:{PORT}")
    print("Open this URL in Chrome on ChromeOS to test input events")
    print("Events will be logged here and in the browser")
    HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()

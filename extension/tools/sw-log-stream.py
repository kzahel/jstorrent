#!/usr/bin/env python3

import asyncio
import json
import sys
import websockets
import aiohttp

CHROME_DEBUG_PORT = 9222
EXTENSION_ID = "bnceafpojmnimbnhamaeedgomdcgnbjk"
LOG_FILE = "/tmp/sw-logs.txt"

def log(msg):
    print(f"[sw-log] {msg}", file=sys.stderr, flush=True)

async def find_sw_target():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://localhost:{CHROME_DEBUG_PORT}/json") as resp:
                targets = await resp.json()
    except Exception as e:
        log(f"Cannot reach Chrome: {e}")
        return None
    
    for target in targets:
        url = target.get("url", "")
        if EXTENSION_ID in url:
            return target.get("webSocketDebuggerUrl")
    
    return None

async def watchdog(cancel_event, connected_ws_url):
    log("Watchdog started")
    while not cancel_event.is_set():
        await asyncio.sleep(2)
        current_url = await find_sw_target()
        if current_url != connected_ws_url:
            log(f"Watchdog: URL changed! old={connected_ws_url[-30:]} new={current_url[-30:] if current_url else None}")
            cancel_event.set()
            return

async def read_messages(ws, f, cancel_event):
    while not cancel_event.is_set():
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except websockets.exceptions.ConnectionClosed:
            log("ConnectionClosed in reader")
            cancel_event.set()
            return
        
        data = json.loads(message)
        method = data.get("method", "")
        
        line = None
        if method == "Runtime.consoleAPICalled":
            args = data["params"].get("args", [])
            parts = []
            for a in args:
                if "value" in a:
                    parts.append(str(a["value"]))
                elif "description" in a:
                    parts.append(a["description"])
                else:
                    parts.append(str(a))
            text = " ".join(parts)
            level = data["params"].get("type", "log")
            line = f"[{level}] {text}"
        
        elif method == "Runtime.exceptionThrown":
            exc = data["params"]["exceptionDetails"]
            line = f"[EXCEPTION] {exc.get('text', '')}"
            if "exception" in exc:
                line += f"\n  {exc['exception'].get('description', '')}"
        
        if line:
            f.write(line + "\n")
            f.flush()
            print(line, flush=True)

async def stream_logs():
    f = open(LOG_FILE, "a")
    
    while True:
        ws_url = await find_sw_target()
        if not ws_url:
            log("Waiting for extension...")
            await asyncio.sleep(2)
            continue

        log(f"Connecting to {ws_url[-50:]}")
        f.write("\n--- Connected ---\n")
        f.flush()
        
        try:
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({"id": 1, "method": "Console.enable"}))
                await ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
                log("Enabled Console and Runtime")
                
                cancel_event = asyncio.Event()
                
                reader_task = asyncio.create_task(read_messages(ws, f, cancel_event))
                watchdog_task = asyncio.create_task(watchdog(cancel_event, ws_url))
                
                done, pending = await asyncio.wait(
                    [reader_task, watchdog_task],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                log(f"Task completed")
                
                for t in pending:
                    t.cancel()
                    try:
                        await t
                    except asyncio.CancelledError:
                        pass
                        
        except Exception as e:
            log(f"Error: {type(e).__name__}: {e}")
        
        f.write("--- Disconnected ---\n")
        f.flush()
        log("Reconnecting in 1s...")
        await asyncio.sleep(1)

if __name__ == "__main__":
    log("Starting")
    asyncio.run(stream_logs())

#!/usr/bin/env python3
"""reload-extension.py - Reload extension via CDP"""

import asyncio
import json
import sys
import aiohttp
import websockets

CHROME_DEBUG_PORT = 9222
EXTENSION_ID = "bnceafpojmnimbnhamaeedgomdcgnbjk"  # or partial match


async def reload():
    # Find extension target
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://localhost:{CHROME_DEBUG_PORT}/json") as resp:
            targets = await resp.json()
    
    ws_url = None
    for target in targets:
        if EXTENSION_ID in target.get("url", ""):
            ws_url = target["webSocketDebuggerUrl"]
            break
    
    if not ws_url:
        print("Extension not found", file=sys.stderr)
        sys.exit(1)
    
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": "chrome.runtime.reload()"}
        }))
        # Don't wait for response - the connection dies on reload
        print("Reload triggered")

if __name__ == "__main__":
    asyncio.run(reload())

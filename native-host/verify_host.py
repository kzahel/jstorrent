import subprocess
import struct
import json
import sys
import os
import base64
import time
import socket
import threading
import shutil

HOST_BINARY = "./target/debug/jstorrent-host"
DOWNLOAD_ROOT = os.path.abspath("./test_downloads")

def send_message(proc, msg):
    json_msg = json.dumps(msg).encode('utf-8')
    length = len(json_msg)
    proc.stdin.write(struct.pack('<I', length))
    proc.stdin.write(json_msg)
    proc.stdin.flush()

def read_message(proc):
    len_bytes = proc.stdout.read(4)
    if not len_bytes:
        return None
    length = struct.unpack('<I', len_bytes)[0]
    json_msg = proc.stdout.read(length)
    return json.loads(json_msg)

def test_tcp_echo():
    # Start a simple TCP echo server
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.bind(('127.0.0.1', 0))
    server_sock.listen(1)
    port = server_sock.getsockname()[1]
    
    def echo_server():
        conn, addr = server_sock.accept()
        while True:
            data = conn.recv(1024)
            if not data:
                break
            conn.sendall(data)
        conn.close()
        server_sock.close()

    t = threading.Thread(target=echo_server)
    t.start()
    
    return port, t

def main():
    # Build
    # subprocess.check_call(["cargo", "build"])
    
    # Clean up test dir
    if os.path.exists(DOWNLOAD_ROOT):
        shutil.rmtree(DOWNLOAD_ROOT)
    os.makedirs(DOWNLOAD_ROOT)

    # Start host
    proc = subprocess.Popen(
        [HOST_BINARY],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr
    )

    try:
        # 1. Handshake
        print("Testing Handshake...")
        send_message(proc, {
            "id": "1",
            "op": "handshake",
            "extensionId": "test-extension-id",
            "installId": "test-install-id-123"
        })
        resp = read_message(proc)
        assert resp['id'] == "1"
        assert resp['ok'] == True
        assert resp['type'] == 'DaemonInfo'
        print("Handshake success:", resp)

        print("All tests passed!")

    finally:
        proc.terminate()
        if os.path.exists(DOWNLOAD_ROOT):
            shutil.rmtree(DOWNLOAD_ROOT)

if __name__ == "__main__":
    main()

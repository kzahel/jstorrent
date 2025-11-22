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
        # 1. Set Download Root
        print("Testing SetDownloadRoot...")
        send_message(proc, {
            "id": "1",
            "op": "setDownloadRoot",
            "path": DOWNLOAD_ROOT
        })
        resp = read_message(proc)
        assert resp['id'] == "1"
        assert resp['ok'] == True

        # 2. Ensure Dir
        print("Testing EnsureDir...")
        send_message(proc, {
            "id": "2",
            "op": "ensureDir",
            "path": "subdir"
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        assert os.path.exists(os.path.join(DOWNLOAD_ROOT, "subdir"))

        # 3. Write File
        print("Testing WriteFile...")
        data = b"Hello World"
        data_b64 = base64.b64encode(data).decode('utf-8')
        send_message(proc, {
            "id": "3",
            "op": "writeFile",
            "path": "subdir/test.txt",
            "offset": 0,
            "data": data_b64
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        
        with open(os.path.join(DOWNLOAD_ROOT, "subdir/test.txt"), "rb") as f:
            assert f.read() == data

        # 4. Read File
        print("Testing ReadFile...")
        send_message(proc, {
            "id": "4",
            "op": "readFile",
            "path": "subdir/test.txt",
            "offset": 0,
            "length": len(data)
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        assert resp['data'] == data_b64

        # 5. Stat File
        print("Testing StatFile...")
        send_message(proc, {
            "id": "5",
            "op": "statFile",
            "path": "subdir/test.txt"
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        assert resp['size'] == len(data)

        # 6. Atomic Move
        print("Testing AtomicMove...")
        send_message(proc, {
            "id": "6",
            "op": "atomicMove",
            "from": "subdir/test.txt",
            "to": "subdir/moved.txt",
            "overwrite": False
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        assert not os.path.exists(os.path.join(DOWNLOAD_ROOT, "subdir/test.txt"))
        assert os.path.exists(os.path.join(DOWNLOAD_ROOT, "subdir/moved.txt"))

        # 7. Hashing
        print("Testing HashSha1...")
        send_message(proc, {
            "id": "7",
            "op": "hashSha1",
            "data": data_b64
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        # SHA1 of "Hello World" is 0a4d55a8d778e5022fab701977c5d840bbc486d0
        assert resp['hash'] == "0a4d55a8d778e5022fab701977c5d840bbc486d0"

        # 8. TCP Echo
        print("Testing TCP Echo...")
        port, server_thread = test_tcp_echo()
        
        # Open TCP
        send_message(proc, {
            "id": "8",
            "op": "openTcp",
            "host": "127.0.0.1",
            "port": port
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        socket_id = resp['socketId']

        # Write TCP
        send_message(proc, {
            "id": "9",
            "op": "writeTcp",
            "socketId": socket_id,
            "data": data_b64
        })
        resp = read_message(proc)
        assert resp['ok'] == True

        # Read Event (Echo)
        # We might get multiple chunks or one.
        # Wait for event
        event = read_message(proc)
        # It should be a tcpData event
        assert event['event'] == 'tcpData'
        assert event['socketId'] == socket_id
        assert event['data'] == data_b64

        # Close TCP
        send_message(proc, {
            "id": "10",
            "op": "closeTcp",
            "socketId": socket_id
        })
        resp = read_message(proc)
        assert resp['ok'] == True
        
        server_thread.join()

        print("All tests passed!")

    finally:
        proc.terminate()
        if os.path.exists(DOWNLOAD_ROOT):
            shutil.rmtree(DOWNLOAD_ROOT)

if __name__ == "__main__":
    main()

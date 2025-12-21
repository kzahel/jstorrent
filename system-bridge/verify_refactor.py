import sys
import json
import struct
import socket
import time
import base64
import os
import subprocess
import threading
import hashlib
import random

# Constants
OP_CLIENT_HELLO = 0x01
OP_SERVER_HELLO = 0x02
OP_AUTH = 0x03
OP_AUTH_RESULT = 0x04
OP_ERROR = 0x7F

OP_TCP_CONNECT = 0x10
OP_TCP_CONNECTED = 0x11
OP_TCP_SEND = 0x12
OP_TCP_RECV = 0x13
OP_TCP_CLOSE = 0x14

OP_UDP_BIND = 0x20
OP_UDP_BOUND = 0x21
OP_UDP_SEND = 0x22
OP_UDP_RECV = 0x23
OP_UDP_CLOSE = 0x24

PROTOCOL_VERSION = 1

class SimpleWebSocket:
    def __init__(self, host, port, path="/io"):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect((host, port))
        self.handshake(host, port, path)

    def handshake(self, host, port, path):
        key = base64.b64encode(os.urandom(16)).decode('utf-8')
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self.sock.sendall(request.encode('utf-8'))
        response = self.sock.recv(4096).decode('utf-8')
        if "101 Switching Protocols" not in response:
            print(f"WebSocket Handshake Failed. Response:\n{response}")
            raise Exception("WebSocket handshake failed")

    def send_frame(self, data, opcode=0x2):
        # 0x2 = Binary frame
        # Fin = 1, RSV = 0, Opcode = opcode
        byte0 = 0x80 | opcode
        
        length = len(data)
        if length < 126:
            byte1 = 0x80 | length # Mask bit set
            header = struct.pack('!BB', byte0, byte1)
        elif length < 65536:
            byte1 = 0x80 | 126
            header = struct.pack('!BBH', byte0, byte1, length)
        else:
            byte1 = 0x80 | 127
            header = struct.pack('!BBQ', byte0, byte1, length)
            
        mask_key = os.urandom(4)
        masked_data = bytearray(length)
        for i in range(length):
            masked_data[i] = data[i] ^ mask_key[i % 4]
            
        self.sock.sendall(header + mask_key + masked_data)

    def recv_frame(self):
        # Read header
        header = self.sock.recv(2)
        if not header:
            return None
        
        byte0, byte1 = struct.unpack('!BB', header)
        opcode = byte0 & 0x0F
        length = byte1 & 0x7F
        
        if length == 126:
            length = struct.unpack('!H', self.sock.recv(2))[0]
        elif length == 127:
            length = struct.unpack('!Q', self.sock.recv(8))[0]
            
        # Server to client is not masked
        payload = b''
        while len(payload) < length:
            chunk = self.sock.recv(length - len(payload))
            if not chunk:
                break
            payload += chunk
            
        return opcode, payload

    def close(self):
        self.sock.close()

def pack_envelope(msg_type, req_id, payload=b''):
    # Envelope: version(1), msg_type(1), flags(2), request_id(4) - Little Endian
    header = struct.pack('<BBHI', PROTOCOL_VERSION, msg_type, 0, req_id)
    return header + payload

def unpack_envelope(data):
    if len(data) < 8:
        return None, None
    version, msg_type, flags, req_id = struct.unpack('<BBHI', data[:8])
    payload = data[8:]
    return {'version': version, 'msg_type': msg_type, 'flags': flags, 'req_id': req_id}, payload

def send_message(proc, msg):
    msg_json = json.dumps(msg)
    length = len(msg_json)
    proc.stdin.write(struct.pack('=I', length))
    proc.stdin.write(msg_json.encode('utf-8'))
    proc.stdin.flush()

def read_message(proc):
    length_bytes = proc.stdout.read(4)
    if not length_bytes:
        return None
    length = struct.unpack('=I', length_bytes)[0]
    msg_json = proc.stdout.read(length).decode('utf-8')
    return json.loads(msg_json)

def main():
    # Start native host
    import tempfile
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp config dir: {temp_dir}")
        env = os.environ.copy()
        env["JSTORRENT_CONFIG_DIR"] = temp_dir
        
        # Mock extension ID
        args = ["./target/release/jstorrent-host", "chrome-extension://test-extension-id/"]
        
        print("Starting Native Host...")
        proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            env=env
        )

    try:
        # 1. Handshake with Native Host
        print("Testing Handshake...")
        handshake_req = {
            "id": "1",
            "op": "handshake",
            "extensionId": "test-extension-id",
            "installId": "test-install-id-123"
        }
        send_message(proc, handshake_req)
        resp = read_message(proc)
        print(f"Handshake Response: {resp}")
        
        assert resp['type'] == 'DaemonInfo'
        payload = resp['payload']
        port = payload['port']
        token = payload['token']
        print(f"Daemon running on port {port} with token {token}")

        # 2. Connect WebSocket
        print("Connecting to WebSocket...")
        ws = SimpleWebSocket("127.0.0.1", port)
        
        # 3. Protocol Handshake & Auth
        print("Testing Protocol Handshake & Auth...")
        
        # Client Hello
        ws.send_frame(pack_envelope(OP_CLIENT_HELLO, 1))
        op, data = ws.recv_frame()
        env, _ = unpack_envelope(data)
        assert env['msg_type'] == OP_SERVER_HELLO
        print("Received SERVER_HELLO")
        
        # Auth
        # Payload: auth_type(1 byte) + token(utf8)
        auth_payload = b'\x01' + token.encode('utf-8')
        ws.send_frame(pack_envelope(OP_AUTH, 2, auth_payload))
        
        op, data = ws.recv_frame()
        env, payload = unpack_envelope(data)
        assert env['msg_type'] == OP_AUTH_RESULT
        assert payload[0] == 0 # Success
        print("Authentication Successful")

        # 4. TCP Test (Echo)
        # Start a simple TCP echo server
        echo_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        echo_sock.bind(('127.0.0.1', 0))
        echo_sock.listen(1)
        echo_port = echo_sock.getsockname()[1]
        
        def echo_server():
            conn, _ = echo_sock.accept()
            while True:
                data = conn.recv(1024)
                if not data: break
                conn.sendall(data)
            conn.close()
            
        threading.Thread(target=echo_server, daemon=True).start()
        
        print(f"Testing TCP Echo on port {echo_port}...")
        
        # TCP Connect
        # Payload: socketId(4), port(2), hostname(utf8)
        socket_id = 1
        tcp_connect_payload = struct.pack('<IH', socket_id, echo_port) + b'127.0.0.1'
        ws.send_frame(pack_envelope(OP_TCP_CONNECT, 3, tcp_connect_payload))
        
        op, data = ws.recv_frame()
        env, payload = unpack_envelope(data)
        assert env['msg_type'] == OP_TCP_CONNECTED
        assert payload[4] == 0 # Status success
        print("TCP Connected")
        
        # TCP Send
        # Payload: socketId(4) + data
        msg = b"Hello TCP"
        tcp_send_payload = struct.pack('<I', socket_id) + msg
        ws.send_frame(pack_envelope(OP_TCP_SEND, 4, tcp_send_payload))
        
        # TCP Recv
        op, data = ws.recv_frame()
        env, payload = unpack_envelope(data)
        assert env['msg_type'] == OP_TCP_RECV
        recv_socket_id = struct.unpack('<I', payload[:4])[0]
        recv_data = payload[4:]
        assert recv_socket_id == socket_id
        assert recv_data == msg
        print("TCP Echo Received")
        
        # TCP Close
        ws.send_frame(pack_envelope(OP_TCP_CLOSE, 5, struct.pack('<I', socket_id)))
        
        # Expect TCP_CLOSE from server confirming closure (or async close)
        op, data = ws.recv_frame()
        env, payload = unpack_envelope(data)
        if env['msg_type'] == OP_TCP_CLOSE:
            print("TCP Closed by server")
        else:
            print(f"Unexpected message after TCP Close: {env}")
        
        # 5. UDP Test (Echo)
        # Start a simple UDP echo server
        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_sock.bind(('127.0.0.1', 0))
        udp_port = udp_sock.getsockname()[1]
        
        def udp_echo_server():
            while True:
                data, addr = udp_sock.recvfrom(1024)
                udp_sock.sendto(data, addr)
                
        threading.Thread(target=udp_echo_server, daemon=True).start()
        
        print(f"Testing UDP Echo on port {udp_port}...")
        
        # UDP Bind
        # Payload: socketId(4), port(2), bind_addr(string)
        udp_socket_id = 2
        udp_bind_payload = struct.pack('<IH', udp_socket_id, 0) # Bind to any port
        ws.send_frame(pack_envelope(OP_UDP_BIND, 6, udp_bind_payload))
        
        op, data = ws.recv_frame()
        env, payload = unpack_envelope(data)
        if env['msg_type'] != OP_UDP_BOUND:
            print(f"UDP Bind Failed. Received: {env} Payload: {payload}")
        assert env['msg_type'] == OP_UDP_BOUND
        assert payload[4] == 0 # Success
        print("UDP Bound")
        
        # UDP Send
        # Payload: socketId(4), dest_port(2), dest_addr_len(2), dest_addr, data
        dest_addr = b'127.0.0.1'
        udp_send_payload = struct.pack('<IHH', udp_socket_id, udp_port, len(dest_addr)) + dest_addr + msg
        ws.send_frame(pack_envelope(OP_UDP_SEND, 7, udp_send_payload))
        
        # UDP Recv
        op, data = ws.recv_frame()
        env, payload = unpack_envelope(data)
        assert env['msg_type'] == OP_UDP_RECV
        # Layout: socketId(4) + port(2) + addr_len(2) + addr + data
        recv_sid = struct.unpack('<I', payload[:4])[0]
        assert recv_sid == udp_socket_id
        # Skip parsing the rest for brevity, just check data at end
        assert payload.endswith(msg)
        print("UDP Echo Received")
        
        ws.close()
        print("All tests passed!")

    finally:
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    main()

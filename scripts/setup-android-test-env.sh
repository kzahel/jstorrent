#!/bin/bash
# Setup Android test environment in Claude Code's sandboxed environment
# This script solves the Java proxy authentication issue by running a local
# forwarding proxy that handles authentication.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$PROJECT_ROOT/android"
SDK_DIR="/opt/android-sdk"
PROXY_PORT=18080
GRADLE_VERSION="8.13"
GRADLE_HOME="$HOME/.gradle/wrapper/dists/gradle-$GRADLE_VERSION-bin/anydir/gradle-$GRADLE_VERSION"

echo "=== Setting up Android test environment ==="

# Check if proxy is already running
if curl -s --connect-timeout 2 -x http://127.0.0.1:$PROXY_PORT https://dl.google.com > /dev/null 2>&1; then
    echo "Local proxy already running on port $PROXY_PORT"
else
    echo "Starting local forwarding proxy..."

    # Create the proxy script
    cat > /tmp/local_proxy.py << 'PYEOF'
#!/usr/bin/env python3
"""Local proxy that forwards requests through an authenticated upstream proxy."""
import socket
import threading
import os
import base64
from urllib.parse import urlparse

LISTEN_PORT = 18080
UPSTREAM_PROXY = os.environ.get('https_proxy') or os.environ.get('HTTP_PROXY')

def extract_proxy_info(proxy_url):
    parsed = urlparse(proxy_url)
    return parsed.hostname, parsed.port or 8080, parsed.username, parsed.password

def create_proxy_auth_header(user, password):
    if user and password:
        credentials = f"{user}:{password}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Proxy-Authorization: Basic {encoded}\r\n"
    return ""

def handle_client(client_socket):
    try:
        request = client_socket.recv(8192)
        if not request:
            return

        first_line = request.split(b'\r\n')[0].decode()
        method, target, _ = first_line.split(' ')

        proxy_host, proxy_port, proxy_user, proxy_pass = extract_proxy_info(UPSTREAM_PROXY)
        auth_header = create_proxy_auth_header(proxy_user, proxy_pass)

        upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        upstream.connect((proxy_host, proxy_port))

        if method == 'CONNECT':
            connect_request = f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n{auth_header}\r\n"
            upstream.send(connect_request.encode())

            response = upstream.recv(4096)
            response_str = response.decode('utf-8', errors='ignore')

            if '200' in response_str.split('\r\n')[0]:
                client_socket.send(b'HTTP/1.1 200 Connection Established\r\n\r\n')

                def forward(src, dst):
                    try:
                        while True:
                            data = src.recv(8192)
                            if not data:
                                break
                            dst.send(data)
                    except:
                        pass

                t1 = threading.Thread(target=forward, args=(client_socket, upstream), daemon=True)
                t2 = threading.Thread(target=forward, args=(upstream, client_socket), daemon=True)
                t1.start()
                t2.start()
                t1.join()
                t2.join()
            else:
                client_socket.send(response)
        else:
            header_end = request.find(b'\r\n')
            rest = request[header_end:]
            new_request = request[:header_end] + b'\r\n' + auth_header.encode() + rest[2:]
            upstream.send(new_request)

            while True:
                data = upstream.recv(8192)
                if not data:
                    break
                client_socket.send(data)

        upstream.close()
    except Exception as e:
        pass
    finally:
        client_socket.close()

def main():
    if not UPSTREAM_PROXY:
        print("No proxy configured, exiting")
        return

    print(f"Starting local proxy on port {LISTEN_PORT}")

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', LISTEN_PORT))
    server.listen(50)

    print(f"Listening on 127.0.0.1:{LISTEN_PORT}")

    while True:
        client_socket, addr = server.accept()
        t = threading.Thread(target=handle_client, args=(client_socket,), daemon=True)
        t.start()

if __name__ == '__main__':
    main()
PYEOF

    python3 /tmp/local_proxy.py &
    sleep 2
    echo "Proxy started"
fi

# Check/Install Android SDK
if [ ! -d "$SDK_DIR/platforms/android-35" ]; then
    echo "Installing Android SDK..."
    mkdir -p "$SDK_DIR"

    if [ ! -f "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
        echo "Downloading SDK command line tools..."
        curl -L -o /tmp/cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
        unzip -q -o /tmp/cmdline-tools.zip -d "$SDK_DIR"
        mkdir -p "$SDK_DIR/cmdline-tools/latest"
        mv "$SDK_DIR/cmdline-tools/"* "$SDK_DIR/cmdline-tools/latest/" 2>/dev/null || true
    fi

    echo "Installing SDK platform and build tools..."
    printf 'y\n' | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" \
        --proxy=http --proxy_host=127.0.0.1 --proxy_port=$PROXY_PORT \
        "platforms;android-35" "build-tools;35.0.0"
fi

# Check/Install Gradle
if [ ! -f "$GRADLE_HOME/bin/gradle" ]; then
    echo "Installing Gradle $GRADLE_VERSION..."
    mkdir -p "$(dirname "$GRADLE_HOME")"
    curl -L -o /tmp/gradle-$GRADLE_VERSION-bin.zip \
        "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
    unzip -q -o /tmp/gradle-$GRADLE_VERSION-bin.zip -d "$(dirname "$GRADLE_HOME")"
fi

# Setup local.properties
if [ ! -f "$ANDROID_DIR/local.properties" ]; then
    echo "sdk.dir=$SDK_DIR" > "$ANDROID_DIR/local.properties"
    echo "Created local.properties"
fi

# Configure gradle.properties for proxy
if ! grep -q "systemProp.http.proxyHost=127.0.0.1" "$ANDROID_DIR/gradle.properties"; then
    echo "" >> "$ANDROID_DIR/gradle.properties"
    echo "# Proxy configuration (auto-added for sandboxed environment)" >> "$ANDROID_DIR/gradle.properties"
    echo "systemProp.http.proxyHost=127.0.0.1" >> "$ANDROID_DIR/gradle.properties"
    echo "systemProp.http.proxyPort=$PROXY_PORT" >> "$ANDROID_DIR/gradle.properties"
    echo "systemProp.https.proxyHost=127.0.0.1" >> "$ANDROID_DIR/gradle.properties"
    echo "systemProp.https.proxyPort=$PROXY_PORT" >> "$ANDROID_DIR/gradle.properties"
    echo "Added proxy settings to gradle.properties"
fi

echo ""
echo "=== Setup complete ==="
echo "Gradle: $GRADLE_HOME/bin/gradle"
echo "Android SDK: $SDK_DIR"
echo ""
echo "To run tests:"
echo "  cd $ANDROID_DIR && $GRADLE_HOME/bin/gradle testDebugUnitTest"
echo ""
echo "Remember to run 'git checkout android/gradle.properties' before committing"

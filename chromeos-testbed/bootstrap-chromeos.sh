#!/bin/bash
# ChromeOS SSH Bootstrap
# Run as root on VT2: curl -sL kyle.graehl.org/bootstrap-chromeos.sh | bash

set -e

SSH_DIR="/mnt/stateful_partition/etc/ssh"
AUTH_DIR="$SSH_DIR/root_ssh"
PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGG4okLi4gfxBhlAmOoUrYM6Cs/JGQQlsmeOFHLwEwSk kgraehl@zblinux"
PORT=2223

echo "[+] Setting up SSH on ChromeOS host..."

# Create directories
mkdir -p "$AUTH_DIR"
chmod 700 "$AUTH_DIR"

# Generate host keys if needed
[ -f "$SSH_DIR/ssh_host_ed25519_key" ] || ssh-keygen -t ed25519 -f "$SSH_DIR/ssh_host_ed25519_key" -N "" -q
[ -f "$SSH_DIR/ssh_host_rsa_key" ] || ssh-keygen -t rsa -b 4096 -f "$SSH_DIR/ssh_host_rsa_key" -N "" -q

# Add authorized key
echo "$PUBKEY" > "$AUTH_DIR/authorized_keys"
chmod 600 "$AUTH_DIR/authorized_keys"

# Create start script for reboots
cat > "$SSH_DIR/start_sshd.sh" << 'SCRIPT'
#!/bin/bash
iptables -I INPUT 3 -p tcp --dport 2223 -j ACCEPT 2>/dev/null
pkill -f "sshd.*-p 2223" 2>/dev/null
/usr/sbin/sshd -p 2223 -o AuthorizedKeysFile=/mnt/stateful_partition/etc/ssh/root_ssh/authorized_keys -o StrictModes=no
IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1)
echo "[+] sshd on port 2223 - Connect: ssh -p 2223 root@$IP"
SCRIPT
chmod +x "$SSH_DIR/start_sshd.sh"

# Start now
iptables -I INPUT 3 -p tcp --dport $PORT -j ACCEPT
/usr/sbin/sshd -p $PORT -o AuthorizedKeysFile="$AUTH_DIR/authorized_keys" -o StrictModes=no

IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1)
echo ""
echo "=========================================="
echo "[+] SSH ready! Connect with:"
echo "    ssh -p $PORT root@$IP"
echo ""
echo "After reboot, run:"
echo "    bash /mnt/stateful_partition/etc/ssh/start_sshd.sh"
echo "=========================================="

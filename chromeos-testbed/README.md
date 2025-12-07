# ChromeOS Testbed

Automated testing infrastructure for ChromeOS devices. Enables remote control of a Chromebook for UI automation, screenshots, and input injection.

## Prerequisites

- Chromebook in **Developer Mode** ([instructions](https://chromium.googlesource.com/chromiumos/docs/+/main/developer_mode.md))
- Access to VT2 terminal (Ctrl+Alt+F2 on Chromebook)
- Network connectivity between your machine and the Chromebook

## Quick Start

### 1. Bootstrap SSH Access

On the Chromebook, switch to VT2 (Ctrl+Alt+F2), log in as `chronos`, then run:

```bash
sudo dev_install # installs dev tools, probably needed, not sure
sudo bash
curl -sL kyle.graehl.org/bootstrap-chromeos.sh | bash
```

This will:
- Set up SSH server on port 2223
- Configure public key authentication
- Open the firewall
- Display connection instructions

### 2. Connect via SSH

From your development machine:

```bash
ssh -p 2223 root@<chromebook-ip>
```

### 3. After Reboot

The firewall rules reset on reboot. Re-enable SSH access by running on VT2:

```bash
sudo bash /mnt/stateful_partition/etc/ssh/start_sshd.sh
```

## Components

| Component | Description |
|-----------|-------------|
| [bootstrap-chromeos.sh](bootstrap-chromeos.sh) | One-time setup script for SSH access |
| [chromeos-mcp/](chromeos-mcp/) | MCP server for Claude integration (screenshots, tap, swipe, type) |
| [C2/](C2/) | Legacy file-based command channel (deprecated) |

## Architecture

```
Development Machine              Chromebook (Developer Mode)
┌─────────────────────┐          ┌─────────────────────┐
│                     │          │                     │
│  Claude / Agent     │          │  VT2 (root shell)   │
│       │             │   SSH    │       │             │
│       ▼             │ ──────── │       ▼             │
│  MCP Server         │  :2223   │  client.py          │
│  (mcp_chromeos.py)  │          │  - Input injection  │
│                     │          │  - Screenshots      │
└─────────────────────┘          └─────────────────────┘
```

## MCP Integration

See [chromeos-mcp/README.md](chromeos-mcp/README.md) for setting up the MCP server, which exposes these tools to Claude:

- `screenshot` - Capture the screen
- `tap` / `swipe` - Touch input
- `type_text` / `press_keys` - Keyboard input

## File Locations on Chromebook

| Path | Description |
|------|-------------|
| `/mnt/stateful_partition/etc/ssh/` | SSH keys and config (persists across updates) |
| `/mnt/stateful_partition/c2/` | MCP client scripts |
| `/home/chronos/user/MyFiles/Downloads/` | Shared folder accessible from Chrome UI |

## Troubleshooting

**Can't connect via SSH after reboot?**
- Run `start_sshd.sh` on VT2 to re-enable the firewall rule and start sshd

**Connection refused on port 2223?**
- Verify sshd is running: `ps aux | grep sshd`
- Check firewall: `iptables -L INPUT -n | grep 2223`

**Permission denied (publickey)?**
- Verify your public key matches the one in `/mnt/stateful_partition/etc/ssh/root_ssh/authorized_keys`

# ChromeOS C2 (Command & Control) Setup

A file-based command channel for controlling ChromeOS from Crostini.

## Overview: What Runs Where

This system involves **two environments on the same ChromeOS device**:

| Environment | What it is | How to access |
|-------------|------------|---------------|
| **Crostini** | Linux container (Debian) | Open "Terminal" app in ChromeOS |
| **VT2** | ChromeOS root shell | Press Ctrl+Alt+F2 on the Chromebook |

```
┌─────────────────────────────────────────────────────────────┐
│                    ChromeOS Device                          │
│                                                             │
│  ┌──────────────┐              ┌──────────────────────┐    │
│  │   Crostini   │   shared     │      VT2 Shell       │    │
│  │   (Linux)    │◄──folder────►│   (root on ChromeOS) │    │
│  │              │              │                      │    │
│  │ You write    │  .c2/cmd     │ client.sh reads cmd  │    │
│  │ commands     │─────────────►│ and executes it      │    │
│  │              │              │                      │    │
│  │ You read     │  .c2/out     │ writes output here   │    │
│  │ results      │◄─────────────│                      │    │
│  └──────────────┘              └──────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**If accessing remotely**: SSH into Crostini first, then use the C2 channel from there.

## Remote Access via SSH

To control the Chromebook remotely from another machine:

### Prerequisites
1. SSH server running in Crostini (install with `sudo apt install openssh-server`)
2. SSH config on your local machine with a host alias (e.g., `chromeos`)

### Example SSH config (~/.ssh/config)
```
Host chromeos
    HostName <chromebook-ip-or-hostname>
    User <your-crostini-username>
```

### Sending commands remotely
```bash
# Send a command and read output
ssh chromeos "echo 'whoami' > /mnt/chromeos/MyFiles/Downloads/WSC/.c2/cmd && sleep 0.5 && cat /mnt/chromeos/MyFiles/Downloads/WSC/.c2/out"

# Take a screenshot
ssh chromeos "echo 'cd /home/chronos/user/MyFiles/Downloads/WSC/.c2 && python3 input.py screenshot' > /mnt/chromeos/MyFiles/Downloads/WSC/.c2/cmd && sleep 3 && cat /mnt/chromeos/MyFiles/Downloads/WSC/.c2/out"

# Copy screenshot locally
scp chromeos:/mnt/chromeos/MyFiles/Downloads/WSC/.c2/latest.png ./screenshot.png
```

## Prerequisites

### [CHROMEOS UI] Create and share the WSC folder

1. Open **Files** app on ChromeOS
2. Navigate to **Downloads**
3. Create a folder named **WSC**
4. Right-click **WSC** → Select **"Share with Linux"**

### [CROSTINI] Create the .c2 subdirectory

Open the Terminal app and run:
```bash
mkdir -p /mnt/chromeos/MyFiles/Downloads/WSC/.c2
```

### [CROSTINI] Deploy the scripts

Copy the C2 scripts to the shared folder:
```bash
# Assuming you have this repo cloned in Crostini
cp ~/path/to/chromeos-testbed/C2/input.py /mnt/chromeos/MyFiles/Downloads/WSC/.c2/
cp ~/path/to/chromeos-testbed/C2/client.sh /mnt/chromeos/MyFiles/Downloads/WSC/.c2/
chmod +x /mnt/chromeos/MyFiles/Downloads/WSC/.c2/*.py
chmod +x /mnt/chromeos/MyFiles/Downloads/WSC/.c2/*.sh
```

## Starting the C2 Client

### [VT2] Switch to VT2 and start the client

1. On the Chromebook keyboard, press **Ctrl+Alt+F2** (or Ctrl+Alt+→)
2. Log in:
   ```
   localhost login: chronos
   Password: [just press Enter]
   ```
3. Get root and start the client:
   ```bash
   sudo bash
   cd /home/chronos/user/MyFiles/Downloads/WSC/.c2
   bash client.sh
   ```

The client is now polling for commands. Leave this running.

To return to Chrome UI: press **Ctrl+Alt+F1** (or Ctrl+Alt+←)

## Sending Commands

### [CROSTINI] Send a command and read output

```bash
# Write a command to the cmd file
echo "whoami" > /mnt/chromeos/MyFiles/Downloads/WSC/.c2/cmd

# Wait for execution
sleep 0.5

# Read the output
cat /mnt/chromeos/MyFiles/Downloads/WSC/.c2/out
```

### [CROSTINI] Helper script (optional)

Create `~/c2-run.sh` for convenience:
```bash
#!/bin/bash
C2="/mnt/chromeos/MyFiles/Downloads/WSC/.c2"
echo "$1" > "$C2/cmd"
sleep 0.5
cat "$C2/out"
```

Then use: `~/c2-run.sh "ls -la /home"`

## Input Control

The `input.py` script runs **on VT2** (as root) to control keyboard, mouse, and screenshots.

### [VT2] Direct usage (if you're on VT2)

```bash
cd /home/chronos/user/MyFiles/Downloads/WSC/.c2
python3 input.py screenshot
python3 input.py key 125 63      # Search+F5
python3 input.py move 100 50
python3 input.py click
```

### [CROSTINI] Via C2 channel

```bash
# Take a screenshot
echo "cd /home/chronos/user/MyFiles/Downloads/WSC/.c2 && python3 input.py screenshot" \
  > /mnt/chromeos/MyFiles/Downloads/WSC/.c2/cmd
sleep 3
# Screenshot is now at: /mnt/chromeos/MyFiles/Downloads/WSC/.c2/latest.png

# Tap at specific coordinates (RECOMMENDED - precise)
echo "cd /home/chronos/user/MyFiles/Downloads/WSC/.c2 && python3 input.py tap 500 300" \
  > /mnt/chromeos/MyFiles/Downloads/WSC/.c2/cmd

# Swipe gesture
echo "cd /home/chronos/user/MyFiles/Downloads/WSC/.c2 && python3 input.py swipe 100 500 800 500" \
  > /mnt/chromeos/MyFiles/Downloads/WSC/.c2/cmd
```

## input.py Commands

### Diagnostics

| Command | Example | Description |
|---------|---------|-------------|
| info | `python3 input.py info` | Show detected touchscreen device, coordinate ranges, and screen resolution |

Run `info` first to verify your touchscreen is detected correctly.

### Touchscreen (RECOMMENDED - precise absolute positioning)

| Command | Example | Description |
|---------|---------|-------------|
| tap | `python3 input.py tap 500 300` | Tap at absolute screen coordinates (500, 300) |
| swipe | `python3 input.py swipe 100 500 800 500` | Swipe from (100,500) to (800,500) |
| resolution | `python3 input.py resolution 1600 900` | Set logical screen resolution for tap coordinates |

**Note**: Touchscreen device and coordinate ranges are auto-detected. Use `info` to see detected values.

### Other Commands

| Command | Example | Description |
|---------|---------|-------------|
| screenshot | `python3 input.py screenshot` | Takes screenshot via Search+F5, copies to `.c2/latest.png` |
| key | `python3 input.py key 125 63` | Press key combination (Search+F5) |
| type | `python3 input.py type "hello"` | Type text characters |
| move | `python3 input.py move 100 -50` | Move mouse by (dx, dy) - imprecise due to acceleration |
| click | `python3 input.py click` | Left click (also: `right`, `middle`) |
| drag | `python3 input.py drag 200 0` | Hold left button, move, release |

## Key Codes Reference

| Key | Code | Key | Code |
|-----|------|-----|------|
| Search/Meta | 125 | F5 | 63 |
| Ctrl | 29 | Alt | 56 |
| Shift | 42 | Tab | 15 |
| Enter | 28 | Space | 57 |
| Esc | 1 | Backspace | 14 |

**Note**: Screenshot uses Search+F5 (keys 125+63). If you have remapped Search/Ctrl, adjust accordingly.

## File Locations Summary

| What | Crostini Path | VT2 Path |
|------|---------------|----------|
| C2 directory | `/mnt/chromeos/MyFiles/Downloads/WSC/.c2/` | `/home/chronos/user/MyFiles/Downloads/WSC/.c2/` |
| Command file | `.c2/cmd` | `.c2/cmd` |
| Output file | `.c2/out` | `.c2/out` |
| Latest screenshot | `.c2/latest.png` | `.c2/latest.png` |
| ChromeOS screenshots | (not directly accessible) | `/home/chronos/user/MyFiles/Downloads/Screenshot*.png` |

## Switching Virtual Terminals

| Shortcut | What |
|----------|------|
| Ctrl+Alt+F1 (or ←) | VT1 - Chrome UI (normal desktop) |
| Ctrl+Alt+F2 (or →) | VT2 - Root shell (where client.sh runs) |

## Troubleshooting

### Commands not executing
- Make sure `client.sh` is running on VT2
- Check that VT2 is logged in as root (`sudo bash`)

### Screenshot not appearing
- The Chrome UI (VT1) must be visible when taking screenshot
- Check that screenshots save to Downloads: `/home/chronos/user/MyFiles/Downloads/Screenshot*.png`

### Permission denied
- VT2 commands must run as root
- The WSC folder must be shared with Linux in ChromeOS settings

### Tap not working or hitting wrong position
1. Run `python3 input.py info` to check detected settings:
   - Verify a touchscreen device was found
   - Check that Max X/Y values are non-zero
2. **IMPORTANT**: Set resolution to the **logical display resolution**, NOT the screenshot dimensions:
   - Screenshots may capture at 4K (3840x2160) but the logical resolution is often 1600x900 or similar
   - Check logical resolution: open the debug page or browser dev tools (screen.width/height)
   - Common setup: `python3 input.py resolution 1600 900`
   - The touchscreen coordinates map to the logical resolution, not the captured image size
3. If touchscreen not detected:
   - Check permissions: must run as root on VT2
   - List devices: `ls -la /dev/input/event*`
4. To clear cached config and force re-detection:
   - Delete `/home/chronos/user/MyFiles/Downloads/WSC/.c2/touchscreen.txt`

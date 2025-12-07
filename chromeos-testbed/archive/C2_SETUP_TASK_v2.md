# ChromeOS C2 Setup Task (File-Based)

You are setting up a fast file-based command-and-control channel between ChromeOS host and Crostini using the shared Downloads folder.

## Architecture

```
ChromeOS VT2 (root)  <--shared filesystem-->  Crostini  <--SSH-->  Agent (you)
       |                                          |
       | polls .c2/cmd every 0.1s                 | writes .c2/cmd
       | writes .c2/out                           | reads .c2/out
```

**Shared paths:**
- Crostini: `/mnt/chromeos/MyFiles/Downloads/.c2/`
- ChromeOS: `/home/chronos/user/MyFiles/Downloads/.c2/`

## Your Tasks

### 1. SSH into Crostini

```bash
ssh chromeos
```

### 2. Create the C2 directory and client script

```bash
mkdir -p /mnt/chromeos/MyFiles/Downloads/.c2
cd /mnt/chromeos/MyFiles/Downloads/.c2
```

Create the ChromeOS client script at `/mnt/chromeos/MyFiles/Downloads/.c2/client.sh`:

```bash
#!/bin/bash
# C2 client - runs on ChromeOS VT2 as root
DIR="/home/chronos/user/MyFiles/Downloads/.c2"
CMD="$DIR/cmd"
OUT="$DIR/out"
LOCK="$DIR/lock"

echo "[c2] Client started, polling $CMD"

while true; do
    if [ -s "$CMD" ]; then
        # Atomic read and clear
        if mkdir "$LOCK" 2>/dev/null; then
            C=$(cat "$CMD")
            > "$CMD"
            rmdir "$LOCK"
            
            if [ -n "$C" ]; then
                echo "[c2] >>> $C"
                # Execute and capture output
                OUTPUT=$(eval "$C" 2>&1)
                echo "$OUTPUT" > "$OUT"
                echo "[c2] <<< done ($(echo "$OUTPUT" | wc -l) lines)"
            fi
        fi
    fi
    sleep 0.1
done
```

Make it executable:
```bash
chmod +x /mnt/chromeos/MyFiles/Downloads/.c2/client.sh
```

Create empty command and output files:
```bash
touch /mnt/chromeos/MyFiles/Downloads/.c2/cmd
touch /mnt/chromeos/MyFiles/Downloads/.c2/out
```

### 3. Tell the user to start the client

Tell the user:

> **Setup ready!** On VT2, type this (38 chars):
> ```
> bash ~/MyFiles/Downloads/.c2/client.sh
> ```
> 
> Let me know when it's running and I'll test.

### 4. Wait for user confirmation, then test

Once user confirms client is running, test:

```bash
echo 'echo hello from chromeos' > /mnt/chromeos/MyFiles/Downloads/.c2/cmd
sleep 0.3
cat /mnt/chromeos/MyFiles/Downloads/.c2/out
```

You should see "hello from chromeos".

### 5. Helper function for running commands

For convenience, create this helper script at `~/c2-run.sh` in Crostini:

```bash
#!/bin/bash
# Usage: ~/c2-run.sh "command"
C2="/mnt/chromeos/MyFiles/Downloads/.c2"

echo "$1" > "$C2/cmd"

# Wait for output (with timeout)
for i in {1..50}; do
    if [ -s "$C2/out" ] && [ ! -d "$C2/lock" ]; then
        cat "$C2/out"
        > "$C2/out"
        exit 0
    fi
    sleep 0.1
done
echo "[timeout]"
```

Make executable:
```bash
chmod +x ~/c2-run.sh
```

Now you can run commands easily:
```bash
~/c2-run.sh "whoami"
~/c2-run.sh "ls -la /dev/fb*"
~/c2-run.sh "cat /etc/os-release"
```

Or from outside Crostini:
```bash
ssh chromeos '~/c2-run.sh "uname -a"'
```

### 6. Useful exploration commands

```bash
# Check framebuffer (for screenshots)
~/c2-run.sh "ls -la /dev/fb* /dev/dri/*"

# Check for screenshot tools
~/c2-run.sh "which fbgrab screenshot"

# Check input devices (for virtual keyboard/mouse)
~/c2-run.sh "ls -la /dev/input/"
~/c2-run.sh "ls -la /dev/uinput"

# System info
~/c2-run.sh "uname -a"
~/c2-run.sh "cat /etc/lsb-release"
```

## Troubleshooting

- **No output appearing**: Check client.sh is running on VT2, check for errors in terminal
- **Stale output**: Clear with `> /mnt/chromeos/MyFiles/Downloads/.c2/out`
- **Permission issues**: Make sure you're root on VT2
- **Shared folder not visible**: Make sure you're logged into ChromeOS GUI (VT1)

## Files Summary

| Location | Path | Purpose |
|----------|------|---------|
| Both | `.c2/cmd` | Command to execute (agent writes, client reads+clears) |
| Both | `.c2/out` | Command output (client writes, agent reads) |
| Both | `.c2/lock` | Mutex directory for atomic operations |
| Both | `.c2/client.sh` | Polling client (runs on ChromeOS VT2) |
| Crostini | `~/c2-run.sh` | Helper to send commands easily |

## Performance

- Poll interval: 100ms
- Typical round-trip: ~200-300ms
- No network involved, pure filesystem

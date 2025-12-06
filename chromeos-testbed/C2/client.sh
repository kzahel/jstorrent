#!/bin/bash
# C2 Client - runs on ChromeOS VT2 as root
# Polls for commands and executes them

DIR="/home/chronos/user/MyFiles/Downloads/WSC/.c2"
CMD="$DIR/cmd"
OUTPUT="$DIR/output"

mkdir -p "$DIR"
touch "$CMD" "$OUTPUT"

echo "C2 client started. Polling $CMD"
echo "Press Ctrl+C to stop"

while true; do
    if [ -s "$CMD" ]; then
        command=$(cat "$CMD")
        echo "" > "$CMD"
        echo "[$(date +%H:%M:%S)] Running: $command"
        eval "$command" > "$OUTPUT" 2>&1
        echo "[$(date +%H:%M:%S)] Done (exit: $?)"
    fi
    sleep 0.1
done

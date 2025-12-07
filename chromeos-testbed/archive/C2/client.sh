#!/bin/bash
# C2 client - runs on ChromeOS VT2 as root
DIR="/home/chronos/user/MyFiles/Downloads/WSC/.c2"
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
                # Execute and capture output (30 second timeout to prevent hangs)
                OUTPUT=$(timeout 30 bash -c "$C" 2>&1)
                EXIT_CODE=$?
                if [ $EXIT_CODE -eq 124 ]; then
                    OUTPUT="TIMEOUT: Command exceeded 30 seconds"
                fi
                echo "$OUTPUT" > "$OUT"
                echo "[c2] <<< done (exit=$EXIT_CODE, $(echo "$OUTPUT" | wc -l) lines)"
            fi
        fi
    fi
    sleep 0.1
done

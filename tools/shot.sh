#!/usr/bin/env bash
# Capture the emulated watch panel from the Zepp OS Simulator.
# Usage: tools/shot.sh <output.png>
set -euo pipefail

OUT="${1:?usage: shot.sh <output.png>}"
COMPAT="${ZEPP_SIM_COMPAT:-$HOME/.local/share/zepp-sim}"
XDOTOOL="$COMPAT/bin/xdotool"
export LD_LIBRARY_PATH="$COMPAT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export DISPLAY="${DISPLAY:-:0}"

QEMU_PID=$(pgrep -x qemu-system-arm | head -1)
[ -n "$QEMU_PID" ] || { echo "emulator is not running" >&2; exit 1; }

# QEMU's SDL backend opens several windows under the same title; the watch
# panel is the only portrait one, and it belongs to the QEMU process.
WIN=""
while read -r id; do
  [ "$("$XDOTOOL" getwindowpid "$id" 2>/dev/null)" = "$QEMU_PID" ] || continue
  geom=$("$XDOTOOL" getwindowgeometry "$id" | awk '/Geometry/ {print $2}')
  [ "${geom%x*}" -lt "${geom#*x}" ] && { WIN="$id"; break; }
done < <("$XDOTOOL" search --name '^Zepp OS Simulator$')

[ -n "$WIN" ] || { echo "watch panel window not found" >&2; exit 1; }

import -window "$WIN" "$OUT"
echo "$OUT $(identify -format '%wx%h' "$OUT")"

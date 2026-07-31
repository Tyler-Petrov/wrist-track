#!/usr/bin/env bash
# Send touch input to the emulated watch panel.
#   tools/input.sh tap  <x> <y>
#   tools/input.sh swipe <x1> <y1> <x2> <y2>
#   tools/input.sh key  <keysym>
# Coordinates are in panel pixels (origin top-left of the watch screen).
set -euo pipefail

COMPAT="${ZEPP_SIM_COMPAT:-$HOME/.local/share/zepp-sim}"
XDOTOOL="$COMPAT/bin/xdotool"
export LD_LIBRARY_PATH="$COMPAT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export DISPLAY="${DISPLAY:-:0}"

QEMU_PID=$(pgrep -x qemu-system-arm | head -1)
[ -n "$QEMU_PID" ] || { echo "emulator is not running" >&2; exit 1; }

WIN=""
while read -r id; do
  [ "$("$XDOTOOL" getwindowpid "$id" 2>/dev/null)" = "$QEMU_PID" ] || continue
  geom=$("$XDOTOOL" getwindowgeometry "$id" | awk '/Geometry/ {print $2}')
  [ "${geom%x*}" -lt "${geom#*x}" ] && { WIN="$id"; break; }
done < <("$XDOTOOL" search --name '^Zepp OS Simulator$')
[ -n "$WIN" ] || { echo "watch panel window not found" >&2; exit 1; }

read -r OX OY < <("$XDOTOOL" getwindowgeometry "$WIN" | awk -F'[ ,]' '/Position/ {print $4, $5}')
"$XDOTOOL" windowactivate "$WIN" 2>/dev/null || true
sleep 0.3

case "${1:?usage: input.sh tap|swipe|key ...}" in
  tap)
    "$XDOTOOL" mousemove $((OX + $2)) $((OY + $3)) click 1
    ;;
  swipe)
    "$XDOTOOL" mousemove $((OX + $2)) $((OY + $3)) mousedown 1
    for step in 1 2 3 4 5 6 7 8; do
      "$XDOTOOL" mousemove \
        $((OX + $2 + ($4 - $2) * step / 8)) \
        $((OY + $3 + ($5 - $3) * step / 8))
      sleep 0.03
    done
    "$XDOTOOL" mouseup 1
    ;;
  key)
    "$XDOTOOL" key --window "$WIN" "$2"
    ;;
  *)
    echo "usage: input.sh tap|swipe|key ..." >&2
    exit 2
    ;;
esac

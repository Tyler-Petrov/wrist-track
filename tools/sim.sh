#!/usr/bin/env bash
# Start/stop the Zepp OS Simulator on Arch-family Linux.
#
# The simulator ships as a Debian package built against libsasl2.so.2, which
# Arch no longer provides, and its QEMU window must stay on X11 so the screen
# can be captured. $COMPAT supplies both.
#
# Usage: tools/sim.sh start|stop|restart|status
set -uo pipefail

COMPAT="${ZEPP_SIM_COMPAT:-$HOME/.local/share/zepp-sim}"
SIM=/opt/simulator/simulator
LOG="${ZEPP_SIM_LOG:-/tmp/zepp-simulator.log}"

ensure_compat() {
  mkdir -p "$COMPAT/lib" "$COMPAT/bin"
  [ -e "$COMPAT/lib/libsasl2.so.2" ] || ln -sf /usr/lib/libsasl2.so.3 "$COMPAT/lib/libsasl2.so.2"
}

cdp_up() {
  local p; p=$(head -1 "$HOME/.config/simulator/DevToolsActivePort" 2>/dev/null) || return 1
  [ -n "$p" ] && curl -sf --max-time 2 "http://127.0.0.1:$p/json/list" >/dev/null 2>&1
}

sim_pid() { pgrep -f '^/opt/simulator/simulator( |$)' | head -1; }

start() {
  [ -n "$(sim_pid)" ] && { echo "already running (pid $(sim_pid))"; return 0; }
  ensure_compat
  # ELECTRON_RUN_AS_NODE is set inside some agent/editor shells and would make
  # the simulator start as a bare Node process and exit immediately.
  setsid nohup env -u ELECTRON_RUN_AS_NODE \
    GDK_BACKEND=x11 \
    DISPLAY="${DISPLAY:-:0}" \
    LD_LIBRARY_PATH="$COMPAT/lib" \
    SDL_VIDEODRIVER=x11 \
    SDL_RENDER_DRIVER=software \
    SDL_FRAMEBUFFER_ACCELERATION=0 \
    "$SIM" >"$LOG" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  for _ in $(seq 1 60); do
    sleep 1
    cdp_up && { echo "started (pid $(sim_pid))"; return 0; }
  done
  echo "simulator did not come up; see $LOG" >&2
  return 1
}

stop() {
  local pid; pid=$(sim_pid)
  [ -z "$pid" ] && { echo "not running"; return 0; }
  kill "$pid" 2>/dev/null
  for _ in $(seq 1 20); do sleep 0.5; [ -z "$(sim_pid)" ] && break; done
  [ -n "$(sim_pid)" ] && kill -9 "$(sim_pid)" 2>/dev/null
  pkill -9 -x qemu-system-arm 2>/dev/null
  echo stopped
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status)
    pid=$(sim_pid)
    [ -n "$pid" ] && echo "running (pid $pid)" || echo "not running"
    ;;
  *) echo "usage: $0 start|stop|restart|status" >&2; exit 2 ;;
esac

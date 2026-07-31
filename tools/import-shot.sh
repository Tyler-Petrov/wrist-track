#!/usr/bin/env bash
# File a screenshot captured with `bridge$ screenshot` into docs/screens/device/.
# Usage: tools/import-shot.sh <name>   e.g. tools/import-shot.sh 03-ready
set -euo pipefail

NAME="${1:?usage: import-shot.sh <name>}"
SRC="${BRIDGE_SHOT:-$HOME/desktop/screenShot.png}"
DEST_DIR="docs/screens/device"

[ -f "$SRC" ] || { echo "no screenshot at $SRC — run 'bridge\$ screenshot' first" >&2; exit 1; }

# The bridge overwrites the same path on every capture, so a run that shows the
# same screen twice silently produces one file. Warn rather than file a copy.
for existing in "$DEST_DIR"/*.png; do
  [ -e "$existing" ] || continue
  if cmp -s "$SRC" "$existing"; then
    echo "warning: identical to $existing — the watch was on the same screen, or the capture did not refresh" >&2
  fi
done

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST_DIR/$NAME.png"
echo "$DEST_DIR/$NAME.png $(identify -format '%wx%h' "$DEST_DIR/$NAME.png")"

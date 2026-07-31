#!/usr/bin/env bash
#
# Prepares a fresh worktree (or a fresh clone) for building WristTrack.
#
# node_modules is gitignored, so a new worktree starts without it — and zeus
# does not fail when it cannot resolve a dependency. It emits a runtime
# `__$$RQR$$__("@zeppos/zml/base-side")` instead of inlining the library and
# builds a package that installs cleanly and then draws nothing on the watch.
# A worktree missing node_modules is therefore a silent black screen, which is
# why this script installs the dependencies and then checks the one that
# actually matters rather than trusting npm's exit code alone.
#
# Runs automatically from the t3code "Init worktree" action on worktree
# creation, and is safe to re-run by hand at any time.
set -euo pipefail

# t3code exports the worktree it just created; outside t3code, use the checkout
# this script lives in.
root="${T3CODE_WORKTREE_PATH:-$(git rev-parse --show-toplevel)}"
cd "$root"

echo "==> Installing dependencies in $root"
npm install --no-audit --no-fund

if [ ! -d node_modules/@zeppos/zml ]; then
  echo "!! @zeppos/zml is missing after npm install." >&2
  echo "   Building from here would produce a package that installs on the" >&2
  echo "   watch and then shows a black screen. Fix the install before you" >&2
  echo "   run 'zeus bridge'." >&2
  exit 1
fi

echo "==> Ready. 'zeus bridge' -> connect -> install will bundle @zeppos/zml."

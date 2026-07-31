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
# this script lives in — resolved from the script's own path, so calling it from
# anywhere still prepares the right directory.
if [ -n "${T3CODE_WORKTREE_PATH:-}" ]; then
  root="$T3CODE_WORKTREE_PATH"
else
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  root="$(git -C "$script_dir" rev-parse --show-toplevel)"
fi
cd "$root"

echo "==> Installing dependencies in $root"
npm install --no-audit --no-fund

# Resolve the two subpaths the app actually imports rather than trusting that the
# package directory exists: a partial install passes a directory check and still
# leaves both sides of the app undefined on the watch.
if ! node -e 'require.resolve("@zeppos/zml/base-side"); require.resolve("@zeppos/zml/base-page")' 2>/dev/null; then
  echo "!! @zeppos/zml does not resolve after npm install." >&2
  echo "   Building from here would produce a package that installs on the" >&2
  echo "   watch and then shows a black screen. Fix the install before you" >&2
  echo "   run 'zeus bridge'." >&2
  exit 1
fi

echo "==> Ready. 'zeus bridge' -> connect -> install will bundle @zeppos/zml."

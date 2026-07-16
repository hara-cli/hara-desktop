#!/usr/bin/env bash
# Shared shell guard for release scripts. In macOS Bash 3.2, a fatal `set -u` expansion inside a
# function can reach an EXIT trap with status zero. The explicit completion sentinel therefore
# distinguishes the one valid success path from every early exit, while cleanup stays best-effort.

hara_exit_with_cleanup() {
  local status="$?"
  local completed="${1:-0}"
  shift
  trap - EXIT
  set +e
  set +u
  "$@" || true
  if [ "$completed" != "1" ] && [ "$status" -eq 0 ]; then
    echo "error: release script exited before its verified completion point" >&2
    status=1
  fi
  exit "$status"
}

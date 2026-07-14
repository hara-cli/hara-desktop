#!/usr/bin/env bash
# Shared release-build toolchain gate. Source this file and call
# `hara_check_build_toolchain`, or execute it directly from the repository root.

hara_toolchain_error() {
  echo "error: $*" >&2
  return 1
}

hara_check_node() {
  local version_file="${HARA_NODE_VERSION_FILE:-.node-version}"
  [ -f "$version_file" ] || {
    hara_toolchain_error "missing pinned Node.js version file: $version_file"
    return 1
  }

  local required detected
  required="$(tr -d '[:space:]' < "$version_file")"
  if ! command -v node >/dev/null 2>&1; then
    hara_toolchain_error "Node.js $required is required to build Hara Desktop. Install it with: nvm install $required && nvm use $required"
    return 1
  fi

  detected="$(node -p 'process.versions.node' 2>/dev/null || true)"
  if [ "$detected" != "$required" ]; then
    hara_toolchain_error "Node.js $required is pinned for release builds (detected ${detected:-unknown}). Upgrade with: nvm install $required && nvm use $required"
    return 1
  fi
  echo "  ✓ Node.js $detected (pinned)"
}

hara_check_bun() {
  local version_file="${HARA_BUN_VERSION_FILE:-.bun-version}"
  [ -f "$version_file" ] || {
    hara_toolchain_error "missing pinned Bun version file: $version_file"
    return 1
  }

  local required detected
  required="$(tr -d '[:space:]' < "$version_file")"
  [ -n "$required" ] || {
    hara_toolchain_error "pinned Bun version is empty: $version_file"
    return 1
  }
  if ! command -v bun >/dev/null 2>&1; then
    hara_toolchain_error "Bun $required is required to compile the standalone sidecar. Install it with: npm install -g bun@$required"
    return 1
  fi
  detected="$(bun --version 2>/dev/null || true)"
  if [ "$detected" != "$required" ]; then
    hara_toolchain_error "Bun $required is pinned for reproducible sidecars (detected ${detected:-unknown}). Install it with: npm install -g bun@$required"
    return 1
  fi
  echo "  ✓ Bun $detected (pinned)"
}

hara_check_rust() {
  local version_file="${HARA_RUST_VERSION_FILE:-.rust-version}"
  [ -f "$version_file" ] || {
    hara_toolchain_error "missing pinned Rust version file: $version_file"
    return 1
  }

  local required
  required="$(tr -d '[:space:]' < "$version_file")"
  if ! command -v rustc >/dev/null 2>&1; then
    hara_toolchain_error "Rust $required is required to build Hara Desktop. Install it with: rustup toolchain install $required"
    return 1
  fi

  local release host active
  release="$(rustc -vV 2>/dev/null | awk '/^release:/{print $2}')"
  host="$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')"
  [ -n "$release" ] && [ -n "$host" ] || {
    hara_toolchain_error "could not read the active Rust toolchain; install it with: rustup toolchain install $required"
    return 1
  }
  if [ "$release" != "$required" ]; then
    hara_toolchain_error "Rust $required is pinned for release builds (detected ${release:-unknown}). Upgrade with: rustup toolchain install $required"
    return 1
  fi
  if command -v rustup >/dev/null 2>&1; then
    active="$(rustup show active-toolchain 2>/dev/null | awk '{print $1}')"
    case "$active" in
      "$required"-*|stable-*) ;;
      *)
        hara_toolchain_error "Rust $required is required (active ${active:-unknown}). Select it with: rustup override set $required"
        return 1
        ;;
    esac
  fi
  echo "  ✓ Rust $release ($host, pinned)"
}

hara_check_build_toolchain() {
  echo "▸ checking release build toolchain"
  hara_check_node
  hara_check_bun
  hara_check_rust
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  cd "$(dirname "$0")/.."
  hara_check_build_toolchain
fi

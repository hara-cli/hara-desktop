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
  local rustc_command cargo_command toolchain_bin
  if command -v rustup >/dev/null 2>&1; then
    rustc_command="$(rustup which --toolchain "$required" rustc 2>/dev/null || true)"
    cargo_command="$(rustup which --toolchain "$required" cargo 2>/dev/null || true)"
    if [ -z "$rustc_command" ] || [ -z "$cargo_command" ]; then
      hara_toolchain_error "Rust $required is required to build Hara Desktop. Install it with: rustup toolchain install $required"
      return 1
    fi
    # A self-hosted macOS runner may put Homebrew's /usr/local/bin ahead of rustup even after the
    # setup action. Select the pinned binaries explicitly for this shell and every Cargo child.
    toolchain_bin="$(dirname "$cargo_command")"
    export PATH="$toolchain_bin:$PATH"
    export RUSTC="$rustc_command"
    export CARGO="$cargo_command"
  else
    rustc_command="$(command -v rustc 2>/dev/null || true)"
    cargo_command="$(command -v cargo 2>/dev/null || true)"
  fi
  if [ -z "$rustc_command" ] || [ -z "$cargo_command" ]; then
    hara_toolchain_error "Rust $required is required to build Hara Desktop. Install it with: rustup toolchain install $required"
    return 1
  fi

  local release host
  release="$("$rustc_command" -vV 2>/dev/null | awk '/^release:/{print $2}')"
  host="$("$rustc_command" -vV 2>/dev/null | awk '/^host:/{print $2}')"
  [ -n "$release" ] && [ -n "$host" ] || {
    hara_toolchain_error "could not read the active Rust toolchain; install it with: rustup toolchain install $required"
    return 1
  }
  if [ "$release" != "$required" ]; then
    hara_toolchain_error "Rust $required is pinned for release builds (detected ${release:-unknown}). Upgrade with: rustup toolchain install $required"
    return 1
  fi
  echo "  ✓ Rust $release ($host, pinned)"
}

hara_check_build_toolchain() {
  echo "▸ checking release build toolchain"
  hara_check_node || return 1
  hara_check_bun || return 1
  hara_check_rust || return 1
}

if [ -n "${BASH_VERSION:-}" ] && [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  cd "$(dirname "$0")/.."
  hara_check_build_toolchain
fi

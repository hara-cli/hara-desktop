# Replaces only Tauri 2.11.4's hdiutil_detach_retry function. All other DMG steps stay upstream.
function hara_dmg_detach_diagnostics() {
  if [[ -n "${HARA_DMG_DIAGNOSTICS_MODULE:-}" && -n "${HARA_DMG_WRAPPER_NODE:-}" ]]; then
    "$HARA_DMG_WRAPPER_NODE" "$HARA_DMG_DIAGNOSTICS_MODULE" "$1" "$$" "$2" "$3" || true
  fi
}

function hdiutil_detach_retry() {
  local detach_device="$1"
  local detach_attempt=1
  local detach_limit="${MAXIMUM_UNMOUNTING_ATTEMPTS:-3}"
  local detach_code=0
  # Keep the upstream maximum (three total attempts), not a caller-controlled unbounded retry.
  case "$detach_limit" in 1|2|3) ;; *) echo 'Invalid DMG detach attempt limit' >&2; return 64 ;; esac
  while [[ "$detach_attempt" -le "$detach_limit" ]]; do
    echo "Unmounting disk image $detach_device (attempt $detach_attempt/$detach_limit)..."
    # The conditional preserves the actual exit status with Bash 3.2 and set -e enabled.
    if hdiutil detach "$detach_device"; then
      return 0
    else
      detach_code=$?
    fi
    hara_dmg_detach_diagnostics "$detach_device" "$detach_code" "$detach_attempt"
    case "$detach_code" in
      2|16) ;; # macOS may report Resource busy as 2 rather than EBUSY's numeric 16.
      *) return "$detach_code" ;;
    esac
    if [[ "$detach_attempt" -eq "$detach_limit" ]]; then
      echo "DMG detach exhausted $detach_limit attempts (last exit $detach_code); retaining image" >&2
      return "$detach_code"
    fi
    sleep "$((1 << detach_attempt))"
    detach_attempt=$((detach_attempt + 1))
  done
  return "$detach_code"
}

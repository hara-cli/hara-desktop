#!/usr/bin/env bash
# Audit the locked production tree against npm's official advisory endpoint. Confirmed vulnerabilities
# and deterministic client/config errors fail immediately; only transient network/service failures are
# retried, with a strict attempt/time bound so a release can never wait forever or bypass the audit.
set -euo pipefail

MAX_ATTEMPTS="${HARA_NPM_AUDIT_ATTEMPTS:-4}"
RETRY_DELAY_SECONDS="${HARA_NPM_AUDIT_RETRY_DELAY_SECONDS:-15}"
for numeric_setting in "$MAX_ATTEMPTS" "$RETRY_DELAY_SECONDS"; do
  case "$numeric_setting" in
    ''|*[!0-9]*)
      echo "error: npm audit retry settings must be non-negative integers" >&2
      exit 2
      ;;
  esac
done
[ "$MAX_ATTEMPTS" -ge 1 ] && [ "$MAX_ATTEMPTS" -le 6 ] || {
  echo "error: HARA_NPM_AUDIT_ATTEMPTS must be an integer from 1 to 6" >&2
  exit 2
}
[ "$RETRY_DELAY_SECONDS" -le 120 ] || {
  echo "error: HARA_NPM_AUDIT_RETRY_DELAY_SECONDS must be an integer from 0 to 120" >&2
  exit 2
}

AUDIT_JSON="$(mktemp)"
AUDIT_ERROR="$(mktemp)"
cleanup_audit_output() {
  rm -f "$AUDIT_JSON" "$AUDIT_ERROR"
}
trap cleanup_audit_output EXIT

for ((audit_attempt = 1; audit_attempt <= MAX_ATTEMPTS; audit_attempt += 1)); do
  : >"$AUDIT_JSON"
  : >"$AUDIT_ERROR"
  set +e
  npm audit \
    --omit=dev \
    --json \
    --registry https://registry.npmjs.org/ \
    --fetch-retries=3 \
    --fetch-retry-factor=2 \
    --fetch-retry-mintimeout=10000 \
    --fetch-retry-maxtimeout=90000 \
    --fetch-timeout=180000 \
    >"$AUDIT_JSON" 2>"$AUDIT_ERROR"
  audit_exit=$?
  set -e

  if [ "$audit_exit" -eq 0 ]; then
    cat "$AUDIT_JSON"
    cat "$AUDIT_ERROR" >&2
    exit 0
  fi

  # npm exits 1 for a real advisory finding. Detect the structured total first so package/advisory text
  # can never be mistaken for a retryable network error.
  if node -e '
    const fs = require("node:fs");
    try {
      const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const counts = report?.metadata?.vulnerabilities;
      process.exit(counts && Number(counts.total) > 0 ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$AUDIT_JSON"; then
    cat "$AUDIT_JSON" >&2
    cat "$AUDIT_ERROR" >&2
    echo "error: npm audit found production dependency vulnerabilities" >&2
    exit "$audit_exit"
  fi

  if ! grep -Eiq \
    'audit endpoint returned an error|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up|network request|HTTP[^0-9]*(408|425|429|500|502|503|504)' \
    "$AUDIT_JSON" "$AUDIT_ERROR"; then
    cat "$AUDIT_JSON" >&2
    cat "$AUDIT_ERROR" >&2
    echo "error: npm audit failed with a non-transient error; refusing to retry" >&2
    exit "$audit_exit"
  fi

  cat "$AUDIT_JSON" >&2
  cat "$AUDIT_ERROR" >&2
  [ "$audit_attempt" -lt "$MAX_ATTEMPTS" ] || {
    echo "error: npm audit endpoint failed after $audit_attempt bounded attempts" >&2
    exit "$audit_exit"
  }
  retry_delay=$((audit_attempt * RETRY_DELAY_SECONDS))
  echo "warning: transient npm audit failure on attempt $audit_attempt; retrying in ${retry_delay}s" >&2
  sleep "$retry_delay"
done

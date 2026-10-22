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
  # Select the supported audit CLI without changing global npm or the application's lockfile.
  # Disable the old CLI's implicit audit while installing npm 11; the explicit production audit
  # below is always enabled. This loop owns retries, with no nested fetch retry multiplier.
  npm exec \
    --yes \
    --audit=false \
    --package=npm@11 \
    --registry https://registry.npmjs.org/ \
    --fetch-retries=0 \
    --fetch-timeout=180000 \
    -- npm audit \
    --audit=true \
    --omit=dev \
    --json \
    --registry https://registry.npmjs.org/ \
    --fetch-retries=0 \
    --fetch-timeout=180000 \
    >"$AUDIT_JSON" 2>"$AUDIT_ERROR"
  audit_exit=$?
  set -e

  # A generic endpoint-error hint is not evidence of a temporary outage. Structured advisories
  # and permanent HTTP errors take precedence over any transient-looking text in the same output.
  disposition="$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const error = fs.readFileSync(process.argv[2], "utf8");
    let report;
    try { report = JSON.parse(raw); } catch { report = {}; }
    const counts = report?.metadata?.vulnerabilities;
    let kind = "non-transient";
    if (counts && Number(counts.total) > 0) {
      kind = "vulnerability";
    } else {
      const text = `${raw}\n${error}`;
      const statuses = [];
      for (const info of [report, report?.error]) {
        if (!info || typeof info !== "object") continue;
        for (const key of ["code", "status", "statusCode"]) {
          const match = /^E?([45]\d{2})$/.exec(String(info[key] ?? ""));
          if (match) statuses.push(Number(match[1]));
        }
      }
      for (const match of text.matchAll(/(?:\bE|\bHTTP(?:\/[\d.]+)?\s+|\bstatus(?:Code)?["\x27]?\s*[:=]\s*["\x27]?)([45]\d{2})\b/gi)) statuses.push(Number(match[1]));
      for (const match of text.matchAll(/(?:^|[^\w])([45]\d{2})[ \t]+(?:Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Gone|Unprocessable|Too Many Requests|Request Timeout|Too Early|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/gi)) statuses.push(Number(match[1]));
      const temporary = new Set([408, 425, 429, 500, 502, 503, 504]);
      const retired = /\b(?:retired|decommissioned)\b|endpoint[^\n]*no longer (?:available|supported)/i.test(text);
      const invalidConfig = /\b(?:EUSAGE|EJSONPARSE|EINVALID\w*|EAUDITNOLOCK|ENOLOCK|ERESOLVE)\b/i.test(text);
      if (!retired && !invalidConfig && !statuses.some(code => !temporary.has(code))) {
        if (statuses.length || /\b(?:EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up)\b/i.test(text)) kind = "transient";
        else if (counts?.total === 0 && !report?.error) kind = "clean";
      }
    }
    process.stdout.write(kind);
  ' "$AUDIT_JSON" "$AUDIT_ERROR")"

  if [ "$audit_exit" -eq 0 ] && [ "$disposition" = "clean" ]; then
    cat "$AUDIT_JSON"
    cat "$AUDIT_ERROR" >&2
    exit 0
  fi
  # Even a broken CLI reporting success must not pass an invalid or error-shaped audit report.
  [ "$audit_exit" -ne 0 ] || audit_exit=1
  if [ "$disposition" = "vulnerability" ]; then
    cat "$AUDIT_JSON" >&2
    cat "$AUDIT_ERROR" >&2
    echo "error: npm audit found production dependency vulnerabilities" >&2
    exit "$audit_exit"
  fi
  if [ "$disposition" != "transient" ]; then
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

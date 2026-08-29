#!/usr/bin/env bash
# Install an exact npm lockfile with bounded retries. Protected release runners can experience
# short registry read stalls; one transient timeout must not discard an otherwise verified build,
# while a persistent outage must still fail in finite time.
set -euo pipefail

MAX_ATTEMPTS="${HARA_NPM_CI_ATTEMPTS:-4}"
IGNORE_SCRIPTS="${HARA_NPM_CI_IGNORE_SCRIPTS:-0}"
case "$MAX_ATTEMPTS" in
  ''|*[!0-9]*)
    echo "error: HARA_NPM_CI_ATTEMPTS must be an integer from 1 to 6" >&2
    exit 2
    ;;
esac
[ "$MAX_ATTEMPTS" -ge 1 ] && [ "$MAX_ATTEMPTS" -le 6 ] || {
  echo "error: HARA_NPM_CI_ATTEMPTS must be an integer from 1 to 6" >&2
  exit 2
}
case "$IGNORE_SCRIPTS" in
  0) ;;
  1) IGNORE_SCRIPT_ARGS=(--ignore-scripts --no-audit --fund=false) ;;
  *)
    echo "error: HARA_NPM_CI_IGNORE_SCRIPTS must be 0 or 1" >&2
    exit 2
    ;;
esac
NPM_CI_ARGS=(
  --fetch-retries=5
  --fetch-retry-factor=2
  --fetch-retry-mintimeout=10000
  --fetch-retry-maxtimeout=120000
  --fetch-timeout=300000
)
if [ "$IGNORE_SCRIPTS" = "1" ]; then
  NPM_CI_ARGS=("${IGNORE_SCRIPT_ARGS[@]}" "${NPM_CI_ARGS[@]}")
fi

for ((install_attempt = 1; install_attempt <= MAX_ATTEMPTS; install_attempt += 1)); do
  if npm ci "${NPM_CI_ARGS[@]}"; then
    exit 0
  fi

  [ "$install_attempt" -lt "$MAX_ATTEMPTS" ] || {
    echo "error: npm ci failed after $install_attempt bounded attempts" >&2
    exit 1
  }
  retry_delay=$((install_attempt * 15))
  echo "warning: npm ci attempt $install_attempt failed; retrying in ${retry_delay}s" >&2
  sleep "$retry_delay"
done

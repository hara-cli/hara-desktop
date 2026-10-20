#!/bin/bash
# Historical filename retained for old local callers. No Keychain lookup or permission partition.
set +x
set -eu
exec node "$(dirname "$0")/with-updater-file.mjs" "$@"

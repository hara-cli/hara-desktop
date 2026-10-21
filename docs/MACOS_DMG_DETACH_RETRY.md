# Bounded macOS DMG detach recovery

Tauri CLI2.11.4 rewrites `bundle/dmg/bundle_dmg.sh` on each packaging attempt. The reviewed
upstream script (`3b21448e5eef9b7c4f6bd8593e6c5f577ee5c64db2a237a4908e63fb6d81a89e`)
retries detach status16, while macOS can also return2 for a busy temporary volume.
Scoped lsof/fuser diagnostics may not identify a transient or other-user holder. Do not attribute
the failure to a particular process without evidence, or assume that an empty snapshot proves
the volume is unused.

`macos-dmg-detach-retry.sh` is the canonical replacement for that one function: retry2/16,
at most three total attempts, waits2/4s, preserve final status, fail immediately on any other code.
It never force-ejects, kills a holder, changes a timeout, or treats diagnostics failure as success.
Each failure attempts lsof/fuser diagnostics only after hdiutil metadata binds the device to the
temporary `rw.<creator PID>.*` image of this exact script. Keep private diagnostics in an owned0700
`HARA_DMG_DIAGNOSTICS_DIR` if needed; no environment/argv dump is performed.

`macos-dmg-detach.mjs script <generated-script> <original args...>` verifies the complete
upstream hash and generates an adjacent derived script. The original and all other DMG steps,
support paths, Finder cosmetics and compression remain unchanged. Unknown upstream versions,
symlinks, hardlinks or foreign-owned scripts fail closed; they require review, not a fuzzy patch.
The fixture retains the upstream MIT/Apache copyright header for exact-source tests.

`macos-dmg-detach.mjs run <Tauri command...>` applies the same adapter to a stock Tauri invocation.
It adds BASH_ENV only to that macOS packaging child, never to a user profile/global environment.
An existing BASH_ENV is refused rather than silently overwritten. Apple's Bash3.2 initializes
script `$0`/arguments after reading BASH_ENV; a one-shot first-command DEBUG trap therefore checks
the exact generated path, immediately removes itself and intercepts only that one script.
Unrelated shell children execute unchanged. The derived script clears BASH_ENV before executing.
No GitHub/tag/source identity or environment approval is fabricated by this local adapter.

Candidate initial macOS build, final native signed-App DMG and formal Mac build share this adapter.
The original updater-file reader stays outside it, so key bytes remain memory-only and its combined
output redaction remains effective. Existing Developer ID, timestamp, notarization, staple,
Gatekeeper, Pi-only, DMG/updater smoke and exact-source release authorization remain mandatory.
No workflow/protection/token changes are part of this patch. Direct unwrapped upstream CLI is
still upstream behavior; this is a fix to the governed Hara packaging entries, not an OS-wide shim.

Review/test commands:

```bash
node --test test/macos-dmg-detach.test.mjs
bash -n scripts/macos-dmg-detach-retry.sh
bash -n scripts/macos-dmg-detach-hook.sh
```

Unit tests, cross-builds/Rosetta and unsigned diagnostics do not satisfy the exact-source native
Intel/full release gate. Complete package verification remains required before any release tag.

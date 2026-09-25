# Errors

## [ERR-20260923-SECURITY-ANCHOR-RACE] Security shortcuts landed on the same settings card

**Logged**: 2026-09-23T13:10:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: settings-navigation

### Summary

The WeChat scene's Computer Use and Jev shortcuts both selected the Security page, then attempted to scroll
inside a microtask. React had not necessarily committed the new page, so neither target existed yet and both
actions appeared to land at the Computer Use card at the top.

### Resolution

Store a typed pending security anchor and resolve it in an effect after the Security page commits. Computer
Use now targets its own section; Jev targets and focuses the `TypeSafe API Key` field. The two buttons also
name their destinations explicitly.

### Metadata

- Source: user_feedback
- Reproducible: yes
- Related Files: `src/App.tsx`, `src/WeChatSceneSettings.tsx`, `src/DecisionGuardSettings.tsx`
- Tags: react, settings, navigation, jev, computer-use
- Pattern-Key: ui.scroll_anchor_after_destination_commit
- Recurrence-Count: 1

---

## [ERR-20260925-001] Desktop build rejected String.replaceAll at the repository TypeScript target

**Logged**: 2026-09-25T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary

The Agent runtime recovery command initially used `String.replaceAll`, but the Desktop TypeScript library
target does not include that API.

### Error

```text
src/AgentCollaborationSurface.tsx(143,20): error TS2550: Property 'replaceAll' does not exist on type 'string'.
```

### Context

- Operation: `npm run build` under the repository-approved Node 22 runtime.
- The failure occurred while escaping a local workspace path for a copied shell recovery command.

### Suggested Fix

Use the target-compatible global regular-expression replacement (`value.replace(/'/g, replacement)`) for
shell quoting unless the Desktop TypeScript library target is intentionally raised.

### Metadata

- Reproducible: yes
- Related Files: `src/AgentCollaborationSurface.tsx`
- Tags: typescript, compatibility, desktop, build
- Pattern-Key: build.desktop_es_target_string_api
- Recurrence-Count: 1

---

## [ERR-20260922-001] Accepted notarization briefly lacked a staple ticket on the protected signer

**Logged**: 2026-09-22T02:32:04+08:00
**Priority**: medium
**Status**: resolved
**Area**: release-pipeline

### Summary

The first Desktop 0.1.172 protected release attempt received Apple's `Accepted` notarization result, but
immediate staple validation could not read the ticket for the app/updater payload. The immutable source and
all other release inputs were unchanged.

### Error

```text
Notarization status: Accepted
Staple/ticket validation failed for the signed app or updater payload
```

### Resolution

Rerun the same protected workflow from the same immutable source without replacing or mutating any release
asset. Attempt 2 passed signing, notarization, stapling, package smoke, promotion, and independent public-edge
verification. Treat an `Accepted` response and staple availability as separate gates; publication remains
blocked until both pass.

### Metadata

- Source: external_tool_failure
- Reproducible: transient
- Related Files: .github/workflows/build.yml, scripts/release-mac-assets.sh
- See Also: ERR-20260829-IMMUTABLE-ATTESTATION-VISIBILITY
- Tags: apple, notarization, staple, immutable-release, retry
- Pattern-Key: release.accepted_notarization_still_requires_staple_gate
- Recurrence-Count: 1

---

## [ERR-20260921-009] Runtime-menu refactor changed a source-contract callback spelling

**Logged**: 2026-09-21T12:15:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

Moving reasoning effort into the on-demand runtime menu renamed an inline callback parameter from `e` to
`event`. Behavior and TypeScript remained valid, but the existing source-contract regression test intentionally
matched the established callback form.

### Error

```text
The input did not match /onChange=\{\(e\) => void changeModel\(undefined, e\.target\.value\)\}/
```

### Suggested Fix

Preserve stable source-contract expressions during presentation-only refactors unless the test is deliberately
being replaced by a stronger behavioral assertion.

### Metadata

- Source: test_failure
- Reproducible: yes
- Related Files: src/App.tsx, test/ui-regressions.test.mjs
- Tags: runtime-menu, regression-test, refactor

### Resolution

- **Resolved**: 2026-09-21T12:16:00+08:00
- **Notes**: Restored the established callback spelling and reran the focused suite.

---

## [ERR-20260921-008] zsh source search used an unmatched quote

**Logged**: 2026-09-21T12:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

A read-only `rg` probe embedded a template-literal marker inside a double-quoted zsh command and terminated
before searching the Desktop sources.

### Error

```text
zsh:1: unmatched "
```

### Context

- The probe was looking for transcript auto-scroll and ConversationTimeline mounting code.
- No files or application state were changed.

### Suggested Fix

Split unrelated search patterns into separate `rg` arguments and avoid literal backticks in a shell command
string unless they are protected by a single-quoted fixed-string pattern.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: src/App.tsx, src/ConversationTimeline.tsx
- Tags: zsh, quoting, rg, source-inspection

### Resolution

- **Resolved**: 2026-09-21T12:01:00+08:00
- **Notes**: Continued with smaller, safely quoted read-only probes.

---

## [ERR-20260829-IMMUTABLE-ATTESTATION-VISIBILITY] Newly published immutable attestation was briefly invisible to the workflow token

**Logged**: 2026-08-29T19:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-pipeline

### Summary

Desktop 0.1.120 was public and immutable, and independent public downloads matched the signed release,
but the final GitHub-hosted verifier received a transient attestation-not-found result immediately after
publication. A later public verification succeeded without changing the release, showing that the failure
was token visibility or post-publication propagation rather than invalid release bytes.

### Resolution

Use the protected release-policy token for immutable-attestation reads and retry only the attestation
visibility check for a small bounded window. Apply the same bounded behavior to the independent public-edge
verifier, while keeping asset size, digest, updater metadata, Gatekeeper, and public-byte checks fail-closed.
Never reopen, replace, or mutate an immutable release to work around transient verification visibility.

### Metadata

- Source: external_tool_failure
- Reproducible: transiently after immutable publication
- Related Files: .github/workflows/build.yml, scripts/verify-public-release-edge.sh, test/release-pipeline.test.mjs
- Tags: github-release, immutable, attestation, token, retry, verification
- Pattern-Key: release.retry_immutable_attestation_visibility_without_mutating_publication

---

## [ERR-20260921-007] Agent collaboration UI used APIs newer than the Desktop TypeScript target

**Logged**: 2026-09-21T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary

The first Agent collaboration surface used `Array.at` and `String.replaceAll`, but Hara Desktop's current
TypeScript library target does not include those APIs. A conditional Agent lookup also widened to `"" | AgentInfo`.

### Error

~~~text
TS2550: Property 'at' does not exist on type 'string[]'.
TS2550: Property 'replaceAll' does not exist on type 'string'.
TS2339: Property 'identity' does not exist on type '"" | AgentInfo'.
~~~

### Suggested Fix

Use target-compatible indexing and regular-expression replacement, and express optional lookups with an
explicit ternary so the result stays `AgentInfo | undefined`. Keep the full Desktop build as the authority.

### Resolution

Replaced `Array.at` with bounded index access, replaced `String.replaceAll` with a global regular expression,
and made the optional Agent lookup an explicit ternary. The production TypeScript/Vite build and focused
Agent collaboration, client, and UI regression suites now pass.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: src/AgentCollaborationSurface.tsx
- Tags: typescript, compatibility, desktop, agent-collaboration
- Pattern-Key: desktop.frontend_respects_pinned_typescript_lib_target
- Recurrence-Count: 1

---

## [ERR-20260911-H2R] Direct Node test could not resolve a runtime TypeScript dependency

**Logged**: 2026-09-11T09:07:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

A new helper imported runtime TypeScript modules with extensionless specifiers. Vite resolved them, but
Node 22 type stripping did not, so the focused test failed before executing its assertions.

### Error

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'src/session-place' imported from src/engine-restart-blocker.ts
```

### Suggested Fix

Use explicit `.ts` extensions for runtime imports in source helpers that are loaded directly by Node tests;
the repository enables `allowImportingTsExtensions` and Vite accepts the same imports.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `src/engine-restart-blocker.ts`, `test/engine-restart-blocker.test.mjs`
- Tags: node22, typescript, esm, tests
- Pattern-Key: tests.explicit_ts_runtime_imports
- Recurrence-Count: 1

### Resolution

- **Resolved**: 2026-09-11T09:08:00+08:00
- **Notes**: Added explicit `.ts` extensions and reran the focused suite successfully (3/3).

---

## [ERR-20260911-D3F] zsh rejected an unmatched optional-file glob

**Logged**: 2026-09-11T05:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

A read-only version probe included `.env*`; zsh's default `nomatch` behavior rejected the command because no matching file existed.

### Error

```
zsh:1: no matches found: .env*
```

### Resolution

Use `rg --files` or explicit known paths for optional files instead of an unguarded zsh glob. The failed probe made no repository changes.

### Recurrence on 2026-09-20 (HARA-FB-001392)

A read-only source inspection passed the literal Next.js route segment `[locale]` to zsh without quoting it.
Zsh treated the bracketed segment as a filename pattern and stopped the command with `no matches found`.
Quote every path that contains bracketed route segments before passing it to shell tools.

### Recurrence on 2026-09-21

A read-only test search included the optional pattern `src/*.test.*`; no file matched and zsh stopped before
`rg` ran. Search explicit directories (`rg ... test src`) instead of passing optional globs to zsh.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
- Tags: zsh, nomatch, diagnostics
- Pattern-Key: tooling.zsh_optional_paths_avoid_unmatched_globs
- Recurrence-Count: 3
- Last-Seen: 2026-09-21

---

## [ERR-20260911-E8A] Managed runner could not attach a release DMG

**Logged**: 2026-09-11T05:22:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-verification

### Summary

The native `mac-dmg-smoke` gate reached `hdiutil attach`, but the managed runner had no configured device for
mounting the already-downloaded public DMG. This is an environment limitation, not an artifact verdict.

### Error

```
hdiutil: attach failed - Device not configured
```

### Resolution

Do not weaken or retry the mount gate indefinitely. Verify updater signatures and source provenance, then use
the signed `.app.tar.gz` updater archive for package and bundled-sidecar inspection in this restricted runner;
leave DMG Gatekeeper/staple evidence to the protected release verifier.

### Metadata

- Source: command_failure
- Reproducible: unknown
- Related Files: `scripts/mac-dmg-smoke.mjs`, `scripts/mac-updater-smoke.mjs`
- Tags: dmg, hdiutil, sandbox, release-verification
- Pattern-Key: release.managed_runner_may_not_mount_dmg
- Recurrence-Count: 1

---

## [ERR-20260911-F2C] Packaged Tauri UI was searched as a plain Resources file

**Logged**: 2026-09-11T05:28:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-verification

### Summary

A manual updater-archive check correctly verified both arm64 executables and Engine 0.172.0, then stopped on
an invalid assertion that localized Tauri UI text must exist as a plain file under `Contents/Resources`.

### Error

```
rg found no plain Resources file containing the authentication-boundary copy
```

### Resolution

Tauri embeds frontend assets in the desktop executable. Do not substitute raw Mach-O string searches for
runtime evidence. Bind packaged bytes to the exact validated source provenance and use the supported release
diagnostic/package smoke surfaces; keep source-level UI regression tests as separate evidence.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `WORKFLOW.md`, `scripts/package-smoke.mjs`, `scripts/updater-endpoint-smoke.mjs`
- Tags: tauri, packaged-assets, runtime-evidence, release-verification
- Pattern-Key: release.tauri_ui_not_plain_resources_text
- Recurrence-Count: 1

---

## [ERR-20260911-G6B] Cached 0.1.159 macOS updater app failed local codesign verification

**Logged**: 2026-09-11T05:33:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-pipeline

### Summary

The retained 0.1.159 arm64 updater archive passed its Tauri updater signature, contained arm64 Desktop and
Engine binaries, and reported Engine 0.172.0, but a fresh extraction failed `codesign --verify --strict` for
the app and all three nested executables. The app metadata still reports a stapled ticket and Team ID.

### Error

```
invalid signature (code or signature have been modified)
In architecture: arm64
```

### Context

- Artifact: retained same-day `Hara_aarch64.app.tar.gz` validation download for Desktop 0.1.159.
- Updater cryptographic signature: passed with key ID `6d888a288003c57a`.
- Public-origin freshness could not be repeated because all current network/browser paths were unavailable.
- Do not yet classify this as a public-release defect until source/digest provenance and an independent package
  or installed-app verification distinguish a stale local cache or host verifier problem.

### Suggested Fix

Compare the archive SHA-256 to official immutable Release metadata, verify a separately obtained copy on a
host-boundary macOS runner, and inspect the signing/promotion record. If confirmed, stop relying on this updater
archive and follow the immutable-release incident procedure; never replace assets in place.

### Resolution

The local verifier produced equivalent failures for the installed Hara 0.1.156, Google Chrome, Claude,
ChatGPT, and VS Code; even `/bin/ls` returned `CSSMERR_TP_NOT_TRUSTED`. This proves the managed host's local
code-signing/trust result is not a valid product-specific signal. Do not report an Hara release defect from
this run. Retain the updater cryptographic signature, exact source provenance, package version/architecture,
and the protected release record, while explicitly omitting local Gatekeeper/codesign as a newly passed gate.

### Metadata

- Source: command_failure
- Reproducible: yes for the retained archive
- Related Files: `scripts/mac-updater-smoke.mjs`, `scripts/release-mac-assets.sh`, `.github/workflows/build.yml`
- Tags: codesign, updater, macos, release-verification
- Pattern-Key: release.cached_updater_app_codesign_invalid_needs_independent_confirmation
- Recurrence-Count: 1

---

## [ERR-20260911-004] zsh parsed a Git object-path colon as a parameter modifier

**Logged**: 2026-09-11T00:37:31+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

A read-only loop used `"$tag_name:path"` for a Git object path; zsh treated the colon and suffix as part
of parameter expansion, producing a malformed revision instead of `<tag>:<path>`.

### Error

```
fatal: ambiguous argument 'v0.1.140ies/SIDECAR_VERSION'
```

### Context

- Operation: read the sidecar version and commit stamps from two historical Desktop tags.
- No project file, release, or external state was changed by the failed command.

### Suggested Fix

Use an explicit object path or brace the variable as `"${tag_name}:src-tauri/binaries/SIDECAR_VERSION"`.
For a short fixed tag list, explicit `git show <tag>:<path>` commands are easiest to audit.

### Resolution

- **Resolved**: 2026-09-11T00:37:31+08:00
- **Notes**: Replaced the loop interpolation with explicit tag/object-path arguments.

### Metadata

- Reproducible: yes
- Related Files: `src-tauri/binaries/SIDECAR_VERSION`, `src-tauri/binaries/SIDECAR_COMMIT`
- See Also: 2026-08-29 — zsh rejects unmatched configuration globs before `rg` runs
- Tags: zsh, git, parameter-expansion, release-verification
- Pattern-Key: zsh.git_object_path_requires_braced_parameter

---

## [ERR-20260828-IMAGEGEN-PARALLEL-QUEUE] Parallel built-in portrait calls stalled behind server-side serialization

**Logged**: 2026-08-28T01:50:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: asset-generation

### Summary

Four distinct built-in ImageGen calls were awaited through one `Promise.all`. The service did not
complete the batch after a bounded 16-minute wait and yielded no individual result because the aggregate
await withheld completed outputs. A subsequent single portrait also timed out, confirming temporary
service congestion after the parallel queue rather than a prompt-specific failure.

### Resolution

Generate large portrait sets as a one-call-at-a-time pipeline, save and validate each result immediately,
and resume from the filesystem inventory. Do not aggregate multiple long ImageGen calls behind one await;
bounded per-asset progress is more reliable and recoverable than nominal parallelism. After a service
timeout, stop issuing new live calls for a cooling period and continue deterministic manifest/code work.

### Metadata

- Source: tool_failure
- Reproducible: yes in the current built-in ImageGen service path
- Related Files: public/avatars/talent/v2
- Tags: imagegen, batch, queue, recovery, avatar
- Pattern-Key: imagegen.persist_each_asset_before_starting_the_next

---

## [ERR-20260828-CLOUD-CLI-SIGNED-URL-STDERR] Cloud CLI DNS failure printed signed query parameters

**Logged**: 2026-08-28T01:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-security

### Summary

A restricted-network CDN refresh failed at DNS resolution and the cloud CLI included its signed request
URL in stderr. Even though no secret value was intentionally printed or repeated, cloud CLI failure
output can contain credential identifiers and short-lived signatures.

### Resolution

Run credentialed cloud mutations directly in the approved network context and cap or redact stderr before
forwarding it. Never repeat the failed request URL in commentary, logs, release notes, or Feishu.

### Metadata

- Source: tool_failure
- Reproducible: yes when the credentialed CLI cannot resolve its API endpoint
- Related Files: ../hara-web/AGENTS.md
- Tags: credentials, stderr, signed-url, cdn, redaction
- Pattern-Key: cloud_cli_failures_must_redact_signed_request_urls

---

## [ERR-20260827-LIGHT-PROVIDER-DETAIL-CONTRAST] Saved provider detail becomes unreadable in daylight

**Logged**: 2026-08-27T11:38:58+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

Hara Desktop 0.1.112 overrides saved-provider detail values to daylight ink while leaving the fact,
endpoint, and read-only model surfaces on hard-coded near-black backgrounds. The main value contrast is
about 1.25:1, so the text is effectively invisible in the light theme.

### Resolution

Theme the complete component surface (background, border, label, and value) through semantic tokens, add
saved-connection detail to the provider preview, and gate both themes with focused contrast assertions and
rendered screenshots. A foreground-only daylight override is not a complete theme adaptation.

Desktop 0.1.113 moved the surfaces and text to semantic tokens and added dark/light WCAG contrast tests;
the release and both updater channels passed before publication.

### Metadata

- Source: user_feedback
- Reproducible: yes
- Related Files: src/App.css, src/theme-light.css, src/ProviderSettings.tsx, test/ui-regressions.test.mjs
- Tags: light-theme, provider-settings, contrast, accessibility
- Pattern-Key: frontend.theme_complete_surface_not_foreground_only
- Recurrence-Count: 1

---

## [ERR-20260827-GITHUB-ASSET-LOCAL-RESETS] Local release downloads repeatedly reset during first-party mirror publication

**Logged**: 2026-08-27T16:59:58+08:00
**Priority**: medium
**Status**: resolved
**Area**: release-pipeline

### Summary

Direct `gh release download` and local resumable curl transfers repeatedly timed out or reset while
fetching several 30–52 MB immutable assets. One local retry process also reopened an MSI after a good
SCP completed, so the pre-upload digest gate correctly caught the resulting truncated file.

### Resolution

Use a trusted release host only as a no-credential public-download relay, stop every competing local
writer before the final transfer, then require exact GitHub size and SHA-256 for all allowlisted files
before OSS upload. Never infer completeness from an exit code or file existence alone.

### Metadata

- Source: command_failure
- Reproducible: intermittent on the current workstation path to GitHub release assets
- Related Files: WORKFLOW.md, scripts/release-channel-audit.mjs
- Tags: release, github, download, scp, digest, fail-closed
- Pattern-Key: release.stop_competing_writers_before_digest_gate

---

## [ERR-20260827-TURBOPACK-SANDBOX-PORT] Global site Turbopack build could not bind its helper port

**Logged**: 2026-08-27T16:59:58+08:00
**Priority**: low
**Status**: resolved
**Area**: website-release

### Summary

The global Next.js site build failed with `Operation not permitted` while Turbopack evaluated PostCSS
through a local helper process. The China site happened to build in the sandbox, so this was not a
source or release-manifest failure.

### Resolution

Use the repository-supported `HARA_WEB_NEXT_BUILD_MODE=webpack` deployment mode for restricted release
environments, while retaining the normal manifest validator and production build. Also pin Node 22 in
PATH before every Node/pnpm command; the system Node 11 is not a valid diagnostic runtime.

### Metadata

- Source: command_failure
- Reproducible: yes in the current restricted sandbox
- Related Files: ../hara-web/deploy.sh, ../hara-web/site/package.json
- Tags: nextjs, turbopack, sandbox, webpack, node
- Pattern-Key: release.use_supported_webpack_fallback_when_turbopack_cannot_bind

---

## [ERR-20260827-STREAMING-SPACE-TRANSCRIPT-LOSS] Space route mutation can strand an optimistic user message

**Logged**: 2026-08-27T11:38:58+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

A Feishu report for Hara Desktop 0.1.112 says using the Space selector during an active streamed turn can
leave the assistant reply visible while the entire user message disappears from history. Real Space or
provider-route changes clear renderer transcripts before the authoritative reload, while streaming events
can continue rebuilding the assistant side.

### Root Cause

Space/provider route mutation cleared the renderer transcript but left the session in the attachment
authority cache. Late streaming events could then rebuild an assistant-only partial transcript, while a
return to the conversation skipped authoritative `resumeSession` because the session still appeared
attached.

### Resolution

Desktop 0.1.113 invalidates the attachment cache whenever engine-bound surfaces are cleared, forcing the
next conversation activation to restore server history before cached transcript reuse. Source regressions
cover cache invalidation and the authority prerequisite; the stable updater channel was verified before
the original Feishu report was closed.

### Metadata

- Source: user_feedback
- Reproducible: yes
- Related Files: src/App.tsx, src/SpaceSwitcher.tsx, src/conversation-state.ts, test/ui-regressions.test.mjs
- Tags: streaming, space, transcript, optimistic-message, data-loss
- Pattern-Key: frontend.streaming_route_mutation_preserves_accepted_user_turn
- Recurrence-Count: 1

---

## [ERR-20260827-THEME-AUDIT-LOCAL-TOOLING] Theme audit hit shell glob and sandbox preview constraints

**Logged**: 2026-08-27T11:38:58+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

An unquoted zsh test glob failed with `no matches found`, an obsolete repository-local Feishu script path
did not exist, and the restricted shell could not bind the Vite loopback preview port. The in-app Browser
runtime also had no available browser instance for visual QA.

### Resolution

Use `rg --glob` or quote shell globs, invoke Feishu through the current skill-owned
`scripts/feishu_chat.py`, pin the repository-approved Node PATH for every test command, and run the
loopback-only preview through the approved runner when needed. When the Browser runtime reports no browser,
retain source/static evidence but keep real dark/light screenshot comparison as an explicit future gate.

### Recurrence on 2026-09-11 (HARA-FB-001137)

A help probe again assumed `scripts/feishu_chat.py` existed under the Desktop repository, and the first
correction then mixed a skill-directory working directory with a repository-relative learning path. Both
read-only commands failed locally. Use absolute paths whenever one command needs files owned by different
roots; the Feishu helper remains exclusively skill-owned.

### Recurrence on 2026-09-12 (Mobile Build 5 release notice)

A help probe from the Hara workspace root again assumed a repository-local `scripts/feishu_chat.py`. The
workspace intentionally has no copy. Use the installed skill helper's absolute path for the remaining read,
send, and read-back operations.

### Metadata

- Source: tool_failure
- Reproducible: yes in the restricted environment
- Related Files: src/theme-light.css, test/theme.test.mjs, test/ui-regressions.test.mjs
- Tags: zsh, feishu, vite, browser, visual-qa, node-path
- Pattern-Key: tooling.theme_audit_respects_shell_and_visual_qa_constraints
- Recurrence-Count: 3
- Last-Seen: 2026-09-12

---

## [ERR-20260825-DESKTOP-PATH-HID-RUSTUP] Explicit release PATH omitted rustup and exposed legacy Rust

**Logged**: 2026-08-25T17:54:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-toolchain

### Summary

An explicit Desktop release PATH correctly pinned Node 22.23.1 and Bun 1.3.9 but omitted the user's Cargo
bin directory. `check-build-toolchain.sh` therefore could not discover rustup and inspected Homebrew Rust
1.84.1, failing the required Rust 1.97.0 gate before any sidecar was rebuilt.

### Resolution

Include the current user's rustup Cargo bin directory in the explicit release PATH. The existing gate can then locate the
installed `1.97.0-aarch64-apple-darwin` rustc/cargo and re-pin child processes itself. Never weaken the version
check or rely on the ambient Homebrew toolchain.

### Metadata

- Source: tool_failure
- Reproducible: yes
- Related Files: scripts/check-build-toolchain.sh, scripts/refresh-sidecar.sh
- Tags: rustup, path, release, toolchain
- Pattern-Key: release.explicit_path_must_include_rustup_shim
- Recurrence-Count: 2

---

## [ERR-20260825-OPTIONAL-UPSTREAM-CLONE-RESET] Research clone failed on a transient GitHub reset

**Logged**: 2026-08-25T02:02:18+08:00
**Priority**: low
**Status**: resolved
**Area**: research-tooling

### Summary

An optional shallow clone of the Agency Agents companion app ran for roughly two minutes and then
failed with `curl 56`, connection reset, early EOF, and an invalid partial pack. The complete local
Agency Agents catalog plus the upstream project's official README and release documentation already
contained the product evidence needed for the analysis.

### Resolution

Do not make an auxiliary upstream clone a single point of failure for repository-backed product
research. Use the available local source and primary upstream documentation, cap or abandon the
optional clone after a bounded failure, and clone only when implementation-level inspection is
materially required.

### Metadata

- Source: external_tool_failure
- Reproducible: intermittent
- Related Files: none
- Pattern-Key: research.optional_clone_has_primary_source_fallback

---
## [ERR-20260825-OVERLAPPING-SED-RANGES] Overlapping inspection ranges looked like duplicate source lines

**Logged**: 2026-08-25T16:45:00+08:00
**Priority**: low
**Status**: resolved
**Area**: source-review

### Summary

Adjacent `sed -n` ranges shared their boundary line (`1,240p` followed by `240,520p`). The combined
tool output therefore displayed that line twice, which was briefly mistaken for duplicated CSS and
caused a harmless `apply_patch` verification failure.

### Resolution

Use non-overlapping review ranges such as `1,240p` and `241,520p`, or verify suspected duplication
with a line-numbered search before editing. Treat patch-context failure as a cue to reread the exact
source rather than broadening the patch.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: src/theme-light.css
- Tags: source-review, sed, apply-patch, false-positive
- Pattern-Key: review.segmented_output_ranges_must_not_overlap

---

## [ERR-20260825-FULL-CATALOG-SEARCH-EXPECTATION] talent_market_test

**Logged**: 2026-08-25T03:13:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

The original 22-role test assumed `code review` had exactly one match; the complete 270-role catalog
correctly returned several additional engineering specialists whose metadata contains both terms.

### Resolution

Assert the product invariant instead: the hand-adapted exact match ranks first, while broader community
matches remain discoverable.

### Metadata

- Source: test_failure
- Reproducible: yes after full catalog import
- Related Files: test/talent-market.test.mjs, src/talent-blueprints.ts
- Tags: search, ranking, full-catalog, test
- Pattern-Key: tests.catalog_search_asserts_ranking_not_singleton_results

---

## [ERR-20260825-AGENCY-NESTED-GAME-ROLES] talent_catalog_generator

**Logged**: 2026-08-25T03:04:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The first corrected generator found only 255 of 270 Agents because Game Development has 15 roles in
nested Unreal, Unity, Roblox, Blender, and Godot directories.

### Error

```text
Expected 270 Agency Agents, received 255
```

### Resolution

Recursively traverse each authoritative division, preserve nested subdirectories in generated blueprint
ids, and retain the exact 270-count plus unique-id gates.

### Metadata

- Source: command_failure
- Reproducible: yes with Agency Agents revision ebe9c99
- Related Files: scripts/build-agency-talent-catalog.mjs
- See Also: ERR-20260825-AGENCY-DIVISION-MANIFEST-SHAPE
- Tags: agency-agents, generator, nested-directories, game-development
- Pattern-Key: tooling.agency_catalog_traverses_nested_division_roles

---

## [ERR-20260825-AGENCY-DIVISION-MANIFEST-SHAPE] talent_catalog_generator

**Logged**: 2026-08-25T03:01:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The first catalog generation treated every top-level `divisions.json` key as a division, but the pinned
upstream manifest stores the real map under `divisions` and also includes a `_note` string.

### Error

```text
ENOENT: no such file or directory, scandir '.../agency-agents/_note'
```

### Resolution

Read only `divisionManifest.divisions`, fail when that map is absent, and keep the exact expected 270
record count as the final completeness gate.

### Metadata

- Source: command_failure
- Reproducible: yes with Agency Agents revision ebe9c99
- Related Files: scripts/build-agency-talent-catalog.mjs
- Tags: agency-agents, generator, manifest, catalog
- Pattern-Key: tooling.agency_divisions_manifest_uses_nested_map

---

## [ERR-20260825-TALENT-VISUAL-QA-SURFACES] local_visual_qa

**Logged**: 2026-08-25T02:43:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary

The restricted shell could not bind the Vite loopback port, the in-app Browser runtime had no
connected browser instance, and Browser Use correctly refused to attach until Chrome remote debugging
received an interactive user approval.

### Error

```text
Error: listen EPERM: operation not permitted 127.0.0.1:4173
No browser is available
browser-harness: remote-debugging-setup: ask the user to allow remote debugging before retrying
```

### Resolution

Start the loopback-only development server in the approved runner. Do not interrupt active Chrome work
or retry Browser Use before its requested approval. A development-only Talent Market preview plus
Computer Use in a separate Safari tab completed dark-theme, department-filter, accessibility-tree, and
generated-portrait QA without touching the user's Chrome tabs.

### Recurrence on 2026-09-20 (HARA-FB-001399)

The Hara product-page fixture built successfully, but direct Chrome and Playwright capture both failed under
the managed host boundary, and Computer Use reported no browser backend. The deck therefore used already
verified official Hara screenshots and concept artwork, while final slide rendering used the managed
presentation renderer rather than claiming a fresh in-app screenshot.

### Metadata

- Source: external_tool_failure
- Reproducible: yes in the restricted shell / when no Browser backend is connected
- Related Files: src/main.tsx, src/TalentMarket.tsx, src/TalentMarket.css
- Tags: vite, loopback, browser, browser-use, safari, visual-qa
- Pattern-Key: frontend.visual_qa_uses_isolated_preview_without_interrupting_active_browser

---

## [ERR-20260825-IMAGEGEN-ALPHA-CLEANUP-TIMEOUT] generated portrait background repair stalled

**Logged**: 2026-08-25T11:12:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend-assets

### Summary

Two generated role portraits rendered a visible checkerboard as opaque RGB pixels. The requested
ImageGen transparency edit remained non-terminal for more than seven minutes and was terminated rather
than blocking the implementation indefinitely.

### Resolution

Verify generated transparency from pixel channels, never from the preview alone. After the ImageGen
edit path stalled, derive a bounded neutral-background alpha mask locally, composite each result over a
strong contrasting color for visual edge inspection, resize to 640px WebP, and assert RGBA plus a 128 KiB
asset cap. Keep the untouched generated originals in the ImageGen output directory.

### Metadata

- Source: external_tool_failure
- Reproducible: not yet
- Related Files: public/avatars/talent/radar-v1.webp, public/avatars/talent/scout-v1.webp, test/talent-market.test.mjs
- Tags: imagegen, alpha, transparency, timeout, visual-qa
- Pattern-Key: assets.generated_portrait_alpha_is_verified_before_packaging

---

## [ERR-20260825-TALENT-LIGHTWEIGHT-SPLIT-IMPORT] catalog split initially broke native TS tests

**Logged**: 2026-08-25T11:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend-performance

### Summary

Moving shared blueprint helpers out of the 270-record catalog correctly removed the catalog from the
main bundle, but the first split used an extensionless runtime re-export that Node's native TypeScript
test loader could not resolve and retained one unused type import rejected by `noUnusedLocals`.

### Resolution

Use an explicit `.ts` extension for the catalog's runtime re-export, keep the Desktop-only imports
extensionless where Vite resolves them, and import only types actually referenced by the catalog module.
The focused test and production build then passed; main JavaScript fell from 636.58 KiB to 449.59 KiB,
while the complete catalog moved into the lazy Talent Market chunk.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: src/talent-blueprint.ts, src/talent-blueprints.ts, src/HireAgentDialog.tsx, test/talent-market.test.mjs
- Tags: vite, node, typescript, code-splitting, performance
- Pattern-Key: frontend.large_catalog_keeps_lightweight_blueprint_helpers_separate

---

## [ERR-20260825-TALENT-GENERATOR-MISSING-SOURCE] catalog generator requires an explicit source checkout

**Logged**: 2026-08-25T11:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The first manual reproducibility run omitted the required `--source` option and exited before reading or
writing the catalog.

### Resolution

Rerun with `--source <pinned-agency-agents-checkout>`. The generator verified the
pinned commit and deterministically regenerated all 270 metadata records. Keep the source option
mandatory so CI and developers cannot silently consume an unrelated checkout.

### Metadata

- Source: command_failure
- Reproducible: yes without the documented argument
- Related Files: scripts/build-agency-talent-catalog.mjs, package.json
- Tags: agency-agents, generator, source, reproducibility
- Pattern-Key: tooling.catalog_generation_requires_explicit_pinned_source

---

## [ERR-20260825-PUBLIC-DMG-CDN-LOW-SPEED-EXHAUSTED] Public x64 DMG edge exhausted bounded low-speed retries

**Logged**: 2026-08-25T01:36:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: release-pipeline

### Summary

Desktop v0.1.109 passed exact-source materialization, all signed/notarized package checks, the complete
17-asset remote verification, publication, and GitHub immutable-release attestation. The final public
x64 DMG read then received only tens of kilobytes from the GitHub release CDN before every bounded
HTTP/1.1 low-speed retry ended with curl 28. The immutable release remained valid and public; only the
post-public verification job failed.

### Suggested Fix

First use the existing verification-only rerun against the same immutable tag. If the same public edge
repeats, move the public-byte download gate to an independently networked GitHub-hosted verifier while
keeping Gatekeeper checks on the controlled Mac, and bind the downloaded file to the attested GitHub
size and SHA-256. Do not weaken the public-download gate or rewrite the immutable release.

### Metadata

- Source: external_tool_failure
- Reproducible: yes during the v0.1.109 protected run
- Related Files: scripts/release-mac-assets.sh, .github/workflows/build.yml, test/release-pipeline.test.mjs
- See Also: ERR-20260824-RELEASE-ASSET-CDN-EXHAUSTED
- Tags: github-release, public-cdn, dmg, low-speed, verification-only, immutable
- Pattern-Key: release.public_dmg_bytes_use_independent_attested_verifier

---

## [ERR-20260825-SIGNER-HIDDEN-DRAFT-TAG-LOOKUP] Protected signer cannot rely on tag lookup for a hidden Release

**Logged**: 2026-08-25T00:10:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: release-pipeline

### Summary

Desktop v0.1.108 completed all four native builds and hidden-draft assembly, but the protected signer
could not resolve that still-hidden Release through the tag endpoint. The first authenticated read returned
HTTP 404 and the next two bounded reads hit TLS handshake timeouts, so source download, signing, and
publication correctly never started.

### Suggested Fix

Pass the exact Release database ID from the trusted draft-creation job directly to the protected signing
job. Read only that repository-bound REST resource through system curl over HTTP/1.1 with aggregate retry
and process deadlines, then require the exact ID, tag, draft state, source asset name, size, and original
upload-artifact SHA-256 before downloading or executing source.

### Metadata

- Source: external_tool_failure
- Reproducible: yes during the v0.1.108 protected run
- Related Files: .github/workflows/build.yml, test/release-pipeline.test.mjs
- See Also: ERR-20260824-SIGNER-ACTIONS-ARTIFACT-DUAL-EDGE
- Tags: github-release, hidden-draft, rest, http1.1, release-id, fail-closed
- Pattern-Key: release.signer_uses_exact_hidden_draft_database_id

---

## [ERR-20260822-TYPED-I18N-DEPENDENCY-MAP] Dynamic dependency label widened beyond i18n keys

**Logged**: 2026-08-22T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: desktop-ui

### Summary

The first Desktop build rejected an inline object lookup because TypeScript widened its values to
`string`, while the translation helper accepts only the closed `Key` union.

### Resolution

Added an exhaustive `Record<TaskDependencyKind, Key>` mapping. New dependency kinds now fail at compile
time until Desktop provides an explicit user-facing label.

### Metadata

- Source: compile_failure
- Reproducible: yes
- Related Files: src/ConversationTimeline.tsx, src/client.ts, src/i18n.ts
- Pattern-Key: ui.exhaustive_typed_status_copy

---

## [ERR-20260824-SIGNER-SOURCE-ARTIFACT-EDGE] Protected signer needs an independently bounded artifact client

**Logged**: 2026-08-24T19:52:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-pipeline

### Summary

Desktop v0.1.105 remained hidden because the protected signer could retrieve only about 308 KB of a
25,245,025-byte exact source artifact after all eight bounded HTTP/1.1 resume attempts. Signing and
publication correctly never started.

### Resolution

Keep the source artifact ID and upload-artifact digest authoritative, but use two independent bounded
clients. A hard-deadline `gh api` transfer completed the same bytes in about 40 seconds and matched the
expected SHA-256 exactly; the resumable HTTP/1.1 path remains as fallback. Reject and delete every partial
or mismatched file before unpacking or executing source.

### Metadata

- Source: command_failure
- Reproducible: yes during the v0.1.105 protected run
- Related Files: .github/workflows/build.yml, test/release-pipeline.test.mjs
- Pattern-Key: release.signer_uses_digest_bound_independent_artifact_clients

---

## [ERR-20260824-DESKTOP-RUST-PATH] Desktop gates must select the repository-pinned rustup toolchain

**Logged**: 2026-08-24T19:56:00+08:00
**Priority**: low
**Status**: resolved
**Area**: desktop-toolchain

### Summary

A local `cargo check` resolved an older system Cargo 1.84.1 because the command PATH omitted
`~/.cargo/bin`; the current lockfile legitimately requires stable edition-2024 support.

### Resolution

Prepend the rustup bin directory and verify `.rust-version` before running Cargo gates. The identical check
then passed with Cargo/Rust 1.97.0; do not downgrade or rewrite dependencies to accommodate a mistakenly
selected system toolchain.

### Recurrence on 2026-09-11

The first HARA-FB-001065 updater-signature verification pinned Node but not Rust, so its nested Cargo build
resolved 1.84.1 and rejected the edition-2024 dependency. Pin and print both Cargo and rustc before rerunning
the cryptographic gate; never treat this toolchain error as an artifact-signature failure.

### Metadata

- Source: command_failure
- Reproducible: yes with the legacy system Cargo first in PATH
- Related Files: .rust-version, src-tauri/Cargo.lock, src-tauri/Cargo.toml
- Pattern-Key: toolchain.desktop_cargo_uses_pinned_rustup_path
- Recurrence-Count: 2
- Last-Seen: 2026-09-11

---

## [ERR-20260823-DESKTOP-PACKAGE-RUNNER] Undeclared pnpm command triggered dependency relocation

**Logged**: 2026-08-23T19:32:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: desktop-toolchain

### Summary

Running `pnpm check` without first reading this repository's scripts made pnpm interpret the command
as a dependency operation. It moved npm-installed direct dependencies into `node_modules/.ignored`
and attempted a registry fetch in a network-restricted shell.

### Resolution

Stopped the process before the retry, restored every explicitly relocated dependency, and adopted the
repository-declared `npm run build` / `npm test` gates under the pinned Node 22 runtime. Always inspect
`package.json` scripts before selecting a package runner; do not infer a generic `check` script.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: package.json
- Pattern-Key: toolchain.read_scripts_before_runner

---

## [ERR-20260824-RELEASE-ASSET-CDN-EXHAUSTED] Hidden draft download exhausted verified retries

**Logged**: 2026-08-24T21:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-pipeline

### Summary

Desktop v0.1.106 completed both signed/notarized macOS builds but remained a hidden draft because
the protected promoter could retain only 12 of 16 digest-verified Release assets after three bulk
download attempts. GitHub returned a TLS handshake timeout, a connection reset, and a read timeout.

### Resolution

Keep the bounded bulk transfer as the first path, then download only missing assets from their
repository-bound GitHub REST endpoints with system curl forced to HTTP/1.1. Pass the token through
curl configuration on stdin so it never enters process arguments, use bounded retries and resume,
and atomically accept each file only after its exact size and GitHub SHA-256 match. A real hidden
35 MB DMG and `latest.json` both passed the new path and exact digest verification before release.

### Metadata

- Source: external_tool_failure
- Reproducible: yes during the v0.1.106 protected run
- Related Files: scripts/github-release-api-download.mjs, scripts/release-mac-assets.sh, test/release-pipeline.test.mjs
- Tags: github, release-assets, http1.1, resume, digest, fail-closed
- Pattern-Key: release.asset_download_uses_digest_bound_http1_api_fallback

---

## [ERR-20260824-SIGNER-ACTIONS-ARTIFACT-DUAL-EDGE] Both Actions artifact clients exhausted on the protected signer

**Logged**: 2026-08-24T22:36:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: release-pipeline

### Summary

Desktop v0.1.107 remained hidden because the protected signer could retrieve only 192,541 of
25,249,821 source-artifact bytes after three hard-deadline GitHub CLI attempts and eight independently
bounded HTTP/1.1 resumable attempts. The workflow rejected the mismatched SHA-256 before unpacking or
executing any source.

### Suggested Fix

Keep the upload-artifact SHA-256 authoritative, but have the GitHub-hosted draft assembler copy those
exact bytes into a digest-bearing hidden Release source archive. The protected signer should retrieve
that named archive through the independently proven Release REST/HTTP/1.1 path, verify the original
artifact digest and inner source-pack checksums, and only then materialize the pinned Desktop and CLI
trees. Retain the source archive in the immutable public release as reproducibility evidence, while
excluding it from updater and installer mirrors.

### Metadata

- Source: external_tool_failure
- Reproducible: yes during the v0.1.107 protected run
- Related Files: .github/workflows/build.yml, scripts/release-mac-assets.sh, scripts/release-channel-audit.mjs, test/release-pipeline.test.mjs
- See Also: ERR-20260824-SIGNER-SOURCE-ARTIFACT-EDGE, ERR-20260824-RELEASE-ASSET-CDN-EXHAUSTED
- Tags: github-actions, artifact, release-asset, signer, digest, fail-closed
- Pattern-Key: release.signer_source_archive_uses_digest_bound_release_transport

---

## [ERR-20260824-DESKTOP-NODE-PATH-NATIVE-GATE] Native gate inherited system Node 24

**Logged**: 2026-08-24T22:48:00+08:00
**Priority**: low
**Status**: resolved
**Area**: desktop-toolchain

### Summary

The first native gate correctly stopped because its fresh Bash environment resolved system Node 24.15.0
instead of the repository-pinned Node 22.23.1.

### Resolution

Prepend the pinned NVM Node, rustup, and Bun bins before sourcing `check-build-toolchain.sh`. The exact
Node 22.23.1, Bun 1.3.9, and Rust 1.97.0 gate then passed with `cargo check`.

### Metadata

- Source: command_failure
- Reproducible: yes in a non-login shell without the explicit NVM bin
- Related Files: .node-version, scripts/check-build-toolchain.sh
- Pattern-Key: toolchain.desktop_native_gate_uses_explicit_pinned_node_path

---

## [ERR-20260824-PREPUSH-REVIEW-FALSE-GREEN] Pre-push review cached a failed Codex launch as reviewed

**Logged**: 2026-08-24T22:51:00+08:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary

`git prepush-check` returned zero and cached HEAD as reviewed even though Codex failed immediately under
legacy system Node with `SyntaxError: Unexpected token {`. A second invocation under Node 22 then reused
the invalid cached review instead of running a real review.

### Suggested Fix

The review wrapper must treat a non-zero Codex child exit or syntax-error output as a failed review, avoid
writing the reviewed-commit cache, and require an explicit modern Node path before launching Codex.

### Metadata

- Source: command_failure
- Reproducible: yes with legacy system Node first in PATH
- Related Files: local git prepush-check wrapper
- See Also: ERR-20260824-DESKTOP-NODE-PATH-NATIVE-GATE
- Pattern-Key: tooling.prepush_review_never_caches_failed_child_as_success

---
## [ERR-20260825-PUBLIC-ASSET-REDIRECT-URL-LEAK] Public release downloader printed a temporary signed redirect URL

**Logged**: 2026-08-25T14:25:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-pipeline

### Summary

An isolated `gh release download --pattern` retry failed during a TLS handshake and printed the full
`release-assets.githubusercontent.com` redirect URL, including its temporary SAS/JWT query, into tool
output. The asset was public and the URL was short-lived, but signed redirect queries must still be
treated as credential-adjacent and redacted.

### Resolution

Do not surface raw stdout/stderr from release download retries. Report only the requested asset name,
exit status, timeout state, and digest-verification result. When polling multiple download sessions,
sanitize or suppress each command's output before rendering it. Continue accepting files only after
exact GitHub size and SHA-256 verification.

### Metadata

- Source: command_failure
- Reproducible: yes when GitHub's asset edge fails after redirect
- Related Files: scripts/github-release-download.mjs, scripts/release-download-cache.mjs
- Tags: github, release-assets, signed-url, redaction, tls
- Pattern-Key: release.asset_download_errors_must_redact_redirect_queries

---
## [ERR-20260825-REMOTE-CURL-COMPAT-FAILOPEN] Remote download helper used an unsupported curl flag and child shells did not fail fast

**Logged**: 2026-08-25T14:35:00+08:00
**Priority**: critical
**Status**: resolved
**Area**: release-pipeline

### Summary

The acceleration host's older curl rejected `--retry-all-errors`. Because `xargs` launched exported
functions in child Bash processes without enabling `errexit`, later size/hash/move commands also ran
and the helper printed misleading `verified` lines even though no asset existed.

### Resolution

Use only curl flags supported by the target host, implement explicit bounded retry in Bash, enable
`set -euo pipefail` inside every `xargs` child, and require curl success, exact byte count, SHA-256,
and a successful atomic move before printing `verified`. Treat the failed run as producing zero files.

### Metadata

- Source: command_failure
- Reproducible: yes on the current acceleration host
- Related Files: /private/tmp/hara-remote-download.sh
- Tags: release, curl, compatibility, fail-closed, verification
- Pattern-Key: release.remote_parallel_workers_must_enable_errexit

---
## [ERR-20260825-PRESIGNED-PUT-REMOTE-AUTHORITY] Remote presigned PUT transfer lacked explicit credential-material authorization

**Logged**: 2026-08-25T14:55:00+08:00
**Priority**: high
**Status**: resolved
**Area**: release-pipeline

### Summary

A proposed acceleration path would have piped short-lived, exact-object OSS PUT URLs to an existing
release host. Even though the URLs were bounded to seven public release objects and 30 minutes, they
remain credential material, and ordinary release authorization does not explicitly authorize sending
that material to a remote host. The execution was rejected before any URL left the workstation.

### Resolution

Do not transmit presigned write URLs or other credential-adjacent material to a remote host without
explicit user authorization for that host and risk. Prefer a no-credential relay: download public
assets on a trusted host, transfer verified bytes back locally, and upload to OSS using local protected
credentials. Do not retry or indirectly reproduce a rejected credential-transfer path.

### Metadata

- Source: permission_denied
- Reproducible: yes
- Related Files: /private/tmp/hara_oss_presign_put.py, /private/tmp/hara-remote-upload.sh
- Tags: oss, presigned-url, authorization, release, credentials
- Pattern-Key: release.remote_presigned_write_requires_explicit_authority

---
## [ERR-20260825-HARA-BUNDLE-ID-AMBIGUOUS] UI automation could not select among multiple Hara app copies

**Logged**: 2026-08-25T16:56:00+08:00
**Priority**: low
**Status**: resolved
**Area**: desktop-visual-qa

### Summary

Computer Use rejected the shared `com.nanhara.hara` bundle identifier because installed, debug,
and release-bundle copies were all present. A bundle identifier is not a unique UI target on this
release workstation.

### Resolution

For source visual QA, target the exact debug app path under the current repository. Reserve the
bundle identifier for machines with a single installed copy, and re-read app state after selecting
the precise path before interacting.

### Recurrence on 2026-09-14 (HARA-FB-001355)

The running Hara could not be observed by display name, the shared bundle id resolved to three installed or
release-built copies, and the exact `/Applications/Hara.app` path had no accessible window. Stop after the
bounded read-only attempts; do not launch another copy merely to inspect the user's existing connector state.

### Metadata

- Source: tool_failure
- Reproducible: yes on release workstations with multiple Hara bundles
- Related Files: src-tauri/target/debug/bundle/macos/Hara.app
- Tags: computer-use, macos, bundle-id, visual-qa
- Pattern-Key: desktop.visual_qa_must_target_exact_app_copy
- Recurrence-Count: 2

---
## [ERR-20260825-PROFILE-LIST-SANDBOX-FCHMOD] Profile diagnostics failed inside the workspace sandbox

**Logged**: 2026-08-25T17:04:00+08:00
**Priority**: low
**Status**: resolved
**Area**: diagnostic-environment

### Summary

The otherwise read-only `hara profile list` path acquires the hardened private-state mutex and may
create or permission a lock/state file. Workspace sandboxing rejected that `fchmod` with `EPERM`,
which is an execution-environment restriction rather than evidence that the installed Hara runtime
cannot read its profiles.

### Resolution

When investigating real local profile state, rerun the bounded, redacted profile-list command with
the required host permission. Never infer a product regression from the sandbox-only `fchmod` error,
and never print the underlying private JSON or credentials as a workaround.

### Recurrence on 2026-09-11 (HARA-FB-001068)

Two clean-tag Computer Use tests were blocked before their assertions when `loadConfig` tried to tighten the
owner-only private-state descriptor and the managed runner rejected `fchmod`. The other 30 policy, activation,
redaction, and MCP-capability tests passed; keep the two environment-blocked checks separate from product results.

### Recurrence on 2026-09-14 (HARA-FB-001355)

The installed CLI's otherwise redacted `hara gateway status` command was blocked before returning any status
when private-state permission hardening hit the same sandbox `fchmod EPERM`. Do not treat the empty diagnostic
as product evidence and do not read raw gateway state as a workaround.

### Metadata

- Source: command_failure
- Reproducible: yes under restricted workspace execution
- Related Files: hara-cli/src/profile/profile.ts
- Tags: sandbox, profile, private-state, diagnostics
- Pattern-Key: diagnostics.private_state_cli_may_require_host_lock_permissions
- Recurrence-Count: 3

---
## [ERR-20260827-TERMINAL-REPLY-ES-LIB] Runtime-supported Array.at failed the Desktop TypeScript target

**Logged**: 2026-08-27T19:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: desktop-build
**Recurrence-Count**: 2

### Summary

The focused Node tests accepted `Array.prototype.at`, but the Desktop production TypeScript target does
not include that library and rejected the terminal-reply reconciliation helper during `npm run build`.

### Resolution

Use ordinary bounded index access in renderer helpers unless the repository TypeScript target explicitly
advertises a newer library. Always run the production TypeScript/Vite build in addition to direct Node tests.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: src/conversation-state.ts, src/provider-model-capabilities.ts
- Tags: typescript, target-lib, build-gate, transcript
- Pattern-Key: desktop.runtime_api_support_does_not_replace_typescript_target_gate

---
## [ERR-20260827-RELEASE-HELP-LEGACY-NODE] Release helper inspection used the legacy system Node

**Logged**: 2026-08-27T21:11:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-operations

### Summary

An initial help/usage probe invoked `node` without the repository-approved PATH and resolved the
workstation's obsolete Node 11, which could not parse ESM imports in the release scripts.

### Resolution

Prefix every Hara Desktop and website Node/npm/pnpm command, including read-only script inspection,
with the pinned Node 22 PATH. The same scripts then returned their expected usage output.

### Metadata

- Source: command_failure
- Reproducible: yes on this workstation
- Related Files: scripts/release-channel-audit.mjs, scripts/updater-mirror-manifest.mjs
- Tags: node, nvm, release, toolchain
- Pattern-Key: release.read_only_node_probes_require_pinned_path
- Recurrence-Count: 2
- Last-Seen: 2026-08-29

### Recurrence

The first 0.1.115 sidecar refresh also entered through the legacy Node 11 PATH and was correctly rejected by
the pinned-toolchain preflight before any sidecar was replaced. Re-running with the full release PATH built
and smoked the exact 0.155.0 CLI commit successfully.

---
## [ERR-20260827-FEISHU-PREVIEW-LIMIT] Feishu intake requested an out-of-range preview size

**Logged**: 2026-08-27T22:08:00+08:00
**Priority**: low
**Status**: resolved
**Area**: feedback-operations

### Summary

The first release-closure intake used `--preview-limit 500`, while the Feishu helper accepts at most
100, so it failed before making the read request.

### Resolution

Keep `messages --preview-limit` between 1 and 100; use `--output` for the complete redacted result.
The retry used 40 and returned the latest group messages successfully.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: the installed `feishu-communicate/scripts/feishu_chat.py` helper
- Tags: feishu, feedback, cli-validation
- Pattern-Key: feishu.messages_preview_limit_is_bounded

---
## 2026-08-27 — Unqualified Node used while validating the bilingual Agent manifest

- Command: `node -e ...`
- Failure: the non-interactive shell resolved legacy system Node 11, which cannot dynamically import the ESM manifest.
- Correction: prepend the repository-approved Node 22.23.1 runtime's `bin` directory for every Hara Desktop Node/npm/pnpm command, including small validation probes.

### Recurrence on 2026-08-29

The Desktop `check:release` preflight was invoked through an unqualified `npm` while preparing 0.1.115;
the legacy Node 11 runtime failed before project code ran. The correction remains mandatory for every npm,
Node, Vite, and release-metadata command, including quick commands chained after file inspection.

### Second recurrence on 2026-08-29

The strengthened Talent portrait validator was invoked once with an unqualified `node`; system Node 11
rejected `--experimental-strip-types` before reading any asset. Treat even read-only one-file probes as
repository Node work and prepend the complete approved Node 22/Homebrew PATH before the first invocation.

### Third recurrence on 2026-08-29

An `npm run build` focused CLI check was launched without the fixed PATH while validating the external-session
timeout hardening. The global npm then ran under Node 11 and failed before repository code. Use the literal
`env PATH=<Node22>:<Bun>:<Homebrew>:<Cargo>:...` prefix template for every npm/pnpm invocation; an approved
command prefix or an absolute npm script path does not select the interpreter used by npm's shebang.

### Fourth recurrence on 2026-09-11

A release-tag verification called the Node 22 installation's absolute `npm` path but did not prepend that
installation's `bin` directory to `PATH`. npm's `#!/usr/bin/env node` shebang therefore selected system Node 11
and failed on `require("node:path")`. Always export the complete pinned runtime PATH before invoking npm, even
when the npm script path itself is absolute.

### Fifth recurrence on 2026-09-11

A focused test command selected Node 22 by replacing `PATH` with only system directories. The test itself ran,
but the follow-up diagnostic could not find `rg`. Put the pinned Node `bin` first on the existing trusted tool
PATH (including the workstation's Codex/Homebrew tools); do not narrow PATH so far that required diagnostics vanish.

### Fifth recurrence on 2026-09-11

A cross-repository crash-report inspection tried to derive a runtime from Hara Control's absent `.node-version`;
the failed lookup left system Node 11 in `PATH`, and local `tsx` stopped at syntax parsing before reading the
export. Resolve the declared runtime from the owning repository first and verify `node --version`; when Control
has no local pin, use the workspace-approved Desktop Node 22.23.1 runtime explicitly for the read-only helper.

### Sixth recurrence on 2026-09-11

An issue-verification preflight invoked the absolute npm executable under the Node 22.23.1 installation without
first prepending that installation's `bin` directory to `PATH`. Its `#!/usr/bin/env node` shebang again selected
system Node 11 and failed on `require("node:path")`. For every npm command, prepend the full approved Node bin to
the existing PATH and verify both `node --version` and `npm --version`; an absolute npm path is not sufficient.

### Seventh recurrence on 2026-09-11

A HARA-FB-001065 verification chain placed the pinned `PATH` export after a `git diff --exit-code` joined with
`&&`. The expected nonzero diff skipped the export, while newline-separated release scripts continued under
system Node 11. Put the pinned `PATH` export and version check at the very start of every shell invocation; do
not make toolchain selection conditional on unrelated probes.

### Eighth recurrence on 2026-09-11

A code-signing comparison used unsupported `codesign --version` inside another `&&` chain, skipping the intended
system-binary verification and temporarily mislabelling that option's exit code. Run independent diagnostics on
separate statements and capture each exit immediately; never let an informational probe gate later evidence.

### Ninth recurrence on 2026-09-11

A HARA-FB-001068 read-only `package.json` metadata probe again invoked unqualified `node`; the workstation's
legacy Node 11 stopped at nullish-coalescing syntax before repository code ran. Even disposable `node -e`
inspection must begin with the Desktop-pinned Node 22.23.1 bin prepended to the existing PATH.

### Tenth recurrence on 2026-09-11

The HARA-FB-001114 exact-tag verification invoked the npm executable inside the pinned Node 22.23.1
installation without first prepending that installation's `bin` directory. npm's `env node` shebang still
resolved system Node 11 and failed on `require("node:path")`. The corrected verification exports the pinned
Node directory at the start of every shell invocation and checks both Node and npm versions before any gate.

### Eleventh recurrence on 2026-09-11

A HARA-FB-001124 read-only package metadata probe invoked unqualified `node`; legacy Node 11 rejected optional
chaining before reading `package.json`. Even inspection-only probes must prepend the Desktop-pinned Node
22.23.1 directory to the existing PATH and verify `node --version` before use.

### Twelfth recurrence on 2026-09-12

The HARA-FB-001309 toolchain inspection printed the legacy Node version and then invoked unqualified
`npm --version` in the same shell before selecting the repository runtime. npm's shebang resolved Node 11 and failed
on `require("node:path")`. Keep version-file inspection separate from runtime probes, then prepend the pinned
Node 22.23.1 `bin` directory before the first `node` or `npm` invocation.

### Thirteenth recurrence on 2026-09-14

A HARA-FB-001355 cross-repository version probe again invoked unqualified `node --version` and `npm --version`
inside the CLI repository. The npm shebang selected system Node 11 and failed on `require("node:path")` before
reading project metadata. Even read-only runtime probes must start with the explicit pinned Node 22.23.1 PATH;
file-only metadata inspection should avoid invoking Node or npm altogether.

## 2026-08-28 — Minimal Node 22 PATH omitted the Homebrew GitHub CLI

- Command: `node scripts/github-release-download.mjs ...`
- Failure: the helper could not spawn `gh` because `/opt/homebrew/bin` was missing from the explicit PATH.
- Correction: Hara release commands need both the pinned Node 22 bin and `/opt/homebrew/bin`; validate `command -v node` and `command -v gh` before release-channel helpers.

### Recurrence on 2026-09-11

A read-only release metadata query run under non-login Bash again omitted `/opt/homebrew/bin` and could not
resolve `gh`. Subsequent GitHub checks use the explicit `/opt/homebrew/bin/gh` path.
## 2026-08-28 — Built-in ImageGen timed out on the Agent portrait art-direction master

- Request: one transparent, non-pixel editorial-comic portrait for the Hara Agent catalog.
- Failure: the built-in image generation call remained active for roughly six minutes and then returned `image generation failed: timeout`; no artifact was produced.
- Correction: keep the catalog/avatar mapping work independent, retry a smaller built-in prompt once, and never silently switch to the API/CLI fallback because that requires explicit user authorization and `OPENAI_API_KEY`.
## 2026-08-28 — Avatar validation again resolved the legacy system Node

- Command: `node --experimental-strip-types scripts/talent-avatar-queue.mjs --summary`
- Failure: a conversion-and-validation shell omitted the repository Node 22 PATH, so the system Node rejected `--experimental-strip-types`.
- Correction: treat image asset conversion as part of the Desktop build workflow and prepend the complete approved Node 22/Homebrew PATH even when only the final command in the shell invokes Node.

## 2026-08-28 — Parallel built-in ImageGen requests serialize and can lose the completion hint

- Request: generate two distinct Hara Talent portraits concurrently, one request per character.
- Failure: after roughly sixteen minutes one request timed out; the other produced an image file but returned no usable `output_hint`, so the successful asset had to be located and visually matched before packaging.
- Correction: do not scale the conversational built-in ImageGen path to the remaining catalog. Keep one-character-one-request semantics, use a resumable batch-capable ImageGen channel only after explicit fallback authorization, and preserve the portrait completeness gate so no partial catalog can ship.

### Recurrence later on 2026-08-28

A single, smaller, one-reference portrait request for `wechat-developer` also remained active for four
minutes without producing an artifact and was deliberately terminated. The same correction applies: the
remaining 297 portraits require an explicitly authorized resumable batch channel; do not weaken the gate
or copy existing identities to manufacture completeness.

## 2026-08-28 — Release-channel audit requires an explicit channel mode

- Command: `npm run audit:release-channel`
- Failure: the audit helper exited with usage because it requires `versioned`, `stable`, or `all` and an optional tag.
- Correction: call the helper with the release-intent mode, using `all vX.Y.Z` for a complete preflight of a prepared Desktop release.

## 2026-08-28 — Hara Desktop has no `typecheck` npm script

- Command: `npm run typecheck`
- Failure: the package exposes `build` and `test`, but no standalone `typecheck` script.
- Correction: use the repository's `npm run build` full gate, or invoke its local `tsc` binary directly
  for a focused TypeScript-only check.

## 2026-08-28 — Feishu feedback helper uses `--chat`, not `--chat-id`

- Command: `python3 scripts/feishu_chat.py messages --chat-id ...`
- Failure: the helper rejected the unsupported flag before reading feedback.
- Correction: use `messages --chat <chat_id>` and keep preview limits within the helper's documented bound.

## 2026-08-29 — Talent portrait assertion used an unimported classifier

- Command: full Desktop `node --test test/*.test.mjs`
- Failure: the updated portrait completeness assertion called `talentBlueprintIsCurated` without importing it, so the suite stopped on a `ReferenceError` before evaluating asset completeness.
- Correction: import every helper introduced into a test and run the directly affected test file once before treating a broad regression failure as an expected asset-gate failure.

## 2026-08-29 — Timing-bounded Rust process probe was starved by parallel full suites

- Command: `cargo test` launched concurrently with both Desktop and CLI full Node suites.
- Failure: the panel-runtime test could not finish its bounded fake-Node probe under transient CPU/process contention and reported that no supported runtime existed; the same 44-test suite passed immediately when rerun alone.
- Correction: run timing-sensitive Desktop Rust process tests separately from the two full JavaScript suites; parallelize only gates without short child-process deadlines.

## 2026-08-29 — Z-Image nightly loader received a Hugging Face cache root

- Command: the 03:00 `com.nanhara.hara.zimage-avatars` LaunchAgent run.
- Failure: `DiffusionPipeline.from_pretrained` was given `models--Tongyi-MAI--Z-Image-Turbo`, while `model_index.json` lives under the revision named by `refs/main`; the job failed before generating or overwriting an asset.
- Correction: resolve and validate `refs/main` to a contained `snapshots/<revision>` directory before model loading, while continuing to accept an explicitly supplied snapshot directory.

## 2026-08-29 — Sidecar smoke needs the host loopback boundary

- Command: `./scripts/refresh-sidecar.sh` inside the filesystem sandbox.
- Failure: the compiled sidecar was valid, but its native Desk capability smoke could not bind
  `127.0.0.1` and failed with `listen EPERM` before the version and commit stamps were updated.
- Correction: run the same controlled refresh script at the host boundary whenever its Serve capability
  smoke is enabled; do not bypass the smoke or manually stamp an unexecuted sidecar.

### Recurrence on 2026-09-11

The HARA-FB-001065 native updater-archive smoke verified the packaged shell's endpoint order, then the
packaged Engine 0.172.0 capability probe was stopped solely by `listen EPERM` on `127.0.0.1`. Retain the
successful package checks, use non-listening binary checks in the restricted runner, and do not claim the
host-boundary Serve smoke passed here.

### Recurrence on 2026-09-11 (HARA-FB-001136)

The extracted arm64 updater sidecar also produced no output for `--version` within a dedicated 10-second
subprocess deadline in this managed runner. The probe was terminated and not retried. Treat packaged runtime
execution as unavailable here; retain the exact signed-release provenance and protected package-smoke record,
without presenting this local attempt as either a package pass or a product failure.

### Recurrence on 2026-09-23 (local WeChat scene smoke)

The development sidecar compiled successfully from the dirty `hara-cli` working tree, but
`scripts/sidecar-smoke.mjs --serve-capabilities` was again denied its `127.0.0.1` listener with `EPERM`.
Rerun the complete `refresh-sidecar.sh` at the host boundary so the capability handshake executes and the
version/commit stamps are written atomically; do not treat compilation alone as a completed refresh.

## 2026-08-29 — ImageMagick montage attempted font rendering without a configured font

- Command: `magick montage` for a temporary nine-avatar visual QA sheet.
- Failure: montage tried to resolve an empty/default annotation font and failed before writing the preview.
- Correction: assemble unlabeled rows with `magick ( ... +append ) ... -append` when only a contact sheet is
  needed; this avoids the annotation subsystem entirely and keeps source assets unchanged.

## 2026-08-29 — Sandboxed process inspection cannot read the nightly generator

- Command: `ps -p <launch-agent-pid> -o ...`
- Failure: macOS process inspection returned `operation not permitted` inside the workspace sandbox.
- Correction: monitor this scheduled job through its JSONL log and `launchctl print` state; use a host-boundary
  process probe only when those two sources disagree, rather than repeatedly invoking `ps` in the sandbox.

## 2026-08-29 — macOS system proxy left the signing Runner online locally but offline in GitHub

- Symptom: the LaunchAgent stayed running and printed generic connection messages, while GitHub reported the
  protected `hara-desktop-release` Runner as offline.
- Root cause: .NET fell through to the macOS HTTP proxy, which returned 403 specifically for the Actions Broker
  session endpoint; `all_proxy` and lowercase `no_proxy` alone did not control the Runner's HTTP handler.
- Correction: configure explicit `HTTP_PROXY`/`HTTPS_PROXY` plus matching uppercase and lowercase `NO_PROXY`
  GitHub domain suffixes in the private Runner `.env`, restart the service, and verify `status: online` through
  the GitHub Actions Runners API before creating a Desktop release tag.

## 2026-08-29 — Feishu helper is owned by the installed communication skill

- Command: `python3 scripts/feishu_chat.py ...` from the Hara workspace root.
- Failure: the workspace intentionally has no copy of that helper, so Python exited before any Feishu read or
  write occurred.
- Correction: invoke the installed `feishu-communicate/scripts/feishu_chat.py` by its absolute path (or work
  from that skill directory). Keep the canonical Hara chat ID explicit and never duplicate the helper into a
  product repository.

## 2026-08-29 — zsh rejects unmatched configuration globs before `rg` runs

- Command: `rg ... src-tauri tauri.conf.* docs package.json`
- Failure: no root-level `tauri.conf.*` matched, so zsh aborted expansion and `rg` never searched the valid
  paths.
- Correction: pass concrete repository directories/files to `rg` (the Tauri config is under `src-tauri/`),
  or use `rg --files` to resolve candidates before invoking a second search.

## 2026-08-29 — Large structured command output cannot be parsed after transport truncation

- Command: parse the full 308-entry `talent-avatar-queue.mjs --all` JSON from a bounded command result.
- Failure: the command transport prefixed its truncation notice to the captured output, so `JSON.parse` saw
  the notice rather than the JSON array.
- Correction: compact large structured results inside the invoked process and print only the small derived
  summary; never increase the outer response budget merely to round-trip an internal catalog.

## 2026-08-29 — Hara's private OSS mirror requires the explicit Hong Kong endpoint

- Command: `ossutil ls oss://yimatrix-hk/hara/desktop/stable/`.
- Failure: the default ossutil endpoint returned `AccessDenied` with an endpoint redirect requirement.
- Correction: every Hara mirror read and write must pass `--endpoint oss-cn-hongkong.aliyuncs.com`; retain
  the private `yimatrix-hk` bucket and never compensate with a public object ACL.

## 2026-08-29 — Desktop release audit must override the workstation npm mirror

- Command: `npm audit --omit=dev --audit-level=high`.
- Failure: the workstation-level registry redirected the request to `registry.npmmirror.com`, whose security
  audit endpoint returns `404 NOT_IMPLEMENTED`; this is not evidence that dependencies are safe or vulnerable.
- Correction: release audits must set `npm_config_registry=https://registry.npmjs.org/` and
  `npm_config_replace_registry_host=always`, while keeping a task-specific writable npm cache. The official
  registry rerun completed with zero vulnerabilities.

## 2026-08-29 — Avatar completion marker is outside the workspace sandbox

- Command: run the completed Z-Image generator once with `--dry-run` so its zero-selection path writes the
  durable completion marker under the Hara user cache.
- Failure: the workspace sandbox could read the 308 generated repository assets but could not create the
  marker in the user Library cache, returning `Operation not permitted` after correctly reporting zero jobs.
- Correction: run only that no-op completion-marker step at the host boundary, then read the marker back and
  require `total: 308`. Generation itself remains the scheduled LaunchAgent's responsibility.

## 2026-08-29 — Old-engine reproduction needs the host loopback boundary

- Command: launch an isolated Hara 0.152.2 `serve` on `127.0.0.1:18890` from the workspace sandbox.
- Failure: the sandbox rejected the loopback bind with `listen EPERM` before compatibility behavior could be
  exercised.
- Correction: keep the test HOME and port isolated, but run the exact bounded Serve command at the host
  boundary; never reuse or stop the user's live discovery owner.

## 2026-08-29 — A Rust target alone is not a Windows cross-check toolchain

- Command: `cargo check --target x86_64-pc-windows-msvc` on the Apple Silicon release workstation.
- Failure: the target was installed, but `ring` could not compile because the host has no Windows/MSVC C
  headers (`assert.h` was unavailable).
- Correction: use local macOS `cargo check` for shared Rust plus source-contract tests for cfg-gated recovery,
  then require the real `windows-latest` release lane to compile and package the Windows implementation before
  publication. Do not describe the local target-only attempt as a Windows compile pass.

## 2026-08-29 — Desktop Rust formatting requires the nested manifest

- Command: `cargo fmt --check` from the Desktop repository root.
- Failure: the Tauri crate lives under `src-tauri`, so Cargo could not find a root-level `Cargo.toml`.
- Correction: always pass `--manifest-path src-tauri/Cargo.toml` for Desktop Rust format, check, and test gates.

## 2026-08-29 — Desktop Git fetch needs the host SSH boundary

- Command: `git fetch origin main` from the workspace sandbox before the emergency release.
- Failure: the sandbox rejected the repository SSH hop before GitHub authentication.
- Correction: rerun the same read-only fetch at the approved host boundary, then require a zero-divergence
  comparison before committing or tagging; do not skip the remote-race check.

## 2026-08-29 — Windows-only Tauri traits need a native pre-tag compile gate

- Symptom: Desktop `0.1.118` passed the macOS Rust checks and all renderer regressions, but the real MSVC
  release lane failed because the Windows-only `ExitRequested` guard called `AppHandle::state` without the
  `tauri::Manager` trait in that lexical scope.
- Root cause: the affected arm is removed by `#[cfg(windows)]` on the development Mac, while installing only
  the Rust Windows target cannot compile native dependencies without the MSVC headers and linker.
- Correction: import `tauri::Manager` at Windows module scope and add a `windows-latest` Cargo check job to
  ordinary main/PR CI. A release tag is now created only after that native preflight passes.

## [ERR-20260910-001] feishu-communicate transient message-fetch DNS failure

**Logged**: 2026-09-10T15:54:35Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary

The shared Feishu helper passed its configuration check, but the first read-only message export failed
with a transient DNS resolution error.

### Error

```
Feishu network error: <urlopen error [Errno 8] nodename nor servname provided, or not known>
```

### Context

- Operation: export recent messages from the canonical Hara feedback chat.
- The supported credential store remained inside the shared helper; no credential was printed or passed
  on the command line.

### Resolution

- **Resolved**: 2026-09-10T15:56:00Z
- **Notes**: An unchanged bounded retry first resolved the exact group and then exported the requested
  messages successfully.

### Recurrence on 2026-09-11T04:14:01+08:00

HARA-FB-001064 hit the same DNS error on a newest-message export and on the exact attachment download.
Three bounded read-only calls failed after `doctor` confirmed the supported configuration, so the worker
continued from existing local exports without switching credentials or bypassing the shared helper. The
network later recovered: the exact message and attachment, a fresh 14-day group export, the closure reply,
and its read-back all succeeded through the same helper.

### Recurrence on 2026-09-11 (HARA-FB-001068)

The supported helper's `doctor` call succeeded, but the immediately following exact-message and 90-day
group exports both failed at DNS resolution. Keep the operation read-only, retain the same supported
credential source, and use only bounded unchanged retries; never switch stores or scrape a signed-in browser.

After the issue reply succeeded and returned a concrete Feishu message ID, the immediate exact-message and
group read-back calls again failed at DNS resolution. Preserve the successful send receipt as evidence but do
not mark read-back verification complete until a later bounded fetch returns the same message and parent link.

### Recurrence on 2026-09-11 (HARA-CR-001079)

The exact crash-intake message read succeeded, but the immediately following 14-day newest-message export
failed at DNS resolution. Keep the supported helper and credential source unchanged, and retry the same
read-only export only a bounded number of times.

### Recurrence on 2026-09-11 (HARA-FB-001114)

The first 14-day newest-message export for the canonical feedback group failed at DNS resolution immediately
after `doctor` confirmed the supported configuration. One unchanged bounded retry succeeded and returned the
exact original thread plus current group context; no credential source or access boundary was changed.

### Recurrence on 2026-09-11 (HARA-FB-001124)

The exact message and newest 14-day group export succeeded through the supported helper, but downloading the
original image immediately afterward failed at DNS resolution. Keep the original message/resource identifiers,
credential source, and read-only operation unchanged; retry only a bounded number of times and retain the
historical linked reply as context rather than treating it as a substitute for a fresh attachment read.

### Recurrence on 2026-09-11 (HARA-CR-001129)

The initial `doctor` call failed at DNS resolution, but one unchanged, bounded `get-message` retry and the
subsequent newest 14-day group export succeeded through the same helper and credential source. Treat `doctor`
network failure as transient rather than as evidence that configuration is missing; keep the retry read-only and
do not switch credential stores or bypass the supported helper.

### Recurrence on 2026-09-11 (HARA-CR-001130)

The exact crash-intake message read succeeded, but the immediately following seven-day newest-message export
failed at DNS resolution. Keep the exact chat/message identifiers, supported helper, and credential source
unchanged; retry the same bounded read-only export without bypassing the approved path.

### Recurrence on 2026-09-11 (HARA-FB-001137)

The helper doctor resolved the configured Feishu service and listed the visible chats, but the exact-message,
group-export, and destination-resolution reads repeatedly failed at DNS resolution. Preserve the fixed chat
and message IDs, use only the shared helper, and wait for a later bounded unchanged retry; do not infer issue
content from neighboring tickets or switch credentials or clients. An honest blocked-status reply to the
original message succeeded through that same helper, but immediate and delayed read retries still failed. A
stage-only call through the canonical client confirmed the read failure occurs while acquiring the tenant
token, before the message endpoint returns any issue data.

### Recurrence on 2026-09-11 (HARA-CR-001160)

The first `doctor` call failed at DNS resolution, the exact crash-intake message then succeeded through the
same supported helper and credential source, and two bounded newest seven-day group exports failed again at
DNS resolution. Preserve the exact message as authoritative intake evidence, do not infer neighboring thread
context, and retry the unchanged read-only group export only after completing independent local diagnosis.

### Recurrence on 2026-09-11 (HARA-CR-001297)

The shared helper's configuration check succeeded, but the first newest seven-day export for the canonical
feedback group failed at DNS resolution before returning any issue data. Keep the chat, credential source, and
read-only operation unchanged; retry only a bounded number of times and inspect the export only after its
producer succeeds and creates a nonempty file.

### Recurrence on 2026-09-12 (HARA-CR-001302)

The shared helper's initial `doctor` call failed at DNS resolution before returning any Feishu data. Treat the
failure as transient rather than as missing configuration, preserve the exact chat and message identifiers, and
retry the supported exact-message read once without changing credentials or bypassing the approved helper.

### Recurrence on 2026-09-12 (HARA-FB-001309)

The exact feedback message and newest two-day group export succeeded through the supported helper, but all
three original-image downloads immediately failed at DNS resolution. Preserve the exact message and resource
keys, keep the operation read-only, and retry the same downloads only a bounded number of times without
changing credentials, clients, or access boundaries.

### Recurrence on 2026-09-14 (HARA-FB-001355)

The exact feedback message and newest seven-day group export succeeded through the supported helper, but the
first original-image download immediately failed at DNS resolution. Keep the exact source and supported
credential path unchanged, retry the read-only attachment batch once, and do not infer screenshot contents if
the bounded retry also fails. That later retry failed at the same download-endpoint DNS boundary even though
fresh exact-message and group reads had recovered, so diagnosis stayed limited to the verified text and source.

### Recurrence on 2026-09-16 (HARA-FB-001381)

The exact feedback message and newest group export succeeded through the supported helper, but the first of
three original-image downloads failed at DNS resolution. Preserve the exact message/resource identifiers and
credential source, retry the read-only attachment batch once, and do not infer screenshot contents if that
bounded retry also fails.

### Recurrence on 2026-09-20 (HARA-CR-001389)

The helper configuration check succeeded, but the first newest 30-day export for the canonical feedback group
failed at DNS resolution before any issue data was returned. Preserve the exact chat/message identifiers and
credential source, keep the retry read-only and unchanged, and inspect the export only after the producer
succeeds and creates a nonempty file. The authorized blocked-status reply later succeeded and returned a
concrete message ID, but the immediate exact-message read-back still failed at the same DNS boundary; retain
the send receipt without claiming read-back verification.

### Recurrence on 2026-09-22 (HARA-CR-001412)

The initial helper doctor and three bounded newest-group exports failed at DNS resolution, while the unchanged
exact-message read, blocked-status reply, and exact reply read-back succeeded through the same supported helper
and credential source. Preserve the successful exact-message evidence and reply receipt, do not treat the failed
group exports as empty results, and do not switch clients or credential stores.

### Recurrence on 2026-09-23 (HARA-CR-001415)

The helper configuration check succeeded, but the first newest seven-day export for the canonical feedback
group failed at DNS resolution before returning issue data. Preserve the exact chat/message identifiers and
supported credential source, retry the unchanged read-only operation once, and prefer the helper's exact-message
subcommand so group freshness and original-message retrieval can be verified independently.

### Metadata

- Reproducible: transient
- Related Files: `/Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py`
- Pattern-Key: feishu.retry_once_after_transient_dns_failure
- Recurrence-Count: 30
- First-Seen: 2026-09-10
- Last-Seen: 2026-09-23

---

## [ERR-20260910-002] self-improvement log add replaced an existing file

**Logged**: 2026-09-10T16:02:00Z
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary

An `Add File` patch was mistakenly used for an existing hidden learning log and replaced its committed
contents instead of appending one entry.

### Resolution

- **Resolved**: 2026-09-10T16:08:00Z
- **Notes**: Restored the exact committed log contents and appended the two new entries with an update
  patch. Session-history inspection found no intervening Desktop patches to this file after its last
  commit.

### Metadata

- Reproducible: yes
- Related Files: `.learnings/ERRORS.md`
- Pattern-Key: editing.inspect_hidden_file_with_rg_uu_before_add_file

---

## [ERR-20260911-001] jq redaction regex used an invalid character class

**Logged**: 2026-09-11T00:12:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

A one-off `jq` filter for viewing a redacted Feishu message failed before producing output because a
shell-escaped negated character class was malformed.

### Error

```
jq: Regex failure: premature end of char-class
```

### Context

- Operation: select one known message ID from a local, read-only Feishu JSON export and scrub sensitive
  values before displaying it.
- No project file or external state was changed by the failed command.

### Suggested Fix

Prefer selecting only the required structured fields first, then use simple independent substitutions
whose quoting can be reviewed directly. Avoid dense nested shell, JSON, and regular-expression escaping.

### Resolution

- **Resolved**: 2026-09-11T00:12:00+08:00
- **Notes**: Replaced the failed expression with a smaller field-selection and redaction pipeline.

### Metadata

- Reproducible: yes
- Related Files: `/private/tmp/hara_fb_000970_messages.json`
- Tags: jq, regex, redaction, feishu
- Pattern-Key: jq.shell_escaped_redaction_regex_charclass

---

## [ERR-20260911-002] GitHub release metadata asset download hit a transient connection failure

**Logged**: 2026-09-11T00:24:00+08:00
**Priority**: medium
**Status**: pending
**Area**: release-pipeline

### Summary

A bounded read-only download of `latest.json` and `release-source-provenance.json` failed at the GitHub
API connection after the release metadata query had succeeded.

### Error

```
error connecting to api.github.com
```

### Context

- Operation: independently verify the updater version and bundled sidecar provenance for an already
  published historical Hara Desktop fix.
- No release or repository state was changed.

### Suggested Fix

Retry the same two small public assets once with stderr bounded. Count updater/provenance as newly
verified only if the files download and their contents match the immutable release metadata.

### Recurrence on 2026-09-11T00:58:59+08:00

The web fetch surface returned `cache miss` for both exact GitHub release pages and rejected direct npm
registry/CDN JSON URLs under its URL-safety policy. Continue with the repository's read-only `gh api` and
release-channel audit paths; do not interpret a web cache miss as evidence that a public release is absent.

### Second recurrence on 2026-09-11T01:02:10+08:00

The fallback `/opt/homebrew/bin/gh api` call again failed to connect to `api.github.com`, the first-party
updater URL failed DNS resolution, and an exact `npm view` remained stuck without output until interrupted.
Stop the network branch after these bounded independent checks and report public-channel re-verification as
blocked; retain local tag, lock, source, and regression evidence separately.

### Third recurrence on 2026-09-11T01:02:10+08:00

Computer Use also reported that no browser surface was available, so the public GitHub page could not be
used as an independent fallback. This is an environment capability boundary, not release-state evidence.

### Fourth recurrence on 2026-09-11T01:50:00+08:00

An exact read-only `gh release view v0.1.144` audit again failed before metadata was returned. Stop this
network branch without retrying; retain the clean local tag regression, synchronized version/sidecar locks,
and the already-recorded Feishu release-verification notice as historical evidence, while stating that a new
public-channel check could not be completed in this runner.

### Fifth recurrence on 2026-09-11 (HARA-FB-001114)

Official GitHub API queries successfully returned the CLI 0.168.1 and Desktop 0.1.153 release records,
workflow conclusions, asset names, sizes, and SHA-256 digests. Two subsequent bounded downloads of the small
Desktop `latest.json` and provenance assets both failed to connect to `api.github.com`; retain the successful
metadata as public-release evidence but do not claim a fresh byte-level asset audit.

### Sixth recurrence on 2026-09-11 (HARA-FB-001124)

Four bounded `gh release view` checks for Desktop 0.1.154/0.1.159 and Engine 0.168.2/0.172.0 all failed to
connect before returning metadata. Stop the GitHub branch for this audit; retain exact local protected tags,
sidecar locks, isolated regressions, and the same-day Feishu release record without calling them a fresh
public API verification.

### Seventh recurrence on 2026-09-12 (Desktop 0.1.161 protected release)

One compact read-only poll of protected release run `34694453116` failed with
`error connecting to api.github.com` immediately after a successful structured poll and an online/busy
signing-runner check. Keep the hidden draft and signer job authoritative, retry the unchanged read once after
a bounded interval, and require both the completed workflow and public immutable-release audit before
announcing the release. Do not cancel or restart an active signer solely because the monitoring API flakes.

### Metadata

- Reproducible: transient
- Related Files: `WORKFLOW.md`, `scripts/release-channel-audit.mjs`
- See Also: ERR-20260827-GITHUB-ASSET-LOCAL-RESETS
- Tags: github, release, metadata, network
- Pattern-Key: github.release_metadata_download_bounded_retry
- Recurrence-Count: 7

---

## [ERR-20260911-003] Desktop release test was run from a git-archive export

**Logged**: 2026-09-11T00:30:00+08:00
**Priority**: low
**Status**: promoted
**Area**: tests

### Summary

The v0.1.159 source test run passed 276 checks but one release-pipeline test failed because `git archive`
does not include `.git`, while that test intentionally verifies Git attributes.

### Error

```
fatal: not a git repository (or any of the parent directories): .git
```

### Context

- The failure was in the test harness environment, not the Hara runtime or external-session behavior.
- Release metadata validation had already passed before the test run.

### Suggested Fix

Use an isolated local clone, not a `git archive`, when a release test suite contains Git-metadata checks.

### Resolution

- **Resolved**: 2026-09-11T00:30:00+08:00
- **Notes**: Verification was moved to a clean v0.1.159 clone with its own `.git` directory.

### Recurrence on 2026-09-11T03:41:00+08:00

Another v0.1.159 archive run reproduced the single Git-attribute failure after 276 passing tests. Initializing
an isolated temporary Git repository without changing the archived source was sufficient for that metadata-only
assertion; the rerun then passed all 277 tests and release metadata validation.

### Recurrence on 2026-09-11 (HARA-FB-001068)

The same exact-tag archive method again passed 276 checks and failed only the Git-attributes assertion because
the export had no `.git`. Stop using archive exports for the full Desktop suite; use an isolated local clone or
run only tag checks that do not require repository metadata.

### Metadata

- Reproducible: yes
- Related Files: `test/release-pipeline.test.mjs`
- Tags: git, archive, release-tests, isolation
- Pattern-Key: tests.git_metadata_requires_clean_clone_not_archive
- Recurrence-Count: 3
- Promoted: `AGENTS.md`

---

## [ERR-20260911-005] Full CLI suite was not a clean gate in the restricted runner

**Logged**: 2026-09-11T00:43:49+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary

While the clean v0.172.0 full CLI suite ran alongside Desktop verification, unrelated filesystem/TUI
tests missed timing windows and every test requiring a loopback listener failed with sandbox `EPERM`.

### Error

```
the same child is searchable after the user establishes it as cwd
actual: (no relevant code found) (project inventory stopped at its time limit)

listen EPERM: operation not permitted 127.0.0.1

test/tui-app.test.mjs timed out after 120000ms
```

### Context

- Operation: independently verify the already-published v0.172.0 tag for HARA-FB-000974.
- These failures are unrelated to Cron delivery, notification state, workspace-boundary recovery,
  or no-progress checkpoint handling; the relevant tests shown earlier in the same run passed.
- The host was simultaneously running the Desktop suite and several filesystem-heavy CLI tests.
- The restricted execution profile does not permit localhost listeners, so the full suite cannot pass here.

### Suggested Fix

Rerun the ticket-specific files serially under the pinned Node PATH, and rerun timing-only failures in isolation
where useful. Treat the full-suite gate as failed in this environment; for a scoped historical-ticket audit,
report environmental failures separately from the directly relevant tests and rely on public release CI for
the protected full gate.

### Recurrence on 2026-09-11T03:41:00+08:00

Clean CLI 0.166.0 and 0.172.0 snapshots again hit `listen EPERM` only in unrelated loopback-server tests. Both
builds succeeded, and rerunning the exact Volcengine `auto` compatibility regression by test name exited zero.

### Recurrence on 2026-09-11 (HARA-FB-001114)

The isolated CLI 0.168.1 build succeeded and 86 of 94 focused assertions passed. Eight cases from
`test/headless-outcomes.test.mjs` failed before exercising product behavior because their mock provider could
not bind `127.0.0.1` in the restricted runner. Direct task-state, credential guard, completion-receipt, and
gateway/cron regressions passed; retain the loopback cases as an environmental limitation and use protected
tag CI as the release-level gate.

### Recurrence on 2026-09-11 (HARA-FB-001124)

The isolated CLI v0.172.0 build and all 13 non-listening vision assertions passed. The connection-level and
Serve image-route cases stopped before their product assertions because the restricted runner rejected a
`127.0.0.1` listener with `EPERM`. Keep those cases recorded as an environment-limited gate and do not count
them as either product passes or failures; use the protected release CI evidence for the host-boundary gate.

### Recurrence on 2026-09-20 (HARA-FB-001399)

The pinned Node 22.23.1 Vite preview process was denied a new `127.0.0.1:8766` listener with the same
`listen EPERM` sandbox boundary, even though an already-running Python static server remained reachable.
For deterministic visual fixtures, build the preview into a private temporary directory and render the static
output instead of interpreting the bind denial as a frontend failure.

### Metadata

- Reproducible: unknown
- Related Files: `test/codebase.test.mjs`, `test/tui-app.test.mjs`, `test/web.test.mjs`
- Tags: tests, timeout, codebase-search, tui, sandbox, loopback, resource-contention
- Pattern-Key: tests.full_suite_requires_loopback_and_stable_host_timing
- Recurrence-Count: 5

---

## [ERR-20260911-006] Clean Desktop clone omitted the ignored sidecar required by Cargo

**Logged**: 2026-09-11T00:57:17+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

`cargo check` in a clean v0.1.159 clone reached the Tauri build script but could not continue because
the repository intentionally does not track the development sidecar binary.

### Error

```
resource path `binaries/hara-aarch64-apple-darwin` doesn't exist
```

### Context

- The clone contained the tracked `SIDECAR_VERSION` and `SIDECAR_COMMIT` locks, but not the ignored binary.
- No source compile error occurred before the build script enforced the missing-resource boundary.

### Suggested Fix

For a read-only historical audit, verify the tag locks in the clean clone, then run `cargo check` in the
same-tag working tree only after confirming its existing sidecar reports the locked version. Do not synthesize,
copy, or hand-edit a sidecar merely to make the gate pass.

### Resolution

- **Resolved**: 2026-09-11T00:57:17+08:00
- **Notes**: The current worktree is exactly tagged v0.1.159 and its existing sidecar reports 0.172.0; the
  Rust gate was moved there under the pinned 1.97.0 toolchain.

### Metadata

- Reproducible: yes
- Related Files: `src-tauri/binaries/SIDECAR_VERSION`, `src-tauri/binaries/SIDECAR_COMMIT`, `src-tauri/tauri.conf.json`
- Tags: tauri, cargo, sidecar, clean-clone, release-verification
- Pattern-Key: tests.tauri_cargo_check_requires_existing_ignored_sidecar

---

## [ERR-20260911-007] apply_patch rejected a writable temp-root target

**Logged**: 2026-09-11T01:56:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

`apply_patch` rejected creation of a single reply text file under `/private/tmp` as outside the project,
even though the command runner's filesystem profile permits that temporary root.

### Error

```
patch rejected: writing outside of the project; rejected by user approval settings
```

### Resolution

Create patch-authored temporary text inside the active writable repository with an explicit `.tmp-...`
name, then pass that file to the skill-owned sender. Do not fall back to shell redirection for authored
content merely because the two write mechanisms enforce different roots.

### Recurrence on 2026-09-11T03:43:00+08:00

The same boundary rejected a ticket-closure draft under `/private/tmp`; creating the draft with `apply_patch`
inside the active repository, sending it through the shared Feishu helper, and then deleting that exact file
with `apply_patch` completed the operation without weakening the write boundary.

### Recurrence on 2026-09-11T12:24:00+08:00

The HARA-FB-001062 closure draft hit the same `/private/tmp` patch boundary. Keep using a uniquely named
repository-local draft, pass it via `--text-file`, then remove that exact file with `apply_patch` after the
reply succeeds.

### Recurrence on 2026-09-11 (HARA-FB-001124)

The closure draft was again rejected under `/private/tmp` before any Feishu send. Create the uniquely named
draft inside the active Desktop repository, send it through `--text-file`, verify the returned message ID and
parent linkage, then delete only that draft with `apply_patch`.

### Recurrence on 2026-09-12 (HARA-CR-001302)

The same boundary rejected an allow-listed, read-only Control crash-report query script under `/private/tmp`.
Create the uniquely named script inside the active Desktop repository, validate it locally, use it only for the
protected operator lookup, and remove that exact script with `apply_patch` when the lookup workflow is done.

### Recurrence on 2026-09-12 (HARA-FB-001309)

The same boundary rejected the redacted Feishu progress-reply draft under `/private/tmp` before any message was
sent. Create the uniquely named draft inside the active Desktop repository, send it only to the verified original
message, verify its returned parent linkage, and remove that exact draft with `apply_patch` afterward.

### Recurrence on 2026-09-14 (HARA-FB-001355)

The same boundary rejected a temporary attachment-download wrapper under `/private/tmp`. The wrapper was then
created with an exact ticket-scoped name in the active repository, used only to pass untrusted resource keys as
subprocess argv values, and removed immediately after the bounded download attempt.

### Recurrence on 2026-09-16 (HARA-FB-001381)

The same boundary rejected a progress-reply draft under `/private/tmp` before any Feishu send. Create the
ticket-scoped draft inside the Desktop repository, verify it, send it only as a reply to the fixed original
message ID, then delete that exact draft with `apply_patch` after read-back verification.

### Recurrence on 2026-09-20 (HARA-FB-001392)

The same boundary rejected a presentation builder under `/private/tmp` even though command execution can write
there. Keep the patch-authored builder in a ticket-scoped directory inside the active Desktop repository while
allowing its generated artifacts to remain in the isolated temp workspace, then remove the builder after delivery.

### Recurrence on 2026-09-20 (HARA-FB-001399)

The same boundary rejected a temporary Hara UI preview fixture under `/private/tmp`. Keep all authored fixture
sources in a ticket-scoped repository directory, while placing generated screenshots and final artifacts in the
isolated temp workspace; remove the fixture source after delivery.

### Recurrence on 2026-09-23 (HARA-CR-001415)

A combined cleanup patch tried to delete the repository-local Feishu reply draft and the helper-generated group
export under `/private/tmp`. The external target caused the whole patch to be rejected atomically. Delete the
authored repository draft in a repository-only patch, and clean only the exact ticket-scoped generated export
through the command runner that created it; never broaden the target or use recursive deletion.

### Metadata

- Source: command_failure
- Reproducible: yes in this workspace
- Related Files: `.tmp-hara-cr-001013-reply.txt`
- Tags: apply-patch, temporary-file, workspace-boundary, feishu
- Pattern-Key: tooling.apply_patch_may_require_project_local_temp_files
- Recurrence-Count: 12
- Last-Seen: 2026-09-23

---

## [ERR-20260911-008] Recurrence-count patch used an under-scoped anchor

**Logged**: 2026-09-11T02:00:00+08:00
**Priority**: low
**Status**: promoted
**Area**: tooling

### Summary

A metadata-only patch matched the first generic `Recurrence-Count` line in the learning log and changed
an unrelated Rust toolchain entry instead of the intended Feishu DNS entry.

### Resolution

Compared the affected entry with `HEAD`, restored its original count, and updated the intended entry using
its stable `Pattern-Key` plus adjacent metadata as patch context. Never patch repeated metadata keys without
a unique section or pattern-key anchor.

### Recurrence on 2026-09-11T03:47:00+08:00

A new resolved cleanup entry was appended using only a generic `Recurrence-Count: 1` / separator context and
landed near the first matching entry instead of the file end. Move the exact full entry, then anchor additions
to the uniquely named preceding section and its stable pattern key.

### Recurrence on 2026-09-11 (HARA-FB-001068)

A status update used only the repeated `**Status**: resolved` line as its first hunk and changed the first
historical entry instead of the intended Git-archive entry. The erroneous line was compared with `HEAD` and
restored; both intended statuses were then patched under their exact entry headings.

### Recurrence on 2026-09-11 (HARA-FB-001137)

A new Feishu DNS recurrence entry was initially inserted using a generic separator hunk and landed near the
first historical entry. Remove that exact full entry, then merge the incident under the existing DNS pattern
using the unique entry heading and adjacent pattern key.

### Recurrence on 2026-09-14 (HARA-FB-001355)

A learning update guessed the exact historical entry title instead of reading it first, so `apply_patch`
safely rejected the hunk. Read the real heading and stable pattern key before constructing any repeated-log
edit, even when the nearby body text is already known.

### Recurrence on 2026-09-20 (HARA-CR-001389)

A DNS-pattern update copied one word of the existing paragraph incorrectly, so `apply_patch` safely rejected
the hunk. Read the exact target lines with numbers before retrying, even when the surrounding entry was just
displayed, then verify both the intended section and nearby repeated metadata after the write.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `.learnings/ERRORS.md`
- Tags: apply-patch, patch-context, learning-log
- Pattern-Key: tooling.patch_repeated_metadata_with_unique_context
- Recurrence-Count: 7
- Promoted: `AGENTS.md`

---

## [ERR-20260911-009] Feishu historical fetch exceeded the message limit

**Logged**: 2026-09-11T02:42:00+08:00
**Priority**: low
**Status**: resolved
**Area**: feedback-operations

### Summary

The first historical-window fetch for HARA-FB-001022 requested `--limit 1000`, while the shared
Feishu helper accepts at most 500 messages per invocation, so validation rejected the command before
any network read.

### Error

```
error: days/limit/preview-limit out of range
```

### Resolution

Inspect the helper's validated range after an ambiguous range error and retry with `--limit 500` and
`--preview-limit` between 1 and 100, saving the complete redacted result with `--output`.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `/Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py`
- Tags: feishu, feedback, cli-validation, pagination
- See Also: ERR-20260827-FEISHU-PREVIEW-LIMIT
- Pattern-Key: feishu.messages_limit_is_bounded
- Recurrence-Count: 1

---

## [ERR-20260911-010] Public release lookup returned stale or unavailable indexes

**Logged**: 2026-09-11T03:08:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-verification

### Summary

The web search index still showed an older npm version, while direct GitHub release and npm registry opens
returned cache-miss/safety errors. Those results could not verify the current Hara release.

### Resolution

Do not downgrade the conclusion from stale search snippets. Use the locally fetched signed tag lineage,
package metadata, Desktop sidecar lock, and exact tag-commit equality as the bounded provenance evidence;
state explicitly when a fresh public-registry check was unavailable.

### Recurrence on 2026-09-11T03:35:46+08:00

The first-party updater manifest was reachable and identified Desktop 0.1.159, while the web surface still
returned cache/safety failures for exact GitHub and npm URLs, `gh` was not installed on PATH, and direct
GitHub/npm curls could not resolve their hosts. Treat each public surface independently: retain the successful
updater evidence, stop bounded failed branches, and do not infer npm or GitHub state from the updater alone.

### Recurrence on 2026-09-11T12:18:00+08:00

Direct web opens for the first-party updater manifest, the exact GitHub Desktop release, the npm latest
document, and the download page again returned safety or cache-miss errors in one batch. Use a bounded
domain-scoped search to establish safe result references, then open only official results; if that still
fails, retain the local protected-tag and sidecar-lock evidence without claiming a fresh public check. Direct
curl retries could not resolve those hosts, and Computer Use reported that no browser surface was available,
so neither route may be presented as independent public verification for this run.

### Recurrence on 2026-09-11T04:49:31+08:00

HARA-FB-001064 received cache-miss/safety failures for the exact historical GitHub, npm and updater URLs;
bounded `gh release view` calls also could not connect. Verification therefore used the protected local tags,
exact Desktop-to-CLI locks, isolated tag regressions, and previously downloaded same-day official stable
manifest/provenance artifacts without claiming a fresh public API audit.

### Recurrence on 2026-09-11 (HARA-FB-001068)

Direct web opens for the exact Desktop and Engine release pages again returned cache-miss errors, and the
first-party updater URL was rejected by the web safety filter. The fallback search found the official Engine
repository but not the exact release records, so this run must keep fresh public-channel verification separate
from the local protected-tag, sidecar-lock, test, and same-day Feishu release evidence.

### Recurrence on 2026-09-11T05:12:00+08:00

HARA-FB-001065 received non-retryable safety rejections when directly opening exact GitHub release API and
npm registry URLs. The bounded `audit:release-channel -- stable v0.1.159` fallback also returned `fetch failed`.
Use official domain-scoped discovery or retained same-day public evidence; retain local tag ancestry and exact
sidecar-lock evidence if public endpoints remain unavailable, without claiming a fresh public fetch.

### Recurrence on 2026-09-11 (HARA-FB-001124)

Direct web opens for the exact Desktop 0.1.154/0.1.159, Engine 0.168.2/0.172.0, and npm version pages all
returned cache-miss errors. Do not treat the batch failure as release-state evidence; continue with bounded
official API or first-party updater checks, and otherwise report only the local tag/lock and same-day Feishu
evidence as newly available in this runner.

The bounded official GitHub queries then could not connect, the first-party updater host failed DNS
resolution, and neither the configured npm mirror nor `registry.npmjs.org` could resolve. Stop each failed
endpoint branch after its bounded check and do not claim a fresh public endpoint audit.

### Recurrence on 2026-09-11 (HARA-FB-001136)

Direct web opens for the exact Engine 0.172.0 and Desktop 0.1.159 GitHub releases, the npm latest document,
and the first-party updater manifest were all rejected by the web safety boundary before returning release
metadata. A separately bounded official `gh release view` then failed to connect to `api.github.com`. Treat
these reads as unavailable evidence, not a release-state result; continue with the protected local tags,
exact Desktop sidecar locks, isolated regressions, cached same-day release artifacts, and canonical Feishu
release record.

### Recurrence on 2026-09-20 (HARA-FB-001399)

Official search results freshly resolved TaleAI and Hara documentation, but direct opens for the Talking Photo
App Store ID and the mainland Hara download page were unavailable. Literal `curl` probes then failed before
HTTP at DNS resolution, and Computer Use exposed neither a browser provider nor a capturable Hara window.
Use the independently available official search result, repository-owned ASC IDs, current store screenshots,
and deterministic local preview fixtures; do not claim the unavailable endpoints were freshly fetched.

### Metadata

- Source: external_tool_failure
- Reproducible: unknown
- Related Files: `package.json`, `src-tauri/binaries/SIDECAR_VERSION`, `src-tauri/binaries/SIDECAR_COMMIT`
- Tags: web, release, registry, provenance
- Pattern-Key: release.web_index_can_lag_tag_provenance
- Recurrence-Count: 8

---

## [ERR-20260911-011] Repository rules were addressed relative to the skill directory

**Logged**: 2026-09-11T11:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The first combined preflight changed the command working directory to the Feishu skill and then tried to
read the product repository's `AGENTS.md` as a relative path, so the shell stopped before running the doctor.

### Error

```
sed: AGENTS.md: No such file or directory
```

### Resolution

Use explicit absolute paths whenever one command needs files owned by different repositories or installed
skills. The retry loaded the Desktop rules from their repository and invoked the skill helper by its absolute
path.

### Recurrence on 2026-09-14 (HARA-FB-001355)

The first combined preflight again selected the Feishu skill as its working directory and attempted to read
the Desktop repository's `AGENTS.md` by a relative path. The shell stopped before the doctor ran. The retry
split the checks by owner and used explicit working directories.

A later combined metadata/history probe read Desktop's sidecar lock successfully, then tried to resolve a CLI
commit in the Desktop repository. Keep cross-repository history calls separate and assign each command the
repository that owns its revisions and paths.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `AGENTS.md`, `/Users/zhujianbo/.codex/skills/feishu-communicate/SKILL.md`
- Tags: cwd, preflight, feishu, repository-rules
- Pattern-Key: tooling.cross_repository_preflight_uses_absolute_paths
- Recurrence-Count: 3

---

## [ERR-20260911-A7C] Recursive rm was rejected for an owned temporary evidence directory

**Logged**: 2026-09-11T03:46:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The command guard rejected `rm -rf` even though the target was one exact task-created directory under
`/private/tmp` and had been validated first.

### Error

```
rm -f style commands are not permitted. Use a safer approach
```

### Resolution

Validate that the exact task-owned target is a real directory and not a symlink, then use bounded
depth-first `find <exact-path> -depth -delete`; verify afterward that the target no longer exists.

### Recurrence on 2026-09-20 (HARA-FB-001399)

A render retry prefixed the bounded presentation command with `rm -rf` for one exact output directory, and
the command guard rejected the whole call. Use a new ticket-scoped render directory instead of deleting the
old one; preserve both attempts until final verification is complete.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `/private/tmp/hara-fb-001059.*`
- Tags: cleanup, temporary-files, command-guard, find
- Pattern-Key: tooling.task_temp_cleanup_avoids_recursive_rm
- Recurrence-Count: 2

---

## [ERR-20260911-C4E] Process-list probe unavailable in the managed sandbox

**Logged**: 2026-09-11T12:15:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

`pgrep` could not inspect processes because the managed macOS sandbox does not expose the sysmon service.

### Error

```
sysmon request failed with error: sysmond service not found
pgrep: Cannot get process list
```

### Resolution

Do not use process enumeration to recover a yielded test command in this environment. Re-run the bounded,
idempotent focused test directly and capture its completion result.

### Recurrence on 2026-09-11T04:14:01+08:00

A `ps` basename-only check was also denied with `operation not permitted` after a verification command yielded.
Apply the same recovery: do not enumerate processes; rerun the bounded target command and capture its exit.

### Recurrence on 2026-09-11 (HARA-FB-001136)

A packaged-sidecar smoke exceeded the initial yield, but the wrapper emitted only `output` rather than the
complete command result, losing the returned session identifier. Do not probe the process table to recover it;
rerun each read-only smoke independently under a short subprocess timeout and preserve its explicit exit code.

### Recurrence on 2026-09-20 (HARA-FB-001399)

A diagnostic `ps` call was denied while checking whether a headless Chrome screenshot process survived. The
bounded capture call had already returned, so process enumeration added no useful evidence; check the expected
output file directly and move to an allowed renderer.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `test/provider-target.test.mjs`
- Tags: sandbox, pgrep, test-verification
- Pattern-Key: tooling.managed_sandbox_has_no_process_list
- Recurrence-Count: 4

---

## [ERR-20260911-B9D] Isolated CLI verification stayed in the Desktop working directory

**Logged**: 2026-09-11T04:14:01+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

The first HARA-FB-001064 historical-tag verification extracted CLI `v0.166.1` into a temporary directory
but did not change the command working directory before invoking `npm run build`, so it started the current
Desktop build and produced no valid CLI ticket evidence.

### Error

```
> hara-desktop@0.1.159 build
```

### Resolution

Run each bounded build/test invocation with the command runner's explicit `workdir` set to the extracted
directory. Verify the package name/version before accepting any test output as evidence. The accidental
Desktop build changed no tracked source files.

### Recurrence on 2026-09-11T05:08:00+08:00

A combined read-only probe correctly inspected the CLI first but then attempted Desktop-relative paths without
switching back to the Desktop worktree. Split cross-repository probes and set `workdir` explicitly for each.

### Recurrence on 2026-09-11 (HARA-FB-001136)

A parallel tag-metadata probe correctly read Desktop v0.1.159, then mistakenly asked the Desktop repository
for Engine tag v0.172.0 and exited with an unknown-revision error. Query each product tag only in its owning
repository; the independent CLI probe supplied the valid Engine evidence.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `package.json`, `../hara-cli/package.json`
- Tags: cwd, isolated-verification, historical-tag, tests
- Pattern-Key: tests.historical_tag_verification_sets_explicit_workdir
- Recurrence-Count: 3

---

## [ERR-20260911-012] Post-send verification continued after Feishu exports failed

**Logged**: 2026-09-11T05:30:00+08:00
**Priority**: low
**Status**: resolved
**Area**: feedback-operations

### Summary

A combined reply-verification command ran three network exports and then attempted `jq` inspection even though
the exports had failed at DNS resolution, producing a secondary missing-file error with no useful evidence.

### Resolution

Split exact-message and group read-back into independent fail-fast calls. Inspect a local export only after its
producer exits successfully and the expected file exists and is nonempty; keep the successful send receipt
separate from later read-back status.

### Recurrence on 2026-09-11T06:46:00+08:00 (HARA-FB-001114)

The first post-send check again combined exact-message read-back and the group export behind `set -e`; a
transient DNS failure in the first operation prevented the independent group refresh from running. No missing
file was inspected and the successful send receipt was preserved. Splitting the operations allowed the exact
reply retry and subsequent group export to succeed independently.

### Recurrence on 2026-09-11 (HARA-FB-001124)

A first-party updater fetch failed DNS resolution, but the same shell continued into `jq` and produced a
secondary missing-file error. Network evidence commands must use `set -e` or an explicit producer-success and
nonempty-file check before any parser runs.

### Recurrence on 2026-09-12 (HARA-CR-001302)

An exact-message read was piped directly into a JSON minimizer. When the upstream Feishu call failed at DNS
resolution, the minimizer still received empty input and emitted a secondary `JSONDecodeError`. Capture and
check the helper exit status before parsing or projecting any message payload.

### Metadata

- Source: command_failure
- Reproducible: yes when a network export fails
- Related Files: `/Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py`
- Tags: feishu, verification, fail-fast, jq
- Pattern-Key: tooling.inspect_generated_evidence_only_after_success
- Recurrence-Count: 4

---

## [ERR-20260911-013] Managed runner rejected the protected crash-report SSH lookup

**Logged**: 2026-09-11T05:52:14+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary

The read-only production-host lookup for HARA-CR-001108 was rejected before SSH connected, so the protected
Control report could not be retrieved through the local operator path from this managed runner.

### Error

```
ssh: connect to host <production-host> port 22: Operation not permitted
```

### Context

- Operation: run an allow-listed, read-only crash-report query through the production host's localhost-only
  Control admin endpoint.
- The report ID was validated as a UUID before the attempt.
- The protected credential remained inside the production environment; no credential or authorization header
  was printed or placed on the command line.
- The connection failed before reaching the host, and no production state changed.

### Recurrence on 2026-09-11 (HARA-CR-001129)

The allow-listed UUID and an output-minimized redaction helper passed local validation, but the identical
production-host lookup was rejected with `Operation not permitted` before SSH connected. No authenticated
Control browser surface was available. Preserve the local code and Feishu evidence, but do not classify the
specific report or mutate its review status until the protected report is retrieved through an approved path.

### Recurrence on 2026-09-11 (HARA-CR-001130)

The report-specific redaction helper passed local syntax and UUID validation, but the production SSH lookup
was again rejected with `Operation not permitted` before the host was reached. Do not infer this report's root
cause from neighboring alerts or change its Control review state without retrieving the protected record.

### Recurrence on 2026-09-12 (HARA-CR-001302)

The exact allow-listed UUID and a locally validated output-minimizing query again reached the same managed
runner boundary: SSH was rejected with `Operation not permitted` before connecting to the production host.
No report data or credential was accessed and no production state changed.

### Recurrence on 2026-09-20 (HARA-CR-001389)

The exact event-matched UUID was validated from the owner-only monitor queue, but the read-only SSH preflight
was rejected with `Operation not permitted` before connecting to the production host. No report data or
credential was accessed and no production state changed; only an already-authenticated Control console remains
an allowed fallback from this runner.

### Recurrence on 2026-09-22 (HARA-CR-001412)

The exact allow-listed UUID and output-minimized query passed local syntax validation, but SSH was rejected with
`Operation not permitted` before reaching the production host. Computer Use exposed no browser surface, and the
running Chrome app had no capturable window, so no already-authenticated Control console was available. No report
data or administrator credential was accessed, no production state changed, and the original Feishu thread was
updated with the precise blocker instead of a root-cause or release claim.

### Recurrence on 2026-09-23 (HARA-CR-001415)

The exact allow-listed UUID and output-minimized query passed local syntax validation, but SSH was again rejected
with `Operation not permitted` before reaching the production host. Chrome was capturable this time, but its open
tabs contained no Hara Control console and local port 4100 had no listener, so no already-authenticated protected
console path was available. No report data or administrator credential was accessed and no production state changed.

### Suggested Fix

Resume the same read-only lookup in an approved network environment, or use an already-authenticated Control
console session if one is already available. Do not bypass the boundary through a GUI terminal, browser
storage, or credential extraction.

### Metadata

- Source: external_tool_failure
- Reproducible: yes in the current managed runner
- Related Files: `.tmp-hara-cr-001108-query.mjs`, `.tmp-hara-cr-001129-query.mjs`, `.tmp-hara-cr-001130-query.mjs`, `.tmp-hara-cr-001302-query.mjs`, `../hara-control/AGENTS.md`
- Tags: crash-intake, control, ssh, sandbox, production-read
- Pattern-Key: control.production_crash_lookup_requires_approved_network_or_authenticated_console
- Recurrence-Count: 7
- Last-Seen: 2026-09-23

---

## [ERR-20260911-014] Feishu exact-message helper subcommand was guessed instead of checked

**Logged**: 2026-09-11T06:44:04+08:00
**Priority**: low
**Status**: resolved
**Area**: feedback-operations

### Summary

While refreshing HARA-FB-001114, the first help probe used the nonexistent `message` subcommand even though
the supported helper names the operation `get-message`. No network mutation was attempted.

### Resolution

Read the top-level helper command inventory first, then use `get-message --help` before the exact-message
read. Do not infer a singular subcommand from the plural `messages` operation.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `/Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py`
- Tags: feishu, helper-cli, issue-intake
- Pattern-Key: tooling.feishu_exact_message_uses_get_message_subcommand
- Recurrence-Count: 1

---

## [ERR-20260911-D2B] Release provenance query assumed target objects

**Logged**: 2026-09-11T08:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-verification

### Summary

A read-only `jq` projection assumed `release-source-provenance.json.targets` contained objects, while the
schema stores target triples as strings. The query failed before returning target details.

### Error

```text
jq: Cannot index string with string "target"
```

### Resolution

Inspect `type`, top-level keys, and the shape of nested collections before projecting optional provenance
fields. Query only the validated schema keys; the failed read changed no artifact or repository state.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `release-source-provenance.json`
- Tags: jq, json-schema, release-provenance, verification
- Pattern-Key: tooling.inspect_release_provenance_shape_before_projection
- Recurrence-Count: 1

---

## [ERR-20260911-FB1137-IMPORT] Dynamic skill-module load omitted Python module registration

**Logged**: 2026-09-11T00:28:11Z
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

A read-only diagnostic loaded the canonical Feishu helper through `importlib` without first registering the
module in `sys.modules`. Python's `dataclass` processing failed locally before any Feishu request was made.

### Error

```text
AttributeError: 'NoneType' object has no attribute '__dict__'
```

### Resolution

Insert the module object into `sys.modules` under the spec name before calling `exec_module`, then reuse the
canonical helper's configuration discovery and client implementation. Do not create a project-local Feishu
client or expose message content during the stage-only diagnostic.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `/Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py`
- Tags: python, importlib, dataclass, feishu, diagnostics
- Pattern-Key: tooling.importlib_dataclass_requires_sys_modules_registration
- Recurrence-Count: 1

---

## [ERR-20260911-FB1151-JQ-SHAPE] Artifact manifest query assumed a scalar was an object

**Logged**: 2026-09-11T08:37:07+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary

A read-only `jq` projection of the downloaded soft-copyright source-sampling manifests called `keys` on
the `repository` field, but that field is a repository-name string rather than an object. The query failed
before returning the requested summary and made no file or repository change.

### Error

```text
jq: error: string ("hara-cli") has no keys
```

### Resolution

Inspect nested JSON field types before applying object-only filters, then project scalar fields directly.
Use type-safe alternatives for optional mixed-shape data rather than assuming the structure from its name.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: downloaded `源代码取样清单.json` evidence for HARA-FB-001151
- Tags: jq, json-schema, document-verification, feishu
- See Also: ERR-20260911-D2B
- Pattern-Key: tooling.inspect_json_field_type_before_object_projection
- Recurrence-Count: 1

---

## [ERR-20260911-FB1151-DOCX-RUNTIME] System Python could not run the managed DOCX renderer

**Logged**: 2026-09-11T08:38:00+08:00
**Priority**: low
**Status**: pending
**Area**: docs

### Summary

The first read-only invocation of the Documents skill renderer used `python3`, which resolved to the system
Python and failed because `pdf2image` is not installed there. No document was edited or rendered.

### Error

```text
ModuleNotFoundError: No module named 'pdf2image'
```

### Suggested Fix

Resolve and use the Codex primary workspace runtime's Python, Poppler, and bundled LibreOffice paths as the
Documents skill requires. Do not install into the system Python or use the user's desktop LibreOffice.

### Metadata

- Source: command_failure
- Reproducible: yes with system `python3`
- Related Files: `/Users/zhujianbo/.codex/plugins/cache/openai-primary-runtime/documents/26.909.12148/skills/documents/render_docx.py`
- Tags: documents, pdf2image, workspace-runtime, render-verification
- Pattern-Key: documents.use_managed_runtime_for_render_docx
- Recurrence-Count: 1

---

## [ERR-20260912-001] Monitor queue projection assumed non-persisted source fields

**Logged**: 2026-09-12T02:40:00+08:00
**Priority**: low
**Status**: promoted
**Area**: feedback-operations

### Summary

A read-only projection of the HARA-CR-001302 owner-only monitor record assumed the queue persisted the full
normalized Feishu message, including `text` and `chatId`. The queue intentionally stores only a sanitized
ticket title/summary and provenance fields, so the validation exited without extracting a report ID.

### Recurrence on 2026-09-12 (HARA-CR-001303)

The canonical Feishu `messages --output` export was initially projected as a top-level array, but the helper
stores an object whose `messages` field is the array. The failed `jq` projection stopped before any write;
inspect top-level keys and value types before selecting related messages.

### Recurrence on 2026-09-16 (HARA-FB-001381)

The same top-level-array assumption recurred while selecting an exact feedback thread from a fresh canonical
Feishu export. The read-only projection failed before any write; after inspecting the exported shape, select
from `.messages` and keep the source message text out of shell interpolation.

### Resolution

Inspect the record's top-level keys and value types first, then extract the allow-listed report UUID only from
the actual sanitized `ticketTitle`/`ticketSummary` fields. Keep a fresh canonical Feishu read as the source
verification instead of treating the queue record as a substitute.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `../hara-control/scripts/hara-feishu-monitor.py`
- Tags: json-schema, feishu, monitor, crash-intake
- See Also: ERR-20260911-FB1151-JQ-SHAPE
- Pattern-Key: tooling.inspect_json_schema_before_projection
- Recurrence-Count: 3
- Last-Seen: 2026-09-16
- Promoted: `AGENTS.md`

---

## [ERR-20260912-002] Desktop Cargo and rustc resolved from different toolchains

**Logged**: 2026-09-12T15:40:00+08:00
**Priority**: low
**Status**: resolved
**Area**: build-tooling

### Summary

The first Tauri check resolved Homebrew Cargo/Rust 1.84.1 even though rustup reported 1.97 as the active
toolchain. Calling only rustup's Cargo by absolute path still left Homebrew `rustc` first on `PATH`.

### Error

Cargo 1.84 could not parse an edition-2024 dependency; the mixed retry then reported that current crates
require rustc 1.85–1.89.

### Resolution

Prepend `/Users/zhujianbo/.cargo/bin` to `PATH` so both Cargo and rustc resolve through the same rustup
toolchain. `cargo check` then completed with Rust 1.97.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: src-tauri/Cargo.lock
- Tags: rust, cargo, tauri, path, toolchain
- Pattern-Key: desktop.prepend_rustup_bin_for_cargo_and_rustc
- Recurrence-Count: 1

---

## [ERR-20260912-FB1309-PATCH-DRIFT] Mobile pairing component changed during a prepared patch

**Logged**: 2026-09-12T15:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary

An `apply_patch` prepared from an earlier read of `MobilePairingSettings.tsx` failed cleanly because another
workspace writer had added the account-loading state in the meantime. No part of the failed patch was applied.

### Resolution

Read the component and relevant diff again, preserve the concurrent loading-state improvement, and anchor any
follow-up patch to the latest exact text rather than overwriting or restoring the older version.

### Metadata

- Source: command_failure
- Reproducible: no
- Related Files: src/MobilePairingSettings.tsx
- Tags: apply-patch, concurrent-worktree, mobile-pairing
- Pattern-Key: editing.reread_after_concurrent_context_drift
- Recurrence-Count: 1

---

## [ERR-20260913-FB1337-DNS] Public Yimatrix asset fetch hit transient DNS failure

**Logged**: 2026-09-13T22:30:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary

During HARA-FB-001337 diagnosis, the first HTTPS fetch of `admin1.yimatrix.ai` returned its current HTML,
but an immediate bounded fetch of the referenced JavaScript entry failed before HTTP with a DNS resolution
error. A single failed lookup is not evidence that the deployed asset itself is missing.

### Error

```text
curl: (6) Could not resolve host: admin1.yimatrix.ai
```

### Suggested Fix

Keep the public-site probe read-only and retry it unchanged after completing independent local bundle analysis.
Only classify the production chunk after an HTTP response establishes its status, content type, and body.

### Resolution

- **Resolved**: 2026-09-13T22:37:16+08:00
- **Notes**: The unchanged bounded retries succeeded. The current entry module and all three Motimo chunks
  returned HTTP 200 with JavaScript MIME; the prior-build Motimo chunk returned a reproducible HTTP 404.

### Metadata

- Source: command_failure
- Reproducible: transient
- Related Files: `/tmp/hara-fb-001337-home.html`
- Tags: dns, curl, frontend-assets, feedback-operations
- Pattern-Key: verification.separate_dns_failure_from_asset_failure
- Recurrence-Count: 1

---

## [ERR-20260913-FB1337-BUILD-SANDBOX] Vite config loader wrote beside a read-only source tree

**Logged**: 2026-09-13T22:41:00+08:00
**Priority**: low
**Status**: resolved
**Area**: build-tooling

### Summary

Passing a writable `--outDir` was insufficient for an isolated YiMatrix Admin build because Vite 6 first
bundled its config into `node_modules/.vite-temp` inside the read-only source repository.

### Error

```text
Error: EPERM: operation not permitted, open '.../node_modules/.vite-temp/vite.config.js.timestamp-....mjs'
```

### Resolution

Build an exact tracked-source clone under `/tmp` with the repository's Node 20 runtime instead of attempting
to write any Vite cache beside the read-only source checkout. Keep the original worktree and generated `dist`
untouched.

### Metadata

- Source: command_failure
- Reproducible: yes in the managed sandbox
- Related Files: `/Users/zhujianbo/work/projects/zy/yimatrix-admin/vite.config.js`
- Tags: vite, sandbox, isolated-build, generated-output
- Pattern-Key: vite.clone_read_only_source_before_isolated_build
- Recurrence-Count: 1

---

## [ERR-20260913-FB1337-NPM-STALL] Isolated npm install produced no output until bounded interruption

**Logged**: 2026-09-13T22:44:00+08:00
**Priority**: low
**Status**: resolved
**Area**: build-tooling

### Summary

`npm ci` in the temporary YiMatrix Admin clone remained active without output across several bounded polls,
and the managed sandbox also denied a `ps` inspection. Waiting longer would not add useful issue evidence.

### Resolution

Interrupt the unified exec session and confirm its exit code through `write_stdin`; do not depend on process
listing in this sandbox. Reuse the already installed locked dependency tree by copying it into the writable
temporary clone, then run the production build there.

### Metadata

- Source: command_failure
- Reproducible: unknown
- Related Files: `/tmp/hara-fb-001337-yimatrix.uiGEGh/repo/package-lock.json`
- Tags: npm, network, sandbox, bounded-wait, isolated-build
- Pattern-Key: tooling.interrupt_silent_install_then_reuse_locked_dependencies
- Recurrence-Count: 1

---

## [ERR-20260913-FB1337-WITHDRAWN] Feishu rejected a status reply after the source was withdrawn

**Logged**: 2026-09-13T22:54:24+08:00
**Priority**: low
**Status**: resolved
**Area**: feedback-operations

### Summary

The HARA-FB-001337 original message was visible when intake began, but its author withdrew it during
diagnosis. Feishu rejected the authorized blocked-status reply; no message was sent.

### Error

```text
Feishu HTTP error: code=230011 msg=The message was withdrawn.
```

### Resolution

Do not retry a reply to a withdrawn message and do not substitute a neighboring or forbidden message ID.
Refresh the exact source and canonical group read-only, retain the failed-send receipt as evidence, and report
the channel-level blocker to the triggering user.

### Metadata

- Source: command_failure
- Reproducible: yes after withdrawal
- Related Files: `/Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py`
- Tags: feishu, withdrawn-message, reply, fail-closed
- Pattern-Key: feishu.do_not_retarget_withdrawn_source_reply
- Recurrence-Count: 1

---

## [ERR-20260914-001] Git follow history was requested for multiple pathspecs

**Logged**: 2026-09-14T16:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

Two read-only history probes passed several files to `git log --follow`, but Git accepts exactly one pathspec
when rename following is enabled.

### Error

```text
fatal: --follow requires exactly one pathspec
```

### Resolution

For a combined component history, omit `--follow` and pass all relevant paths. Use separate one-path commands
only when following a specific file across renames is necessary.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `src/GatewaySettings.tsx`, `../hara-cli/src/gateway/serve.ts`
- Tags: git, history, diagnosis
- Pattern-Key: git.follow_accepts_one_pathspec
- Recurrence-Count: 1

---

## [ERR-20260914-002] Patch payload used an unsafe JavaScript delimiter

**Logged**: 2026-09-14T16:15:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

Two apply-patch orchestration calls chose delimiters that also appeared inside the patch body. A quoted
JavaScript string collided with source-code quotes; the raw-template retry then collided with Markdown
backticks. Both calls failed in JavaScript parsing before any file write.

### Error

~~~text
SyntaxError: Unexpected identifier
~~~

### Resolution

For multi-line patches, use a template payload only after confirming the entire body contains no template
delimiter. Remove incidental Markdown backticks from learning-log patches and split source edits into bounded
payloads whose delimiter safety is easy to inspect.

### Recurrence during HARA-FB-001355

A later test patch used a template payload around an existing source line that itself contained a JavaScript
template literal. Switch all patches containing source templates to arrays of ordinary quoted lines joined
with newlines.

A subsequent multi-entry learning patch encoded removal of a Markdown list item with only one leading hyphen,
so the patch expected content without the list marker and was safely rejected. When array-building a patch,
remember that deleting a source line which begins with `-` requires two leading hyphens in the patch payload.

### Recurrence during HARA-FB-001399

A combined learning-log patch anchored one insertion to the preceding recurrence text instead of the exact
target heading and stable pattern key. The file had the same sentence in a different recurrence, so verification
safely rejected the whole patch. Re-read each target block and split or anchor every hunk to its entry heading.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: ../hara-cli/src/gateway/runtime-state.ts
- Tags: apply-patch, javascript, quoting
- Pattern-Key: tooling.apply_patch_payload_uses_safe_js_delimiter
- Recurrence-Count: 5

---

## [ERR-20260920-001] BSD sed rejected a non-capturing regex group

**Logged**: 2026-09-20T11:10:06+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

A redaction-only inspection command used the non-capturing group syntax `(?:...)` with BSD `sed -E`, which
does not support that syntax, so the inspection failed before reading the SSH error file.

### Error

```text
RE error: repetition-operator operand invalid
```

### Resolution

Use ordinary POSIX ERE capture groups with BSD `sed -E`, or avoid an unnecessary redaction expression when
the bounded error source cannot contain request headers or credentials. The subsequent plain read confirmed
the SSH attempt had failed locally with `Operation not permitted` before connecting.

### Metadata

- Source: command_failure
- Reproducible: yes on macOS BSD sed
- Related Files: `/private/tmp/hara-cr-001389.owARzA/ssh-preflight.err`
- Tags: sed, regex, macos, redaction
- Pattern-Key: shell.bsd_sed_has_no_noncapturing_groups
- Recurrence-Count: 1

---

## [ERR-20260920-002] Tauri tests in a Git worktree lacked ignored sidecars

**Logged**: 2026-09-20T11:43:53+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

Running the native test suite in an isolated Git worktree failed before compilation because ignored
`hara-<target>` and `herdr-<target>` sidecar binaries are not populated by `git worktree add`.

### Error

```text
resource path `binaries/hara-aarch64-apple-darwin` doesn't exist
resource path `binaries/herdr-aarch64-apple-darwin` doesn't exist
```

### Resolution

Before Tauri verification in an isolated worktree, temporarily copy the target-matching sidecars from a
verified primary checkout (or run the repository sidecar preparation workflow), run tests with the pinned
Rust toolchain first on `PATH`, and remove the temporary ignored binaries afterward. Native tests then passed
48/48.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `src-tauri/tauri.conf.json`, `src-tauri/binaries/`
- Tags: tauri, git-worktree, sidecar, tests
- Pattern-Key: tests.worktree_requires_ignored_sidecars
- Recurrence-Count: 1

---

## [ERR-20260920-003] Presentation reference font policy omitted the source hash

**Logged**: 2026-09-20T19:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The presentation finalizer rejected a reference-based font policy because the approved PPTX path was supplied
without its SHA-256 digest.

### Error

```text
Error: Typography reference must be a SHA-bound PPTX or PDF
```

### Resolution

Hash the exact approved reference bytes in the builder and supply both `referencePath` and
`referenceSha256`. This preserves reference-font provenance without weakening validation.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `.tmp-hara-fb-001399/build-deck.mjs`
- Tags: presentations, finalizer, fonts, provenance
- Pattern-Key: presentations.reference_font_policy_requires_sha256
- Recurrence-Count: 1

---

## [ERR-20260920-004] Presentation helpers were started without the managed runtime environment

**Logged**: 2026-09-20T19:12:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The presentation finalizer import check and the renderer were first invoked without the required managed
runtime environment variables.

### Error

~~~text
Error: RUNTIME_NODE_MODULES is required.
RuntimeError: RUNTIME_NODE is required.
~~~

### Resolution

Export the full runtime contract before finalization or rendering: RUNTIME_NODE, RUNTIME_NODE_MODULES, and
RUNTIME_BIN_DIR, while invoking the pinned runtime Python and Node binaries explicitly.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: presentation finalizer and render_slides.py
- Tags: presentations, runtime, finalizer, renderer
- Pattern-Key: presentations.helpers_require_managed_runtime_environment
- Recurrence-Count: 1

---

## [ERR-20260920-005] LibreOffice compatibility render initially lost Chinese fonts

**Logged**: 2026-09-20T19:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary

The Homebrew soffice shim pointed to a removed temporary app, and the first managed LibreOffice conversion
used an incomplete fontconfig environment. The PDF opened, but Chinese text rendered as boxes or disappeared.

### Error

~~~text
No such file or directory: /private/tmp/talkingphoto-softcopyright-reference/apps/LibreOffice.app
Fontconfig error: No writable cache directories
~~~

### Resolution

Use the primary runtime's soffice override, give it a ticket-scoped XDG_CACHE_HOME, and set FONTCONFIG_FILE
to /opt/homebrew/etc/fonts/fonts.conf. Re-render every page and verify Chinese text and all QR codes from the
resulting PDF before calling the PPTX compatible.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: presentation compatibility render
- Tags: presentations, libreoffice, fontconfig, chinese
- Pattern-Key: presentations.libreoffice_uses_runtime_soffice_and_explicit_fontconfig
- Recurrence-Count: 1

---

## [ERR-20260920-006] Feishu helper was invoked as an executable without execute permission

**Logged**: 2026-09-20T19:28:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary

The first help probe called feishu_chat.py directly even though the shared skill script is not executable.

### Error

~~~text
permission denied: feishu_chat.py
~~~

### Resolution

Invoke the shared helper through python3 unless its executable bit has been verified. The same helper then
completed the exact-message refresh, closure reply, attachment replies, and read-back verification.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: /Users/zhujianbo/.codex/skills/feishu-communicate/scripts/feishu_chat.py
- Tags: feishu, python, permissions
- Pattern-Key: feishu.helper_requires_python_interpreter_when_not_executable
- Recurrence-Count: 1

---

## [ERR-20260923-001] Native Computer Use pipe was unavailable during Desktop smoke

**Logged**: 2026-09-23T20:10:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary

The Computer Use inventory could not attach to native applications, so the final renderer reconnect click
could not be driven or visually verified through the automation surface.

### Error

```text
Sky Computer Use native pipe startup failed
```

### Context

- Operation: inspect the running Hara development app after replacing and restarting its sidecar.
- Resetting the CUA session did not restore native-app inventory; CLI capability and runtime checks remained available.

### Suggested Fix

Restart the native Computer Use bridge, then reconnect the existing Hara process and visually verify the
WeChat scene status. Until then, leave the final group confirmation to the user rather than substituting an
unverified UI action.

### Metadata

- Reproducible: yes
- Related Files: `src/WeChatSceneSettings.tsx`
- Tags: computer-use, native-pipe, desktop-smoke
- Pattern-Key: tests.native_computer_use_pipe_unavailable
- Recurrence-Count: 2
- Last-Seen: 2026-09-23

---

## [ERR-20260924-001] Bun emitted a stale macOS ad-hoc signature for the refreshed sidecar

**Logged**: 2026-09-24T00:20:00+08:00
**Priority**: high
**Status**: resolved
**Area**: build

### Summary

The standalone sidecar compiled successfully, but macOS killed it with exit 137 before `--version`; the
linker-generated ad-hoc signature no longer matched the Mach-O payload.

### Error

```text
invalid signature (code or signature have been modified)
In architecture: arm64
```

### Context

- Operation: refresh the local Desktop sidecar after updating the embedded WeChat bridge.
- `file` still identified a valid arm64 Mach-O and source/copy SHA-256 matched.
- A disposable copy ran normally after an explicit local ad-hoc re-sign, isolating the failure to the
  generated signature rather than the Hara payload.

### Suggested Fix

On macOS targets, verify Bun's source ad-hoc signature immediately after compilation. If it is stale,
repair only that disposable source binary with `codesign --force --sign -`, verify it, then run the normal
boundary smoke. Protected packaging must still remove the source ad-hoc signature before Tauri applies the
sole Developer ID signature.

### Metadata

- Reproducible: yes
- Related Files: `scripts/refresh-sidecar.sh`, `scripts/build-mac-signed.sh`, `test/release-pipeline.test.mjs`
- Tags: bun, macos, codesign, sidecar, build
- Pattern-Key: build.macos_bun_stale_adhoc_signature
- Recurrence-Count: 1

### Resolution

The refresh script now verifies and conditionally repairs stale macOS ad-hoc signatures, stages the Desktop
copy on a fresh inode, and atomically replaces the prior executable before runtime smoke. This avoids macOS
retaining a rejected signature state on an in-place-overwritten vnode. Release comments and a pipeline
regression test preserve the later single Developer ID pass.

---

## [ERR-20260924-RELEASE-CHANNEL-AUDIT-PHASE] Public channel audit was invoked without its phase argument

**Logged**: 2026-09-24T11:16:00+08:00
**Priority**: low
**Status**: resolved
**Area**: release-validation

### Summary

The pre-tag gate invoked `release-channel-audit.mjs` without the required `versioned`, `stable`, or `all`
argument. The script correctly returned usage status 2; all actual Desktop build gates had already passed.

### Resolution

Keep this audit in the post-publication phase and run `npm run audit:release-channel -- all vX.Y.Z` only
after the protected workflow has published GitHub assets and the first-party stable mirror.

### Metadata

- Source: command_failure
- Reproducible: yes
- Related Files: `scripts/release-channel-audit.mjs`, `WORKFLOW.md`
- Tags: release, audit, phase-order
- Pattern-Key: release.public_channel_audit_runs_after_promotion
- Recurrence-Count: 1

---

# Errors

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

### Metadata

- Source: tool_failure
- Reproducible: yes in the restricted environment
- Related Files: src/theme-light.css, test/theme.test.mjs, test/ui-regressions.test.mjs
- Tags: zsh, feishu, vite, browser, visual-qa, node-path
- Pattern-Key: tooling.theme_audit_respects_shell_and_visual_qa_constraints
- Recurrence-Count: 1

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

### Metadata

- Source: command_failure
- Reproducible: yes with the legacy system Cargo first in PATH
- Related Files: .rust-version, src-tauri/Cargo.lock, src-tauri/Cargo.toml
- Pattern-Key: toolchain.desktop_cargo_uses_pinned_rustup_path

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

### Metadata

- Source: tool_failure
- Reproducible: yes on release workstations with multiple Hara bundles
- Related Files: src-tauri/target/debug/bundle/macos/Hara.app
- Tags: computer-use, macos, bundle-id, visual-qa
- Pattern-Key: desktop.visual_qa_must_target_exact_app_copy

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

### Metadata

- Source: command_failure
- Reproducible: yes under restricted workspace execution
- Related Files: hara-cli/src/profile/profile.ts
- Tags: sandbox, profile, private-state, diagnostics
- Pattern-Key: diagnostics.private_state_cli_may_require_host_lock_permissions

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
## 2026-08-28 — Minimal Node 22 PATH omitted the Homebrew GitHub CLI

- Command: `node scripts/github-release-download.mjs ...`
- Failure: the helper could not spawn `gh` because `/opt/homebrew/bin` was missing from the explicit PATH.
- Correction: Hara release commands need both the pinned Node 22 bin and `/opt/homebrew/bin`; validate `command -v node` and `command -v gh` before release-channel helpers.
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

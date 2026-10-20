# P0 pre-tag candidate gate — offline foundation, protected lane pending

Jeff approved this P0 on 2026-10-20 after cancelling Desktop1.0.4. This initial draft establishes
the mandatory operator rule and reports planned workflow changes **before editing workflows**.
The offline contracts below are now implemented and synthetically tested. The real workflow lane,
build/signing adapters, artifact promotion and protection configuration are **not yet connected or
verified**. No release tag may be created while the complete required gate is absent.

## Proposed execution boundary

- A non-main candidate validation ref freezes the final Desktop/Core SHA, versions, toolchains,
  locks, policy identity and source provenance. Ordinary PR/fork code has no signing-runner admission.
- Hosted native Intel/ARM64/Linux and the existing Windows gates build formal installers with real
  sidecars, including the real Intel DMG path. Dummy-sidecar native tests remain separate.
- A separately protected candidate environment admits only reviewed source to the serialized
  signing runner. Check existing updater-file access and Pi-only formal hydration before expensive
  work; use the explicit dedicated codesign keychain without global configuration changes.
- Candidate and formal execution share build/verification functions; candidate mode disables only
  Release/OSS/stable publication. It never impersonates a protected tag event or relaxes signatures,
  notarization, staple, Gatekeeper, package smoke or old-version upgrade checks.
- Upload only artifact bytes and non-secret receipts binding source, complete platform coverage,
  workflow/run/approval identity, digests and signing/notary evidence. JSON self-reported `passed`
  is not independent authorization.
- The protected stable tag workflow resolves and verifies that completed candidate through trusted
  API metadata and immutable artifact digests. It only promotes those bytes, without compilation,
  re-signing or fallback to an older candidate. Any input change invalidates eligibility.

## Planned file changes

1. Add `.github/workflows/candidate.yml` for the non-main full-package candidate, protected signer
   and source-bound receipt. No production Release/OSS/stable write authority.
2. Change `.github/workflows/build.yml` from build-after-tag to verified-artifact promotion only,
   retaining protected new-tag actor/source/immutable/public verification gates.
3. Retain ordinary `.github/workflows/ci.yml` quality gates and distinguish candidate status from
   unit/native CI status; a green dummy-sidecar check is not a green candidate.
4. Extract shared source/mode/build/verification helpers used by `build-mac-signed.sh`, formal
   sidecar refresh, provenance and promotion, with explicit fail-closed candidate semantics.
5. Add rejection tests for missing/expired/mutated/incorrect-source receipts, absent native Intel
   DMG, invalid signatures/notary, untrusted workflows, changed policy and rebuild side effects.

## Infrastructure approval required before real credential execution

Read-only inspection found only the existing tag-scoped `hara-desktop-production` environment.
Do not widen it to PRs or silently create an unprotected candidate environment. The proposed
`hara-desktop-candidate` needs a reviewed exact-ref/source approval policy and signing-runner
admission. Hosted preflight must reject missing/incorrect protection before any privileged job
can be queued; a workflow-created default environment is not protection. This draft does not
create or modify environments, rules, runners or credentials.

Caches/sharding and other P1/P2 optimizations are excluded. The cancelled1.0.4 tag/hidden draft and
stable1.0.3 remain untouched. This infrastructure branch is not the final1.1.0 application source;
after integration, freeze its final versioned Desktop/Core commits and run a fresh full candidate.

## Implemented offline slice (2026-10-21)

- `scripts/candidate-gate.mjs`: pure source/policy fingerprint and receipt/evidence join. It binds
  Desktop/Core commit/tree/version, toolchains, npm/Cargo/sidecar locks, updater **public** key hash,
  reviewed workflow/protection identity, source-specific approval and run attempt. All four target
  jobs, successful mandatory steps, native runner OS/architecture, artifact IDs/digests/sizes and
  freshly inspected payload inventories are mandatory. Mac evidence additionally binds accepted
  App/DMG notarization, staple, Gatekeeper and native DMG/upgrade evidence. An Intel fixture, skipped
  step, foreign run or carried-forward old-attempt job cannot substitute.
- `scripts/candidate-stages.mjs`: injectable phase contract with updater-file/Pi-only preflight
  before expensive work. Candidate accepts **no publication callbacks**. Promotion accepts **no
  build/sign/retry-older callbacks**; it validates exact evidence before immutable publication and
  must verify public bytes before switching stable. Failure stops without retry/fallback.
- `test/candidate-gate.test.mjs`: synthetic positive and refusal cases. No real file key, Keychain,
  Apple, GitHub mutation, paid provider or production data is used.

### Trust boundary: these JSONs are not authorization by themselves

`observed` is a **normalized trusted-adapter contract**, not the raw GitHub REST schema and not an
operator-uploaded JSON file. The future adapter must obtain API run/workflow/jobs/approval metadata,
independently verify protected environment/ref/runner admission, associate artifacts with their
actual producer run **and attempt**, check GitHub's digest against newly downloaded archive bytes,
and safely inspect the inner source/sidecar/signature/notary/upgrade evidence. Raw Artifact REST
metadata alone does not supply all these fields. Do not synthesize missing fields as successful or
derive approval/native execution from a receipt's self-report. Signing/submission verification and
trusted inspection must come from the existing mandatory tools on the appropriate native runners.

Notary evidence keeps `inputSha256` (the immutable pre-staple object submitted to Apple) separate
from `finalSha256` (the verified stapled distributable/app inventory). The trusted native adapter
must verify submission-to-final lineage within this source/run/attempt; do not equate the two hashes
or substitute another submission merely because it says Accepted. App and DMG submissions differ.

The caller supplies expected source/policy from reviewed pinned Git state, never from the receipt.
The helper returns an immutable detached proof of the artifact and inner-file hashes. The protected
tag caller must **also** retain original tag actor/ruleset/immutable-release admission and independent
post-publication verification. This module is neither a signature nor permission to publish.

### Still pending, not counted as passed

1. Jeff's candidate environment/runner admission decision and a fail-closed hosted admission adapter.
2. Trusted API/download/native inspection adapter and full shared formal command wiring; no new
   workflow currently imports these modules. Existing tag workflow has not been changed.
3. Approved controlled-ref candidate workflow, native real Intel DMG and the other platform packages,
   original file-key preflight/Pi-only hydration, both Mac signatures/notarizations/staple/Gatekeeper,
   source/attempt-bound artifact upload/download and real old-version upgrade verification.
4. Replace post-tag compilation with protected same-artifact promotion only after those prerequisites.

Until then the P0 is **in progress**, not completed; the green ordinary CI or synthetic contracts
cannot authorize a tag or stand in for a real signed candidate.

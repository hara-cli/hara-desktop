# P0 pre-tag candidate gate — approved design, implementation pending

Jeff approved this P0 on 2026-10-20 after cancelling Desktop1.0.4. This initial draft establishes
the mandatory operator rule and reports planned workflow changes **before editing workflows**.
It does not claim that the new lane, candidate mode, artifact promotion or protection configuration
is already implemented or tested. No release tag may be created while the required gate is absent.

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

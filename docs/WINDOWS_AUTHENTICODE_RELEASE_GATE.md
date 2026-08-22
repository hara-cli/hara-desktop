# Windows Authenticode release gate

Status: **provider-neutral verification implemented; blocked on a protected Windows signing identity and signing service**
Audited: 2026-08-21 (Asia/Shanghai)

This gate is separate from Tauri updater signing. Minisign proves that an updater payload came from
Hara's update channel; Authenticode lets Windows verify the publisher of each executable and installer.
Both are required for a commercial Windows release.

## Current evidence

- `.github/workflows/build.yml` builds the Windows target on `windows-latest`, exercises the packaged
  app and sidecar, and signs updater artifacts with Tauri's private updater key. It has no Authenticode
  signing or `signtool verify` step.
- `src-tauri/tauri.conf.json` has no `bundle.windows.signCommand`, certificate thumbprint, digest
  algorithm, timestamp URL, or RFC 3161 setting.
- The only repository-visible self-hosted release runner is the protected macOS runner. There is no
  Windows signing runner, repository Actions secret, or repository Actions variable.
- The protected `hara-desktop-production` environment currently exposes only the release-policy token
  and Tauri updater-signing key names. Neither is a Windows code-signing identity.
- `WORKFLOW.md` correctly states that MSI/NSIS updater files are minisign-verified but not
  Authenticode-signed.

Therefore a current Windows package must not be described as Authenticode-signed, even when its build,
package smoke and updater signature all pass.

## Implemented provider-neutral boundary

- `scripts/verify-windows-authenticode.ps1` accepts exactly six `role=path` inputs: NSIS and MSI
  installers plus separately extracted `hara-desktop.exe` and `hara.exe` from each installer. It rejects
  missing, duplicate, renamed, reparse-point, invalid, expired, unstamped, mixed-publisher, or mixed-
  thumbprint inputs.
- The Windows verifier requires both structured `Get-AuthenticodeSignature` status and
  `signtool verify /pa /all /v`, requires the controlled runner to report a SHA-256 file signature,
  hashes the final signed bytes before and after trust checks to reject in-flight replacement, and
  writes a new atomic JSON receipt without replacing an older one.
- `scripts/windows-authenticode-receipt.mjs` validates that receipt on any release host against the
  independently configured stable tag, exact Desktop/CLI commits, legal publisher subject, certificate
  thumbprint, six required roles, signed-byte SHA-256 values, and trusted timestamp certificates.
- Offline contract tests cover valid receipts, mixed publishers, missing timestamps, incomplete roles,
  stale source identities, malformed hashes, and the verification-only PowerShell boundary.

These files deliberately do not sign an artifact, choose a provider, claim RFC 3161 service evidence,
or alter the production workflow. They make the remaining external dependency narrow and testable.

## Accepted trust model

Use a managed or hardware-backed code-signing identity whose private key cannot be exported into the
repository, a build log, a generic GitHub secret, or the macOS signing runner. The signing operation
must be authorized by a dedicated protected environment and an exact stable-tag workflow identity.

Tauri 2's installed configuration schema supports a custom `bundle.windows.signCommand` with `%1` as
the binary path. That is the preferred adapter boundary: a small reviewed wrapper invokes the chosen
remote/HSM signer, while Tauri controls which application binaries and installers are presented for
signing. Provider credentials and certificate identifiers remain deployment configuration.

Do not commit a PFX, a base64 certificate, a certificate password, a test certificate, or a fake
signature receipt. Do not use the updater minisign key for Authenticode.

## Required release choreography

1. `prepare_release` pins the Desktop commit, CLI commit, version, Node, Bun, Rust and Windows target.
2. A protected Windows signing job checks out those exact commits and rebuilds the sidecar and Desktop
   on the native Windows target. Pull requests and ordinary branch CI never enter this environment.
3. Tauri calls the reviewed signing adapter for the bundled CLI sidecar, Desktop executable and every
   generated MSI/NSIS executable. The provider returns only bounded receipts and signed files.
4. The job verifies every signed PE file with Windows trust policy, checks the exact expected publisher,
   requires SHA-256 and a valid RFC 3161 timestamp, and rejects test, expired, missing or mixed publishers.
5. Native package smoke extracts the real installers and repeats verification on their embedded
   `hara-desktop.exe` and `hara.exe`; signing only the outer installer is insufficient.
6. Provenance records the unsigned source/build identities and final signed SHA-256 values. Because
   signing changes bytes, no pre-signing digest may be presented as the public asset digest.
7. Hidden-draft assembly accepts Windows assets only with the tag/run-bound signing receipt. Final
   promotion requires both the Windows receipt and the existing macOS signing/notarization receipts.
8. A clean supported Windows machine verifies install, first launch, Desktop-owned CLI sync, in-place
   update, rollback behavior and uninstall. SmartScreen observations are recorded as reputation
   evidence, not converted into a deterministic CI promise.

At minimum, the verification gate must run the equivalent of:

```powershell
signtool verify /pa /all /v <file>
Get-AuthenticodeSignature <file>
```

The gate must compare structured results to the configured publisher identity; matching command exit
codes alone is not enough.

## External decisions still required

- legal publisher/subject name;
- managed signing provider or dedicated Windows HSM/runner;
- production certificate enrollment and renewal owner;
- workload-identity or protected-runner authorization method;
- primary and fallback RFC 3161 endpoints;
- incident revocation, rotation and emergency release procedure.

These are real trust and operational decisions, not values the repository can invent. Until they are
provided, the safe implementation state is this audited plan plus the existing explicit release block.

## Remaining implementation slices after signer selection

1. Add the small provider-specific adapter behind Tauri's `signCommand`; the provider-neutral verifier
   and receipt contract are already implemented.
2. Add the protected environment/job, provider-backed RFC 3161 evidence, installer extraction, and
   tag/run-bound receipt to release provenance.
3. Run an unpublished candidate through a clean Windows install/update/uninstall exercise.
4. Only after all three remaining slices pass, update `WORKFLOW.md`, the changelog, release notes and product map
   from “blocked” to “verified”.

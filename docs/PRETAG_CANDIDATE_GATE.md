# P0 pre-tag candidate gate

Before a release tag, the **exact final Desktop/Core source** must pass complete
native packaging/signing/notarization/verification, including a **real Intel
runner's DMG**. Rosetta, cross-compilation, unit CI, dummy-sidecar checks or an older
candidate do not satisfy that gate. A tag may promote only the verified bytes;
changed inputs invalidate the receipt. No publication is authorized by this guide.

## Implemented controlled candidate path

`candidate-inputs.json` pins application/Core SHA, trees, versions, locks, tools,
updater public key and policy separately from the orchestration workflow SHA.
`candidate.yml` accepts only its exact protected non-main push and actor, with a
separate protected candidate environment and restricted organization runner group.
Production's tag-only policy is not widened.

1. Hosted admission verifies live protection and the independent administrator
   observation before signer scheduling. The signer repeats those checks before
   credential access and checks its actual runner ID/group/name registration.
2. Pi-only locked hydration, original updater-file verification and a background
   Developer ID probe precede expensive four-platform native builds and full tests.
3. Native builds produce genuine sidecars and formal installers. The controlled
   signer signs/notarizes/staples native Apps; each native ARM/Intel runner then
   creates its final DMG. The signer signs/notarizes/staples DMGs and signs updater
   payloads; native jobs perform package, quarantine and old-version upgrade checks.
4. Each transition verifies this run/attempt's GitHub artifact size/SHA256 plus its
   source-bound inner receipt, safe archive entries/links and inspected payloads.
5. Outside the run, `candidate-run-verifier.mjs` independently reads real
   jobs/approval metadata and re-downloads assets. Self-reported JSON `passed` is
   not authorization. Missing actual native Intel DMG or ambiguous rerun approval
   linkage fails closed.

Candidate tokens are read-only plus Actions artifact upload. There are no
Release/OSS/stable write credentials. The original updater/private keys are never
uploaded or copied. Apple submission intent/ID is durable before polling; an
unknown submission outcome is not resubmitted.

## Protected runner configuration

Set these **non-secret locations/identifiers** in the protected candidate
environment after administrator review. Never put key bytes or password contents
in variables, source, argv or logs. A private operator record may supply the same
variables for local verification; it must remain outside Git.

| Variable | Meaning |
| --- | --- |
| `HARA_CANDIDATE_RUNNER_NAME` | Existing reviewed runner name; exact numeric runner/group IDs remain pinned |
| `HARA_CANDIDATE_RUNNER_DIRECTORY` | Existing runner registration and durable notary evidence directory |
| `HARA_CANDIDATE_OPS_DIRECTORY` | Owned, non-group/other-writable directory for the signing lease and UI hold |
| `HARA_CANDIDATE_SIGNING_KEYCHAIN` | Existing dedicated signing Keychain path, never login/System Keychain |
| `HARA_CANDIDATE_SIGNING_PASSWORD_FILE` | Existing owner-only 0600 password file; content stays local |
| `HARA_CANDIDATE_NOTARY_KEY_FILE` | Existing local Apple API key file, not its contents |
| `HARA_CANDIDATE_NOTARY_KEY_ID` | Apple notarization key identifier |
| `HARA_CANDIDATE_NOTARY_ISSUER_ID` | Apple notarization issuer identifier |
| `HARA_CANDIDATE_TOOLCHAIN_PATH` | PATH-delimited existing Node/Bun/Rust binary directories |

There are no machine-specific fallback values. Missing/invalid configuration fails
before signing. The unlock helper reads only the configured dedicated Keychain and
password file. It preserves ownership/mode/no-link checks and never modifies
global Keychain configuration.

**PATH is a locator, not a version pin.** Before the first build, `select-tools`
checks the actual Node/Bun/Rust versions against the committed toolchain/input
locks and checks native architecture before writing job PATH. Every subsequent
build context rechecks them. Stale directory names or version drift fail closed;
do not waive this check or assume a version embedded in a directory name is valid.

The configured reviewer may self-approve their initiated run. Plan A's independent
local observation is a separate verification action, not a second-person approval;
see [the explicit trust model](CANDIDATE_GATE_A.md).

## Evidence and remaining publication work

The orchestration input pins application commit `637d96b114fd32cb96736ed0982f009235e93f6d`
(tree `507bac22fa475d4b01d634ce73bb25bef982aca4`) and Core commit
`b11009bdcafd2367cd587a47c665dea260d69df4` (tree `302e8a288218ab0a4ec52d8ce8d88a43522cb9fb`).
Application and orchestration are distinct source roles. These pins alone are not
candidate execution approval or evidence that the candidate has passed.

Every job explicitly provisions an owned, canonical directory beneath
`GITHUB_WORKSPACE/candidate-evidence/<run>/<attempt>/<job>/<target>`. The target is
explicitly `controller` for non-matrix jobs. `synthetic-home` and `tmp` are the two
private roots; `CANDIDATE_OUTPUT_DIR` is `tmp/output`. HOME/TMPDIR and related
authority fields are written last, and artifact uploads consume the provision
step's canonical output path. There is no system TMP or RUNNER_TEMP fallback.
Existing job leaves, symlinks, wrong owners, writable directories and changed
anchor identities fail closed. All evidence is retained; there is no automatic
removal on success, failure or cancellation. Application CI evidence wiring is
separate from orchestration. Control-plane authentication, the independent local
runtime adapter and platform/socket checks still require acceptance before execution.

Run tests under that explicit private HOME/TMP without inherited Hara credentials.
Mac upgrade verification uses private copies of real released old Apps.
Linux/Windows native SDK comparator/download/signature tests are not GUI/system
installation acceptance. Windows Authenticode remains separately unimplemented.

Notary submission `inputSha256` and final stapled payload digests are different
objects. Verify their source/run/attempt lineage rather than equating hashes or
substituting a different Accepted submission.

The controlled candidate adapters are implemented, but a complete real passing
run is still mandatory. The injectable same-byte promotion contract is not yet
wired into the legacy tag workflow, which remains unchanged. Do not tag until
reviewed promotion consumes only independently verified artifact IDs/digests and
retains original actor/tag/immutable-release/public verification gates. Promotion
must have no build/re-sign/retry-older callback; verify public bytes before stable.

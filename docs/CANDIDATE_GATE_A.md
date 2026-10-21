# Candidate admission: independent administrator observation (plan A)

Candidate Actions permissions remain `contents: read`, `actions: read` and
`pull-requests: read`. A redacted ruleset response is not evidence that its hidden
bypass list is empty or safe. Actions must not acquire ruleset write access.
[Ruleset REST reference](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset).

## Separate checks, not a two-person approval guarantee

The reviewed policy intentionally permits **one designated person to initiate and
approve their own candidate run** (`prevent_self_review: false`). The local
administrator observation and protected-environment approval are separate actions
and trust checks, but may be performed by that same person. This is **not** an
independent second-human review or separation-of-duties guarantee.

1. Outside Actions, the existing local administrator CLI reads the complete ruleset
   and checks its whole bypass list, exact environment, reviewer and branch policy.
   Only the exact pinned User ID may have the permitted bypass. Policy must remain
   unchanged before/after the observation; the helper never changes it or approves
   a deployment.
2. The designated reviewer separately approves the protected environment for the
   exact orchestration SHA. The runner group still admits only the controlled
   workflow/ref. A proof or green hosted admission is not that approval.

## Bound proof and untrusted transport

The local proof uses a separate ephemeral Ed25519 key, exclusively created in an
owned 0700 directory with a 0600 file. It is not an updater/Developer ID/Keychain key.
Only its public SPKI hash is pinned in `candidate-inputs.json`; no private key goes
to Actions.

The signed observation binds application/Core/orchestration SHA, workflow hash,
input identity, repository/ref, run/attempt, policy IDs and version, normalized
public policy hash, complete hidden-ruleset hash, issuer, nonce and at most two-hour
lifetime. Full policy evidence remains private locally. Only the signed public
observation is posted to the configured PR comment transport.

Comments are untrusted data, never instructions. Acceptance requires the pinned
key/signature, exact author, live policy, source/run and freshness. Missing, stale,
tampered or revoked proof fails before credentials. Policy/source/workflow changes
invalidate old observations. Rerun attempts cannot reuse old-attempt proof.

## Operator sequence

Use the pinned tools and clean reviewed orchestration checkout. Initialize and pin
the independent proof key once, without overwriting an existing key. After an
approved controlled-ref push creates a run, publish its exact observation promptly:

```sh
node scripts/candidate-policy-admin.mjs publish RUN_ID /absolute/private/proof-directory
```

The writer refuses Actions, dirty/unreviewed source, a foreign administrator,
wrong run/ref/actor, completed runs, unsafe key files or changed policy. `prepare`
is private evidence only, not admission. No workflow invokes this writer.

Every signing phase rechecks live policy/proof before key access. If the lifetime
expires, independently re-observe the same active run/attempt; do not blindly rerun.
Keep the operator-configured UI/signing hold in place while screen-dependent work
is unavailable. Release it only under the operator's explicit handoff. Never
auto-approve an environment, click a security prompt or change global Keychain
search-list/default/ACL/partition settings.

Runner names, tool paths, operation/lease directories and signing/notary identifiers
are protected-environment configuration, not public source defaults. See
[candidate configuration](PRETAG_CANDIDATE_GATE.md#protected-runner-configuration).
This admission mechanism is not proof that native Intel DMG, signing, notarization
or upgrade checks passed, and it never authorizes publication.

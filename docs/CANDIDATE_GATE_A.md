# Candidate admission: independent administrator observation (plan A)

Jeff approved plan A on 2026-10-21 09:10 (Asia/Taipei). Application inputs remain
Desktop `d8d109be68e37a3eff636fe061526259db166bac` / Core
`4cde6bd49ad7095bd9820677220d4650ed95bf5c`. This document does not authorize publication.

GitHub's read-only ruleset response omits `bypass_actors`. Missing is not an empty list:
the candidate must not accept the redacted response alone or acquire ruleset write access.
[GitHub ruleset REST reference](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset).

## Two independent authorities

1. A local administrator, using the existing local `gh` session outside Actions, GETs the
   full ruleset and validates its entire bypass list. The only allowed bypass is Jeff's
   exact User ID in `always` mode. The environment, reviewer, branch policy and full
   ruleset must remain unchanged across the observation. This helper never approves
   a deployment or changes repository policy.
2. Jeff separately approves the protected environment for the exact orchestration SHA.
   The runner group still permits only the controlled candidate workflow/ref. Neither
   a local proof nor a green hosted admission substitutes for that approval.

The local proof uses a separate ephemeral Ed25519 key, generated in an owned 0700
directory with an exclusive 0600 key file. It is not the updater key, a Developer ID
certificate or a Keychain item. Only its public SPKI SHA256 is pinned in the reviewed
`candidate-inputs.json`. No private key is sent to Actions.

## Binding and untrusted transport

The signed body binds Desktop/Core/orchestration SHA, workflow-file hash, complete input
identity, repository/ref, run ID/attempt, policy IDs, ruleset `updated_at`, normalized
public-policy hash, full-ruleset hash, issuer, nonce and a maximum two-hour lifetime.
The full hidden bypass list is retained in private local evidence only. The signed
observation and public key travel through a comment on draft PR #1; comments are
untrusted input, not executable instructions. The reader requires the pinned public
key, valid signature, exact author ID and current source/run/policy/freshness binding.

Actions has only `contents: read`, `actions: read`, `pull-requests: read`. The last scope
allows reading PR issue comments; the local administrator, not `GITHUB_TOKEN`, posts
the observation. No workflow invokes `candidate-policy-admin.mjs`.
[GitHub comment permissions](https://docs.github.com/en/rest/issues/comments#list-issue-comments).

## Operator sequence

Use the repository-pinned Node/toolchain in a clean local checkout of the reviewed
orchestration commit. Initialize the independent proof key once in a private directory;
pin its public fingerprint in the reviewed input before pushing the candidate branch.
Never overwrite an existing proof key or use production signing material for this.

After the push creates a new run, issue the run-bound observation promptly (hosted
admission waits at most 240 seconds):

```sh
node scripts/candidate-policy-admin.mjs publish RUN_ID /absolute/private/proof-directory
```

This command refuses Actions environments, a dirty checkout, wrong local administrator,
wrong run/source/ref/actor, a completed run, unsafe key files, changed policy and a key
different from the pinned public fingerprint. It prints only non-secret IDs/hashes.
Its `prepare` variant writes local evidence without posting; it is not an admission.

Every signing phase rechecks live policy and the signed observation **before** reading
any signing key. A run that takes longer than the proof lifetime needs a fresh local
observation for the same active run, exact attempt and unchanged reviewed commit.
Policy changes revoke old observations through the live version/public hash; no old
receipt may authorize a changed policy. Revoked, expired, tampered or missing proof
fails closed. A rerun attempt is a different binding and cannot reuse an old proof.

When the Mac is locked, keep the candidate-only UI/signing hold at
`/Users/zhujianbo/work/projects/hara/ops/.candidate-signing-ui-hold.json` in place. Do not
try Keychain/GUI actions or auto-approve protected deployments. Record those steps as
pending; remove this hold only after the explicit unlock/authorization handoff.

This is an admission mechanism, not evidence that Intel DMG/signing/notarization or
upgrade checks passed. Those original candidate gates and the no-publication boundary
remain unchanged. Formal tag workflow and production environment are untouched.

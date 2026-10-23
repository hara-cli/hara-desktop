# Explicit retained CI evidence

The ordinary CI callers require an explicit canonical `CANDIDATE_EVIDENCE_ROOT`
(or the matching `HARA_WRAPPER_EVIDENCE_ROOT` alias) and an explicit fresh output
directory beneath that root's `tmp`. Missing/conflicting bindings fail before
tool execution. They never derive authority from a machine temporary directory.

The operator or job selects the root under its approved evidence location.
`ci-evidence.mjs` may create that exact root as one new leaf under an existing
owned canonical parent, then creates or checks `synthetic-home` and `tmp`. It does
not recursively invent parent locations. The explicit output parent must already
exist; a fresh direct child of `tmp` is the usual choice. Existing output leaves
are retained and refused rather than overwritten or reset.

```sh
# EVIDENCE_ROOT is an explicitly selected, approved canonical absolute path.
CANDIDATE_EVIDENCE_ROOT="$EVIDENCE_ROOT" \
  node scripts/ci-regression.mjs "$EVIDENCE_ROOT/tmp/regressions"

CANDIDATE_EVIDENCE_ROOT="$EVIDENCE_ROOT" \
  node scripts/ci-core-platform.mjs "$CORE_CHECKOUT" "$EVIDENCE_ROOT/tmp/core-smoke"
```

The callers bind private HOME/TMPDIR variants and the output field, scrub inherited
credentials through the existing evidence contract, and restore only their own
process environment afterwards. They do not read credential files. Outputs and
fixtures survive success, failure and cancellation; no removal API is supplied.
Missing roots/outputs, links, aliases, wrong owners, writable directories and
changed directory identities fail closed.

`candidate-process.test.mjs` consumes the already-bound evidence root. Upgrade
fixtures use exclusive `mkdir` beneath the bound `tmp` with a six-character random
suffix; collisions fail without retry. The suffix length and socket limits are
unchanged. Upgrade children receive their explicitly checked output binding; the
native updater protocol, download verification and signing checks are unchanged.

The same ordinary full regression command and Core lock/native/hydration/build/
search gates remain. Injection points are for offline contract tests; CLI entries
always select the actual implementations. No candidate authorization, source
rebinding, signing or publication authority is created by this helper.

Legacy workflows that still pass a system-temp output or run these evidence
consumers without a root must be wired separately before real CI execution. This
caller adaptation does not alter workflow permissions, candidate input pins or
the candidate workflow, and local subset results do not establish native or
multi-platform acceptance.

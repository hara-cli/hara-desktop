# Runtime binding P0 learnings

## [LRN-20261101-LOCAL-HISTORY-SCOPE] regression / frontend

**Status**: resolved in source and fixture tests; not installed or released

Guard the existence of local history state before comparing session identifiers. An optional-chain
comparison can otherwise match two absent identifiers in a minimal fixture and then dereference the
missing state. Keep the Core snapshot intact; scope a local transcript boundary to workspace,
generation, colleague, session and the last hidden message so a replacement transcript stays visible.

## [LRN-20261101-BINDING-IN-FLIGHT] concurrency / frontend

**Status**: covered by focused callback and model tests

A confirmation button's latch does not protect the composer. Fence new sends, composer edits and
duplicate binding requests for the same colleague until the binding request settles. A failed or
stale request must preserve local state and must not clear another colleague's draft.

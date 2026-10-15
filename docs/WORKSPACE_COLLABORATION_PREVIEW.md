# Workspace channel UI — local candidate

2026-10-15. No release, production API, account enrollment or existing Dev restart.

The authenticated Core feature workspace.collaboration.v1 adds a collaboration entry next
to the existing local Workspace switcher. It opens a distinct, lazy-loaded channel surface.
Closing returns to the local Workspace without switching its profile or stopping local tasks.
An unconfigured or older Core advertises no collaboration entry; local Hara stays account-optional.

The preview provides an explicit Workspace picker, actual authorized channels, plain-text
messages, owner/admin channel creation, explicit send receipts and same-ID retry. Core owns
all Account credentials and short-lived assertions; renderer receives redacted DTOs and an
opaque accountScope. It cannot supply a remote URL, model key, Realm or role override.

Request generations isolate A→B→A transitions. Sign-in/access changes hide old content and
clear drafts/selection. Background tabs do not poll; visible tabs poll one bounded cursor page
every five seconds without overlapping reads. A failed sync never advances its cursor.
Messages are deduplicated by server ID, capped at 500 in memory, and escaped as text.
New channel events carry only validated public metadata, not the server's arbitrary payload.
Directory cursor expiry/staleness is not revocation and preserves uncertain mutation identities.
A selected Workspace absent from a partial first page stays explicit in the picker; only a
complete directory or authenticated access denial may remove its selection.

The local retry state is not durable. Pending sends/creates remain unknown across navigation,
and leaving the surface requires an explicit warning acknowledgment. Explicit retry freezes
the original body, target and idempotency key. No typing, selecting, model or automatic send
approves a message. Core interruption/reload does not roll back a server send.

When Core advertises workspace.collaboration.history.v1, selection loads the latest 50 messages,
with explicit older paging and a separate opaque history cursor. Exact bigint sequence ordering
and server-ID deduplication merge concurrent live/history replies at equal timestamps. Channel and
request generations isolate delayed replies, and each channel selection reloads its authorized
transcript. History pagination expiry clears the transcript/cursor but preserves the draft and
uncertain send/create IDs; true access denial or sign-in drift clears old-account content.
The 500-message view limit is explicit; reads never auto-send or replace the live-sync cursor.

The viewport follows new messages only near the bottom. Reading older content preserves the anchor
on prepend and offers a new-messages button without forcing a jump. Enter sends, Shift+Enter adds
a line, and composing/repeat/modifier key events do not submit. Text remains escaped, not raw HTML.
Selected/visited Workspace names come from authorized bootstrap and are reset with account scope;
unvisited names remain opaque IDs without context fan-out. Older Core engines visibly retain their
post-connection-only history limitation.

Current limitations include no complete member profiles or durable transcript/retry queue.
Agent execution, private channels, attachments, key sharing,
Desk cards and complete local-to-hosted Workspace migration are not implemented in this slice.

## Synthetic visual fixture

With the repository's pinned Node toolchain, start a separately owned Vite port and open:

    test/fixtures/workspace-collaboration-preview.html

The fixture uses the actual UI/model and explicitly synthetic messages; it has no Account/Core
network transport, model key or real send. It is not evidence of a deployed service. Do not
replace the user's running Dev app to inspect it. Browser/native screenshot verification must
be recorded separately from component SSR and state tests.

The shared Core wire contract is maintained in hara-cli/docs/workspace-collaboration-client.md.
Run npm test and npm run build, plus real authenticated Account/Collab/Core/Desktop client
integration with separately created disposable databases. A sandbox loopback EPERM or skipped
database test is not passing acceptance. Keep private evidence and temporary signing material
out of Git; stop every test-owned service/database after verification.

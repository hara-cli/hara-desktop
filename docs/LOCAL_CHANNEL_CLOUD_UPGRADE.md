# Local channel cloud-upgrade UI boundary

The channel header's **Invite other people** action opens a local preview. It explains that only future cloud messages would be shared, old records and drafts stay local, and local colleagues, files, connections and execution permissions are not transferred. Remote messages are never instructions for local colleagues.

The next step checks the account through an injected local adapter. An unauthenticated account gets an explicit **Sign in to Hara** action; cancelled or expired login remains separate from a successful login. A signed-in account can review the default **new shared space**, its fixed data region and the audience disclosure. A separate checkbox is required before **Upgrade and invite** can proceed to local preflight. An invitation joins a Workspace; it does not grant private access to just one channel or local execution authority. An existing shared space would expose the channel to all authorized members.

## Current implementation

`ChannelUpgradeBridge` is a local interface stub, not a cloud migration client. Its default implementation returns `UNAVAILABLE` for account handoff and upgrade preflight. The UI reports that no cloud channel or invitation was created. It does not read stored login credentials or create a browser login session.

The read-only `checkUpgrade` method must never be wired directly to the proposed Core `prepare` or `commit` RPCs. It has no successful upgrade result. No channel is frozen or rebound, no operation receipt or invitation code is fabricated, and the original composer remains local. The UI does not import history or collect an invitee's contact details.

The source includes only local Workspace/channel IDs, resource generation, catalog revision and history revision. Preview counts are computed locally; message bodies, drafts, colleague IDs, tool output, paths and credentials are not part of the preflight input. This is UI intent, not execution or ownership authority.

Source changes invalidate in-flight results, including A→B→A navigation. Closing aborts pending adapter work and ignores late results. Running replies, saves and unknown receipts block continuation; the upgrade does not stop or resend them. Account and region are rechecked before preflight. Errors are mapped to a fixed safe code set, never displayed as raw remote error text. There are no automatic retries or background timers.

## Requirements before a real backend adapter

These are integration gates. The unavailable stub does **not** implement or prove the following server guarantees:

- Account→Collab provisioning needs service authentication, a dedicated audience/purpose, short expiry, replay-resistant durable event/operation receipts and atomic deduplication. A renderer-provided identity or role is not sufficient.
- Use an explicit, fail-closed membership freshness policy. The local scope guard caps proof age and validity at **60 seconds**, refuses an already removed member immediately and refuses access at the deadline. Real services must enforce the revocation deadline using authoritative server time and membership/projection state on every read and write; this client check is not a server revocation guarantee.
- All Collab queries, receipts, cursor/history reads and writes must be scoped to the trusted `realmId`, authorized Workspace, account and region. Organization, Workspace and Realm IDs have separate opaque types and must be resolved from trusted persistent mappings. Similar-looking text does not establish a mapping. Private Realm and Organization bindings do not enter the dialog's view state.
- CN and GLOBAL are independent. Do not switch regions after an auth failure or carry membership proofs, operation state, history or keys across regions.
- Remote messages, history excerpts and mentions are display-only data. They must never dispatch local colleague, tool, approval, task or model requests.
- Invitation creation needs server-side rate limiting and durable idempotency. `RATE_LIMITED` is a visible, non-retrying result; disabling a button is not a substitute for the server limit. Creating an invitation must remain separate from creating and binding the cloud channel.
- History import requires a later explicit selection and final preview, with key and path redaction before upload. This interface only accepts `future_only` and has no import method. Do not bypass that boundary by encoding messages, paths or credentials as another input field.
- A real upgrade requires Core-owned durable intent/keys, source revision checks, a recoverable source fence, authoritative audience confirmation, commit/status/cancel receipts and atomic local binding. An unknown result must be reconciled against the original operation, not retried as a new channel. Login success alone does not satisfy these gates.

Tests cover local-only preview, sign-in/cancellation/expiry, late results, confirmation, source/account/region changes, the unavailable stub, distinct identifier types and cross-space/realm/region counterexamples. Browser fixtures inject synthetic accounts only in the DEV-only localhost component fixture; they do not establish actual Account/Collab readiness.

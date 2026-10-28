# Local personal channels in Desktop 1.1.0

Create a channel from the sidebar's Channels section, name it and select colleagues from the current Workspace. The user is always a member. A channel can start empty and be used for local notes; add colleagues later through Channel members. There is no person-count quota or cloud-login requirement.

Each message can ask all members, a selected subset, or nobody to reply. The reply summary shows the selected count, with singular wording for one colleague. Search members or recipients by name or role; filtering the list keeps hidden selections, and Select all applies to the complete member list. Core executes one response per selected colleague in order, so later replies can use the shared conversation. The selection and unsent draft stay attached to that channel across navigation and Settings. Adding a member does not silently widen a previously selected recipient subset. Stop aborts the current response and skips remaining recipients.

With a Core that advertises `workspace.local-channels.peer.v1`, channels also support peer collaboration (learned from Raft's mention/wake/sync, owned by Hara):

- **@mention.** Typing `@` in the composer offers matching channel members; picking one inserts `@Display Name`. When at least one recipient is selected, Core adds mentioned members after the selected ones (each colleague once). When nobody is selected, the message is still only a saved note: mentions never start a reply on their own.
- **Peer wake.** While replying, a colleague can ask another member to reply next in the same turn (`channel_peer_wake`). The thread shows "{by} asked {name} to reply", with "queued" until that reply starts. A colleague who already replied in this turn cannot be woken again, and nobody can wake themselves.
- **Sync.** A replying colleague can re-read the latest channel state (`channel_sync`), so it sees replies written after its own turn started.

Replies remain strictly one at a time: Core starts the next colleague only after the previous one finishes, and Stop skips every queued reply, including peer-woken ones. An older engine without the capability shows no mention picker and no peer status; the rest of the channel works unchanged.

Member dialogs keep the save action and local-storage note visible while the form scrolls in shorter windows. Channel header actions compact according to the chat column's available width, including when a browser panel is open beside it.

Names, membership and messages are saved by Core in the current Workspace's private local data. Private chats, other channels and other Workspaces use separate sessions. Removing a colleague preserves their messages. A restart reads saved replies without sending another model request. If acceptance is unclear, the composer retains the draft and checks the original request receipt; it never automatically resends.

Invite other people is an explanatory placeholder. It does not create an invitation, require an account, synchronize messages or contact hara-collab. That integration remains a later step.

The renderer requires `workspace.local-channels.v1` from the real authenticated Core transport. An older engine shows an explicit engine-update state rather than an operational mock channel. Product data is not stored in browser localStorage; only the DEV-only component fixture uses synthetic browser storage to exercise reloads.

The sidecar source is pinned by `src-tauri/binaries/SIDECAR_COMMIT`. The channel extension is based on Core 1.0.2; the version label alone does not establish channel capability. The authenticated capability handshake is authoritative, and the tag-to-lock release guard remains intact.

Tests use fresh task-owned data, an in-memory credential adapter and synthetic model responses. They require no daily user data or OS keychain fixture. For Core tests, use its documented test preload and an outer task-owned HOME/USERPROFILE/TMPDIR; invoking test files directly can omit isolation.

User-visible changes are described in the [release notes draft](RELEASE_NOTES_1.1.0_DRAFT.md).

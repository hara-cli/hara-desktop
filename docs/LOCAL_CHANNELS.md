# Local personal channels in Desktop 1.1.0

Create a channel from the sidebar's Channels section, name it and select colleagues from the current Workspace. The user is always a member. A channel can start empty and be used for local notes; add colleagues later through Channel members. There is no person-count quota or cloud-login requirement.

Each message can ask all members, a selected subset, or nobody to reply. The reply summary shows the selected count, with singular wording for one colleague. Search members or recipients by name or role; filtering the list keeps hidden selections, and Select all applies to the complete member list. Core executes one response per selected colleague in order, so later replies can use the shared conversation. The selection and unsent draft stay attached to that channel across navigation and Settings. Adding a member does not silently widen a previously selected recipient subset. Stop aborts the current response and skips remaining recipients.

Member dialogs keep the save action and local-storage note visible while the form scrolls in shorter windows. Channel header actions compact according to the chat column's available width, including when a browser panel is open beside it.

Names, membership and messages are saved by Core in the current Workspace's private local data. Private chats, other channels and other Workspaces use separate sessions. Removing a colleague preserves their messages. A restart reads saved replies without sending another model request. If acceptance is unclear, the composer retains the draft and checks the original request receipt; it never automatically resends.

Invite other people is an explanatory placeholder. It does not create an invitation, require an account, synchronize messages or contact hara-collab. That integration remains a later step.

The renderer requires `workspace.local-channels.v1` from the real authenticated Core transport. An older engine shows an explicit engine-update state rather than an operational mock channel. Product data is not stored in browser localStorage; only the DEV-only component fixture uses synthetic browser storage to exercise reloads.

This source pins the unpublished Core extension `4cde6bd49ad7095bd9820677220d4650ed95bf5c`, based on Core 1.0.2. `SIDECAR_VERSION` remains 1.0.2 for this local development slice, but its commit differs from the released tag. It is not the formal 1.0.4 Core pin and does not authorize a Core/Desktop release. The tag-to-lock release guard remains intact.

The signed/notarized Desktop `09396d5` candidate includes local channels and is retained unchanged. Subsequent channel polish, capsule switches and connection-count grammar are prepared for the next candidate lane; packaging and acceptance for that new source remain pending. ARM64 and Intel/Rosetta acceptance evidence and the first Core command's HOME-isolation incident are documented in the workspace inbox. Tests use fresh task-owned data, an in-memory credential adapter and mock model responses; no real `~/.hara` or OS keychain fixture is needed. Always use the Core repository's `npm test` preload plus an outer task-owned HOME/USERPROFILE/TMPDIR; invoking its test files directly omits that isolation.

Release copy and precise unpublished-channel boundaries are in [RELEASE_NOTES_1.1.0_DRAFT.md](RELEASE_NOTES_1.1.0_DRAFT.md).

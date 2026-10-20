# Local personal channels in Desktop 1.1.0

Create a channel from the sidebar's Channels section, name it and select colleagues from the current Workspace. The user is always a member. A channel can start empty and be used for local notes; add colleagues later through Channel members. There is no person-count quota or cloud-login requirement.

Each message can ask all members, a selected subset, or nobody to reply. Core executes one response per selected colleague in order, so later replies can use the shared conversation. The selection and unsent draft stay attached to that channel across navigation and Settings. Adding a member does not silently widen a previously selected recipient subset. Stop aborts the current response and skips remaining recipients.

Names, membership and messages are saved by Core in the current Workspace's private local data. Private chats, other channels and other Workspaces use separate sessions. Removing a colleague preserves their messages. A restart reads saved replies without sending another model request. If acceptance is unclear, the composer retains the draft and checks the original request receipt; it never automatically resends.

Invite other people is an explanatory placeholder. It does not create an invitation, require an account, synchronize messages or contact hara-collab. That integration remains a later step.

The renderer requires `workspace.local-channels.v1` from the real authenticated Core transport. An older engine shows an explicit engine-update state rather than an operational mock channel. Product data is not stored in browser localStorage; only the DEV-only component fixture uses synthetic browser storage to exercise reloads.

This source pins the unpublished Core extension `4cde6bd49ad7095bd9820677220d4650ed95bf5c`, based on Core 1.0.2. `SIDECAR_VERSION` remains 1.0.2 for this local development slice, but its commit differs from the released tag. It is not the formal 1.0.4 Core pin and does not authorize a Core/Desktop release. The tag-to-lock release guard remains intact.

The previously signed/notarized Desktop `422eb86` packages predate this feature and are retained unchanged. New packaging, signing and native acceptance wait for the formal 1.0.4 owner to explicitly release the lane. Tests use fresh task-owned data, an in-memory credential adapter and mock model responses; no real `~/.hara` or OS keychain fixture is needed.

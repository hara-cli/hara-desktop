# Extension Dock and hosted organization Desk

## Product decision

Hara keeps five open-core work modules in the left dock: Chat, Projects, Tasks, Groups, and Office.
Presentation, spreadsheet, document, Design, Browser, and organization Desk views are contextual
work surfaces, not six more primary destinations.

```text
module dock → context sidebar → primary work ⇄ Extension Dock
                                      Projects: Design / reviewed panels
                                      Office: PPT / Excel / document Artifact
                                      Groups: organization Desk detail
                                      Chat: future browser/file result surfaces
```

The supplied Codex screenshot shows a Codex window beside a separate Chrome window. The local Codex
source tree contains the CLI, app-server protocol, MCP Apps, and plugin backends, but not that Desktop
window layout or WebView host. Hara therefore borrows the useful protocol ideas rather than guessing
at private UI internals:

- stable conversation/turn/item/resource identity;
- typed resources rather than JSON hidden in chat text;
- plugin package, connector authorization, and rendered resource as separate states;
- view selection and split width as client state, never conversation truth;
- browser/page material treated as bounded untrusted context;
- managed policy may disable an otherwise installed capability.

## P0 contract

`src/extension-dock-state.ts` gives every open surface a non-transferable owner:

```ts
type ExtensionOwner =
  | { place: "projects"; sessionId: string; cwd: string }
  | { place: "office"; artifactId: string; revisionId: string };
```

A Project panel is visible only beside its exact session. An Office surface is visible only for its
exact Artifact revision. Changing module, project, or organization cannot silently rebind the view.
The dock supports a user-resizable wide layout, a focused layout, keyboard resize controls, and a
full-width narrow-window fallback. Its width preference contains no content or identity.

The first implementation intentionally supports only boundaries already present in the product:

- **PPT / Excel / document**: the existing honest Artifact workbench is hosted by the dock. It still
  says when high-fidelity preview/edit/export is unavailable and does not modify the imported source.
- **Design and other local panels**: the existing verified local plugin launch path is hosted by the
  dock and bound to a real project session. Starting a panel from Settings without a project, or when
  Serve says its detection markers do not match that project, is rejected before the command runs.
- **Browser**: existing links continue to open in the system browser, and the agent's browser tools
  remain a separate approved capability. Hara does not iframe arbitrary authenticated sites.
- **Organization Desk**: the existing native, profile-pinned read surface remains authoritative.
  Moving its task dossier into this dock is a later native refactor, not a web embed.

Only a panel origin is shown in UI chrome. Paths, fragments, query parameters, URL credentials, raw
commands, and Hara/organization tokens are never used as a title or persisted view preference.
Invalid panel output is not echoed into renderer-visible errors.

## Panel v2 boundary

The legacy local panel remains transitional. Before Browser, third-party Office editors, or an
organization-provided UI can be embedded, Panel v2 must provide:

1. an opaque `panelInstanceId` returned by Serve instead of command, args, or URL;
2. an isolated origin and enforced CSP/navigation allowlist;
3. a short-lived token scoped to owner, resource, capability, and action;
4. declared file, network, clipboard, download, notification, and task permissions;
5. open, suspend, crash, update, revoke, close, and process-tree lifecycle events;
6. a typed resource bridge for Artifact revisions and organization realm resources;
7. tombstones when a capability/resource is removed or incompatible.

The main renderer must never become a credential broker for a panel.

## Hosted and self-hosted Desk target

The target product lets an enterprise administrator choose either Hara-hosted Desk/Collab SaaS or a
customer-hosted deployment. Ordinary employees continue to join with the current three inputs:
connection name, Hara Control origin, and one-time enrollment code. They do not choose hosting mode
or paste another Desk key.

The current implementation has the first tenant service-binding slice: Control stores one typed
binding per organization/service, keeps any Desk provisioning credential in its encrypted secret
store, verifies health (and Collab JWKS metadata), and advertises only `ACTIVE`, credential-free
descriptors during enrollment. CLI persists those descriptors with the organization profile and
Desktop shows their redacted hosts on the connection detail. One-time enrollment can also install
the model route plus a separately scoped native Desk bearer. Collab/extension descriptors are
discovery metadata only at this stage; they do not install a reviewed surface, and the enrollment
payload is not yet a signed short-lived bootstrap manifest.

Both modes must implement the same public client contract. The difference is a tenant-owned service
binding, not a Desktop branch:

```ts
type TenantServiceBinding = {
  tenantId: string;
  service: "MODEL_CONTROL" | "DESK_TASKS" | "COLLAB" | "EXTENSION_CATALOG";
  mode: "HARA_HOSTED" | "CUSTOMER_HOSTED";
  accountRegion: "CN" | "GLOBAL";
  apiOrigin: string;
  issuer?: string;
  jwksUri?: string;
  audience?: string;
  status: "PENDING_VERIFICATION" | "ACTIVE" | "DEGRADED" | "DISABLED";
  capabilitiesVersion: number;
  configVersion: number;
};
```

`credentialRef` exists only in Control persistence and never belongs to an enrollment or renderer
contract.

In P1, enrollment should return a signed, short-lived organization bootstrap manifest describing the tenant,
model route, active service bindings, and allowed native/reviewed surfaces. Sidecar verifies region,
issuer, origin, signature, and versions, then atomically stores service-specific credentials. The
renderer receives redacted descriptors only.

An organization switch affects new work. Existing conversations, Artifact resources, and Desk tasks
remain pinned to the profile/realm in which they started. Disconnect this computer, revoke this
device, and leave the enterprise are three separate operations with different remote cleanup.

## Hosted Desk production blockers

Hara-hosted Desk is not production-ready merely because the current Control can return a Desk bearer.
The following are required first:

- person-bound tenant membership instead of device-name or wildcard enrollment identity;
- service ownership/domain proof and plan policy beyond the current endpoint/JWKS health checks;
- idempotent provision/revoke saga with a remote revoke handle;
- Account login, issuer/JWKS rotation, and realm-context tokens;
- distinct `organization.desk.tasks.v1` and full collaboration capability names;
- server-side leave/revoke plus complete local credential/cache/outbox cleanup;
- realm-scoped database roles, forced RLS, backup/restore, retention, export, and deletion policy;
- usage events for seats, storage, messages, bridge traffic, and agent work;
- signed extension catalog and Panel v2 before organization UI contribution.

## Delivery phases

- **P0**: owner-bound Extension Dock, local Design panel migration, native Artifact migration, safe
  browser handoff, capability-name split, identity/provision/revoke hardening.
- **P1**: tenant administrator chooses hosted/self-hosted bindings; one enrollment installs the model
  route, Desk/Groups descriptor, and reviewed surface manifest.
- **P2**: native organization channels, sync wake worker, read state, files/search, and native Desk
  task detail inside the dock.
- **P3**: Panel v2, signed market, real Office preview/edit/commit/export, tenant extension grants,
  metering, lifecycle, and self-host conformance.
- **P4**: moderated public communities and task hall after identity, reputation, settlement, dispute,
  abuse, and local capability-approval contracts are complete.

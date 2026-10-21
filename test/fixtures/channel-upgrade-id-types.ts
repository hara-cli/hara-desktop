import type { OrganizationId, CloudWorkspaceId, RealmId } from "../../src/workspace-channel-upgrade.ts";
declare const organizationId: OrganizationId;
declare const workspaceId: CloudWorkspaceId;
declare const realmId: RealmId;
declare function useWorkspace(id: CloudWorkspaceId): void;
declare function useOrganization(id: OrganizationId): void;
declare function useRealm(id: RealmId): void;
useWorkspace(workspaceId);useOrganization(organizationId);useRealm(realmId);
// @ts-expect-error Organization and Workspace IDs must never substitute for one another.
useWorkspace(organizationId);
// @ts-expect-error A Workspace ID does not grant Organization authority.
useOrganization(workspaceId);
// @ts-expect-error A Workspace ID is not a Collab Realm ID, even when their text is similar.
useRealm(workspaceId);
// @ts-expect-error Do not derive a Realm ID from an Organization ID.
useRealm(organizationId);

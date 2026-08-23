import type { OrganizationConnection, SessionInfo, SpaceDirectory } from "./client";

export function organizationConnectionSpaceId(
  connection: Pick<OrganizationConnection, "id" | "spaceId" | "tenantId">,
): string {
  return connection.spaceId || (connection.tenantId ? `org:${connection.tenantId}` : `org-profile:${connection.id}`);
}

/** Legacy sessions do not carry `spaceId`. Resolve known routes through the authoritative directory;
 * an unknown non-personal route remains hidden in its own fail-closed legacy company boundary instead
 * of appearing in Personal after a company connection is removed. */
export function sessionSpaceId(
  session: Pick<SessionInfo, "profileId" | "spaceId">,
  directory: SpaceDirectory | null,
): string {
  if (session.spaceId) return session.spaceId;
  if (session.profileId === "personal") return "personal";
  if (!session.profileId) return "unbound";
  return directory?.spaces.find((space) => (
    space.profileId === session.profileId || space.profileIds?.includes(session.profileId!)
  ))?.id
    ?? `org-profile:${session.profileId}`;
}

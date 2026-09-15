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

/** Distinguish a reachable owner from a stale or unavailable Space before suggesting a switch. */
export function sessionSpaceAvailability(
  session: Pick<SessionInfo, "profileId" | "spaceId">,
  directory: SpaceDirectory | null,
): "current" | "switchable" | "missing" | "locked" | "access-unavailable" {
  const ownerId = sessionSpaceId(session, directory);
  if (!directory) return ownerId === "personal" ? "current" : "missing";
  if (ownerId === directory.activeId) return "current";
  const owner = directory.spaces.find((space) => space.id === ownerId);
  if (!owner) return "missing";
  if (directory.switchLocked) return "locked";
  if (owner.kind === "organization" && (owner.accessState === "expired" || owner.accessState === "invalid")) {
    return "access-unavailable";
  }
  return "switchable";
}

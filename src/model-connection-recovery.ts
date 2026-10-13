import type { ConversationItem } from "./ConversationTimeline";
import type { OrganizationConnection, ProviderCapabilitySupport, ProviderConnection } from "./client";

/** A live accepted image can lack strategy metadata until history reload. Treat that conservatively;
 * explicit vision-sidecar text does not require a native-image target. */
export function conversationHasNativeImages(items: readonly ConversationItem[]): boolean {
  return items.some((item) => item.kind === "user" && !item.pendingId
    && item.attachments?.some((attachment) => attachment.kind === "image"
      && (attachment.strategy === "native-image" || attachment.strategy === undefined)));
}

export function connectionCanCopyNativeImages(hasNativeImages: boolean, support?: ProviderCapabilitySupport): boolean {
  return !hasNativeImages || support === "supported";
}

/** Focus is an exact saved identity, never a provider name or the new-chat default. */
export function focusedModelConnection(
  profileId: string | undefined,
  personal: readonly ProviderConnection[],
  organizations: readonly OrganizationConnection[],
): { kind: "personal"; connection: ProviderConnection } | { kind: "organization"; connection: OrganizationConnection } | undefined {
  if (!profileId) return undefined;
  const organization = organizations.find((connection) => connection.id === profileId);
  if (organization) return { kind: "organization", connection: organization };
  const connection = personal.find((candidate) => candidate.id === profileId);
  return connection ? { kind: "personal", connection } : undefined;
}

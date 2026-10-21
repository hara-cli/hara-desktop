import type { CollaborationMessage } from "./workspace-collaboration-state";

export const COLLABORATION_MEMBERSHIP_MAX_AGE_MS = 60_000;
export interface CollaborationClock {
  now(): number;
  wallNow?(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const collaborationClock: CollaborationClock = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  setTimeout(callback, delay) {
    const handle = setTimeout(callback, delay);
    (handle as unknown as { unref?(): void }).unref?.();
    return handle;
  },
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export type CollaborationDisplayMessage = Readonly<CollaborationMessage> & { readonly origin: "remote" };
const reference = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
/** Build inert display data. Never carry remote actions, tool calls, roles, local IDs or instruction metadata. */
export function collaborationDisplayMessage(value: CollaborationMessage): CollaborationDisplayMessage | null {
  if (!value || !reference(value.id) || !reference(value.channelId) || !reference(value.senderPrincipalId)
    || typeof value.body !== "string" || new TextEncoder().encode(value.body).length > 8192
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  const mentions = Array.isArray(value.mentions) ? value.mentions.filter(item => item?.kind === "human" && reference(item.principalId))
    .slice(0, 10).map(item => Object.freeze({ kind: "human" as const, principalId: item.principalId })) : [];
  return Object.freeze({ id: value.id, channelId: value.channelId, senderPrincipalId: value.senderPrincipalId, body: value.body, createdAt: value.createdAt,
    ...(typeof value.sequence === "string" && /^[1-9][0-9]{0,18}$/.test(value.sequence) ? { sequence: value.sequence } : {}),
    ...(mentions.length ? { mentions } : {}), origin: "remote" as const });
}

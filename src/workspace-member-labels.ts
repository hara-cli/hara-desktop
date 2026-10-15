import type { CollaborationMember } from "./workspace-collaboration-state";

/** Names are presentation only. Colliding names stay distinct by their stable, scoped principal. */
export function workspaceMemberLabels(members: CollaborationMember[]): Map<string, string> {
  const normalized = (name: string) => name.normalize("NFKC").trim().toLowerCase();
  const counts = new Map<string, number>();
  const suffixCounts = new Map<string, number>();
  for (const member of members) {
    const name = normalized(member.displayName);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const suffix = JSON.stringify([name, member.principalId.slice(-8)]);
    suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
  }
  return new Map(members.map(member => [member.principalId,
    member.displayName + ((counts.get(normalized(member.displayName)) ?? 0) > 1 ? " · "
      + ((suffixCounts.get(JSON.stringify([normalized(member.displayName), member.principalId.slice(-8)])) ?? 0) > 1 ? member.principalId : member.principalId.slice(-8)) : "")]));
}

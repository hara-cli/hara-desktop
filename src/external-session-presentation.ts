import type { ExternalSessionSourceInfo } from "./client";

/** Connection surfaces are not an additional execution engine. Wire IDs stay unchanged. */
export function externalSessionSourceGroups(sources: readonly ExternalSessionSourceInfo[]) {
  return {
    engines: sources.filter((source) => source.id !== "runtime"),
    terminals: sources.filter((source) => source.id === "runtime"),
  };
}

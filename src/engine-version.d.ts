export type EngineVersionState =
  | "unknown"
  | "matching"
  | "older"
  | "newer"
  | "incompatible";

export function classifyEngineVersion(
  runningVersion: string,
  bundledVersion: string,
): EngineVersionState;

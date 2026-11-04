/** Closed observational metadata. None of these fields confer execution or completion authority. */
export const MESSAGE_TIMING_POINTS = ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"] as const;
export type MessageTimingPoint = typeof MESSAGE_TIMING_POINTS[number];
export interface MessageTimingIdentity {
  workspaceId: string; resourceGeneration: string; agentId: string; sessionId: string; runId: string; attemptId: string; historyStart: number;
}
export interface MessageTimingInput { hostAtMs: number; errorMs: number }
export interface MessageTimingReport extends MessageTimingIdentity {
  schemaVersion: 1; origin: "host_receive"; clientClockErrorMs: number | null;
  points: Record<MessageTimingPoint, number | null>;
}
const LIMIT = 86_400_000;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const id = new RegExp(`^${uuid}$`), workspace = new RegExp(`^ws_${uuid}$`), agent = new RegExp(`^ag_${uuid}$`);
const identityKeys = ["workspaceId", "resourceGeneration", "agentId", "sessionId", "runId", "attemptId", "historyStart"];
const keys = ["schemaVersion", ...identityKeys, "origin", "clientClockErrorMs", "points"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key));
export function parseMessageTimingInput(value: unknown): MessageTimingInput | null {
  if (!record(value) || !exact(value, ["hostAtMs", "errorMs"]) || typeof value.hostAtMs !== "number" || !Number.isFinite(value.hostAtMs)
    || value.hostAtMs < 0 || typeof value.errorMs !== "number" || !Number.isFinite(value.errorMs) || value.errorMs < 0 || value.errorMs > 1000) return null;
  return { hostAtMs: value.hostAtMs, errorMs: value.errorMs };
}
export function parseMessageTimingReport(value: unknown): MessageTimingReport | null {
  if (!record(value) || !exact(value, keys) || value.schemaVersion !== 1 || value.origin !== "host_receive"
    || typeof value.workspaceId !== "string" || !workspace.test(value.workspaceId) || typeof value.agentId !== "string" || !agent.test(value.agentId)
    || ![value.resourceGeneration, value.sessionId, value.runId, value.attemptId].every(value => typeof value === "string" && id.test(value))
    || !Number.isSafeInteger(value.historyStart) || Number(value.historyStart) < 0 || Number(value.historyStart) > 4000
    || !(value.clientClockErrorMs === null || Number.isSafeInteger(value.clientClockErrorMs) && Number(value.clientClockErrorMs) >= 0 && Number(value.clientClockErrorMs) <= 1000)
    || !record(value.points) || !exact(value.points, MESSAGE_TIMING_POINTS) || value.points.T1 !== 0) return null;
  for (const point of MESSAGE_TIMING_POINTS) {
    const at = value.points[point];
    if (at !== null && (!Number.isSafeInteger(at) || Number(at) < (point === "T0" ? -LIMIT : 0) || Number(at) > (point === "T0" ? 0 : LIMIT))) return null;
  }
  if ((value.points.T0 === null) !== (value.clientClockErrorMs === null) || value.points.T7 !== null && value.clientClockErrorMs === null) return null;
  return structuredClone(value) as unknown as MessageTimingReport;
}

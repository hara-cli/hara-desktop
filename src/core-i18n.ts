import catalog from "./locales/errors.json" with { type: "json" };
import { coreText, type CoreMessageKey } from "./locales/core-messages.ts";
import { currentClientLocale, type Locale } from "./locales/core-locale.ts";
export { coreText, currentClientLocale };
const errorRows = new Map(catalog.errors.map(row => [row.code, row]));
export function coreErrorKey(code: unknown): CoreMessageKey {
  return (typeof code === "string" ? errorRows.get(code)?.key : undefined) as CoreMessageKey ?? "core.error.request_failed";
}
export class WorkspacePublicRpcError extends Error {
  readonly messageKey: CoreMessageKey;
  readonly params: Record<string, string | number>;
  readonly technicalDetail: string;
  readonly publicCode: string;
  readonly code: number | undefined;
  constructor(code: number | undefined, data: unknown, legacyMessage: string, locale: Locale = currentClientLocale().tag) {
    const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const row = typeof value.code === "string" ? errorRows.get(value.code) : undefined;
    const params = value.params && typeof value.params === "object" && !Array.isArray(value.params) ? value.params as Record<string, unknown> : {};
    const valid = row && value.params !== null && typeof value.params === "object" && !Array.isArray(value.params) && Object.keys(params).length === row.params.length && row.params.every(name => Object.prototype.hasOwnProperty.call(params, name)
      && (typeof params[name] === "string" && params[name].length <= 500 || typeof params[name] === "number" && Number.isFinite(params[name])));
    const key = valid ? row.key as CoreMessageKey : "core.error.request_failed";
    super(coreText(key, locale, valid ? params as Record<string, string | number> : {}));
    this.code = code;
    this.messageKey = key; this.params = valid ? params as Record<string, string | number> : {}; this.publicCode = valid ? row.code : "request_failed";
    this.technicalDetail = (typeof value.technicalDetail === "string" ? value.technicalDetail : legacyMessage).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").slice(0, 500);
  }
  toString() { return this.messageKey; }
}
export function workspaceErrorState(error: unknown): { error: string; errorTechnicalDetail: string } {
  return error instanceof WorkspacePublicRpcError ? { error: error.messageKey, errorTechnicalDetail: error.technicalDetail }
    : { error: String(error), errorTechnicalDetail: "" };
}
export function workspaceCoreMessage(value: string, locale: Locale): string | undefined {
  const key = value.replace(/^Error: /u, "");
  return catalog.errors.some(row => row.key === key) ? coreText(key as CoreMessageKey, locale) : undefined;
}

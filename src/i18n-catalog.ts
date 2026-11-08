/**
 * Tuple views over the locale JSON (B0).
 *
 * The legacy export shape `[key, en, zh-Hans, zh-Hant]` is kept so the existing
 * call sites and tests read exactly as before, but the values now come from
 * `src/locales/<lang>/<ns>.json`. `src/locales/keys.json` records which key
 * belongs to which export, preserving the original order and split.
 */
import keys from "./locales/keys.json" with { type: "json" };
import enWs from "./locales/en/ws.json" with { type: "json" };
import enVg from "./locales/en/vg.json" with { type: "json" };
import enCommon from "./locales/en/common.json" with { type: "json" };
import hansWs from "./locales/zh-Hans/ws.json" with { type: "json" };
import hansVg from "./locales/zh-Hans/vg.json" with { type: "json" };
import hansCommon from "./locales/zh-Hans/common.json" with { type: "json" };
import hantWs from "./locales/zh-Hant/ws.json" with { type: "json" };
import hantVg from "./locales/zh-Hant/vg.json" with { type: "json" };
import hantCommon from "./locales/zh-Hant/common.json" with { type: "json" };

export type TranslationTuple = readonly [key: string, en: string, zhHans: string, zhHant: string];

const EN: Record<string, string> = { ...enWs, ...enVg, ...enCommon };
const HANS: Record<string, string> = { ...hansWs, ...hansVg, ...hansCommon };
const HANT: Record<string, string> = { ...hantWs, ...hantVg, ...hantCommon };
const LIST: Record<string, readonly string[]> = keys as Record<string, readonly string[]>;

export function tuplesFor(exportName: string): readonly TranslationTuple[] {
  const list = LIST[exportName];
  if (!list) throw new Error(`i18n: no key list for ${exportName}`);
  return list.map(key => {
    const en = EN[key], hans = HANS[key], hant = HANT[key];
    if (typeof en !== "string" || typeof hans !== "string" || typeof hant !== "string") {
      throw new Error(`i18n: ${key} is missing from the locale JSON`);
    }
    return [key, en, hans, hant] as const;
  });
}

/** Every workspace key (ws.*, vg.*, common.*); used for `Key` and for membership tests. */
export const WORKSPACE_KEY_SET: ReadonlySet<string> = new Set(Object.keys(EN));

export type WorkspaceKey = keyof typeof enWs | keyof typeof enVg | keyof typeof enCommon;

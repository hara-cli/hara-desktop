/** Runtime diagnostic stage labels and export copy. Values live in `src/locales/<lang>/<namespace>.json`; this keeps the legacy tuple shape. */
import { tuplesFor, type TranslationTuple } from "./i18n-catalog.ts";

export const RUNTIME_STAGE_KEYS: readonly TranslationTuple[] = tuplesFor("RUNTIME_STAGE_KEYS");

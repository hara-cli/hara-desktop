/** Runtime version drift and trust copy. Values live in `src/locales/<lang>/<namespace>.json`; this keeps the legacy tuple shape. */
import { tuplesFor, type TranslationTuple } from "./i18n-catalog.ts";

export const RUNTIME_VERSION_KEYS: readonly TranslationTuple[] = tuplesFor("RUNTIME_VERSION_KEYS");

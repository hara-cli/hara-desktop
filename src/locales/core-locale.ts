import { LOCALE_REGISTRY, type Locale } from "./registry.generated.ts";
import { detectLocale } from "../i18n.ts";
export { LOCALE_REGISTRY, type Locale } from "./registry.generated.ts";
export function localeDescriptor(tag: Locale) {
  const row = LOCALE_REGISTRY.languages.find(row => row.tag === tag)!;
  return { tag, fallback: [...row.fallback] };
}
export function currentClientLocale() { return localeDescriptor(detectLocale()); }

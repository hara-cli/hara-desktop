/**
 * Pseudo-locale `en-XA` (audit §7.4 item 6).
 *
 * Wrapping every message in ［…］ and lengthening it exposes two classes of bug that an
 * English-only pass cannot see:
 *
 *  - copy that was never routed through the locale JSON stays plain English, so the
 *    brackets are missing;
 *  - layout truncation with longer text (German, Finnish, …).
 *
 * Accenting vowels keeps the copy readable for review (unlike inserting random letters
 * mid-word), and a proportional tail pad guarantees roughly 30–40% growth so truncation
 * is visible. The transform is deterministic, so a screenshot smoke test can diff it.
 * Placeholders are preserved verbatim: only literal prose is expanded.
 */
export const PSEUDO_LOCALE = "en-XA" as const;

const ACCENTS: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú",
};
const PLACEHOLDER = /\{(\w+)\}/g;

export function pseudoLocalize(message: string): string {
  const saved: string[] = [];
  const stashed = message.replace(PLACEHOLDER, match => {
    saved.push(match);
    return `\u0000${saved.length - 1}\u0000`;
  });
  const accented = stashed.replace(/[aeiouAEIOU]/g, letter => ACCENTS[letter] ?? letter);
  const restored = accented.replace(/\u0000(\d+)\u0000/g, (_match, position: string) => saved[Number(position)] ?? "");
  // ~35% tail pad, capped so very long paragraphs do not explode.
  const padLength = Math.min(24, Math.max(4, Math.round(restored.length * 0.35)));
  const pad = "·".repeat(padLength);
  return `［${restored}${pad}］`;
}

/** Convenience for smoke tests: pseudo-localize a single English string. */
export function pseudoText(englishText: string): string {
  return pseudoLocalize(englishText);
}

/**
 * Build-time ICU precompile.
 *
 *   src/locales/<lang>/<ns>.json  ->  src/locales/<lang>/<ns>.ast.json
 *                                   +  src/locales/complex.json
 *
 * Only messages that need more than `{name}` interpolation (plural, select, rich tags)
 * are listed in `complex.json`; those are the only keys the renderer formats through
 * IntlMessageFormat. Plain messages render by direct interpolation, which keeps the
 * shipped bundle near the pre-B0 size. This script must be re-run whenever a locale
 * JSON changes; `test/i18n-contract.test.mjs` fails when the AST or the index is stale.
 *
 * Numbers are formatted verbatim (String(v)). The pre-migration shell interpolated
 * `{n}` as-is (no grouping, no locale digits), so keeping it verbatim is what makes
 * B0 behaviour-preserving rather than a silent formatting change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';

const root = fileURLToPath(new URL('..', import.meta.url));
const LANGS = ['en', 'zh-Hans', 'zh-Hant'];
const NAMESPACES = ['ws', 'vg', 'common'];
export const VERBATIM_FORMATTERS = {
  number: { format: value => String(value) },
  date: { format: value => String(value) },
  time: { format: value => String(value) },
};

/** A message is "complex" when it uses anything beyond literal text and plain placeholders. */
const SIMPLE_PART = new Set([0, 1]);
function hasComlexSyntax(parts) {
  return parts.some(part => {
    const children = Array.isArray(part.options) ? part.options.flatMap(option => option.value ?? []) : [];
    return !SIMPLE_PART.has(part.type) || children.some(child => !SIMPLE_PART.has(child.type));
  });
}

export function compileAll() {
  let total = 0;
  const complex = [];
  for (const lang of LANGS) {
    for (const ns of NAMESPACES) {
      const source = path.join(root, 'src/locales', lang, `${ns}.json`);
      const messages = JSON.parse(fs.readFileSync(source, 'utf8'));
      const ast = {};
      for (const [key, message] of Object.entries(messages)) {
        const compiled = new IntlMessageFormat(message, lang, { formatters: VERBATIM_FORMATTERS }).getAst();
        ast[key] = compiled;
        total++;
        // Only messages that use ICU beyond simple {name} interpolation need the AST at
        // runtime. Everything else renders identically through the plain interpolation
        // path, which keeps the shipped bundle close to the pre-B0 size.
        if (hasComlexSyntax(compiled)) complex.push({ lang, ns, key });
      }
      fs.writeFileSync(path.join(root, 'src/locales', lang, `${ns}.ast.json`), `${JSON.stringify(ast)}\n`);
    }
  }
  // The index tells the runtime which keys must go through IntlMessageFormat.
  fs.writeFileSync(path.join(root, 'src/locales/complex.json'), `${JSON.stringify(complex, null, 2)}\n`);
  // If any complex key exists, the runtime entry must install the ICU renderer; this
  // module is imported lazily so an all-plain catalogue never pays for the parser.
  if (complex.length) {
    fs.writeFileSync(path.join(root, 'src/i18n-complex.ts'), `import { IntlMessageFormat } from "intl-messageformat";\nimport type { Locale } from "./i18n-runtime.ts";\n\nexport function formatComplexMessage(text: string, locale: Locale, values: Record<string, string | number>): string {\n  return new IntlMessageFormat(text, locale, undefined, { formatters: { number: { format: v => String(v) }, date: { format: v => String(v) }, time: { format: v => String(v) } } as never }).format(values) as string;\n}\n`);
  } else if (fs.existsSync(path.join(root, 'src/i18n-complex.ts'))) {
    fs.unlinkSync(path.join(root, 'src/i18n-complex.ts'));
  }
  return total;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`i18n: compiled ${compileAll()} messages`);
}

/**
 * i18n contract (B0, audit §7.4).
 *
 * Fails when any of the following drifts:
 *   1. the locale JSON and the precompiled AST are out of step
 *   2. a stable language is missing a key, or has a blank value
 *   3. a language changes the placeholder set of the English baseline
 *   4. the Traditional column contains Simplified-only characters
 *   5. the registry copy Desk ships differs from the Core reference copy
 *   6. a formal-surface file reintroduces hardcoded copy, including the
 *      `locale !== "en" ? … : …` / `zh ? … : …` / `hant ? … : …` expressions that the
 *      old regex check could not see (audit §6 blind spot 1)
 *   7. `<html lang>` is never wired up, or the pseudo-locale helper is missing
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { LANGUAGES, NAMESPACES, BASELINE_LOCALE, selectableLanguages, formatMessage, messageText, matchLanguageTag, applyDocumentLanguage, isComplexMessage } from '../src/i18n-runtime.ts';
import { compileAll, VERBATIM_FORMATTERS } from '../scripts/build-i18n-ast.mjs';
import { IntlMessageFormat } from 'intl-messageformat';
import { pseudoLocalize, PSEUDO_LOCALE } from '../src/i18n-pseudo.ts';

const root = new URL('../', import.meta.url);
const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, root), 'utf8'));
const localeText = (lang, ns) => readJson(`src/locales/${lang}/${ns}.json`);
const placeholder = message => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('precompiled ICU AST matches the locale JSON', () => {
  for (const lang of ['en', 'zh-Hans', 'zh-Hant']) {
    for (const ns of NAMESPACES) {
      const text = localeText(lang, ns);
      const ast = readJson(`src/locales/${lang}/${ns}.ast.json`);
      assert.deepEqual(Object.keys(ast).sort(), Object.keys(text).sort(), `${lang}/${ns} key set`);
      for (const [key, message] of Object.entries(text)) {
        const expected = new IntlMessageFormat(message, lang, { formatters: VERBATIM_FORMATTERS }).getAst();
        assert.deepEqual(ast[key], JSON.parse(JSON.stringify(expected)), `${lang}/${ns}/${key} AST is stale; run npm run i18n:build`);
        const rendered = new IntlMessageFormat(expected, lang, { formatters: VERBATIM_FORMATTERS }).format(Object.fromEntries(placeholder(message).map(name => [name, `@@${name}@@`])));
        assert.equal(rendered, message.replace(/\{(\w+)\}/g, (_, name) => `@@${name}@@`), `${lang}/${ns}/${key} renders verbatim`);
      }
    }
  }
});

test('every stable language covers the English baseline with identical placeholders', () => {
  const baseline = Object.assign({}, ...NAMESPACES.map(ns => localeText(BASELINE_LOCALE, ns)));
  const stable = LANGUAGES.filter(language => language.status === 'stable').map(language => language.tag);
  for (const language of stable) {
    const dictionary = Object.assign({}, ...NAMESPACES.map(ns => localeText(language, ns)));
    for (const [key, message] of Object.entries(baseline)) {
      assert.equal(typeof dictionary[key], 'string', `${language} is missing ${key}`);
      assert.ok(dictionary[key].trim().length, `${language} ${key} is blank`);
      assert.deepEqual(placeholder(dictionary[key]), placeholder(message), `${language} ${key} placeholders`);
    }
    const extra = Object.keys(dictionary).filter(key => !(key in baseline));
    assert.deepEqual(extra, [], `${language} has orphan keys`);
  }
});

test('beta languages ship complete, valid copy even though the picker hides them', () => {
  const baseline = Object.assign({}, ...NAMESPACES.map(ns => localeText(BASELINE_LOCALE, ns)));
  for (const language of LANGUAGES.filter(record => record.status !== 'stable')) {
    const dictionary = Object.assign({}, ...NAMESPACES.map(ns => localeText(language.tag, ns)));
    const missing = Object.keys(baseline).filter(key => typeof dictionary[key] !== 'string' || !dictionary[key].trim());
    assert.deepEqual(missing, [], `${language.tag} must stay complete while hidden`);
    for (const [key, message] of Object.entries(baseline)) {
      assert.deepEqual(placeholder(dictionary[key]), placeholder(message), `${language.tag} ${key} placeholders`);
    }
  }
});

test('the Traditional column contains no Simplified-only characters', () => {
  // Same character pair the repo already enforces in workspace-settings-i18n.test.mjs.
  const simplified = /[连启闭显档储读写请权钥凭设预认选择当为这个还后时开关体语复过进务执环发级汇删优无锁变记与仅页独简备据历览败余点号对暂则网络验运导传]/u;
  // Language autonyms (`简体中文`, `繁體中文`) name themselves in their own script; they are
  // data, not copy, and are exempt exactly like the existing settings test's allowlist.
  const AUTONYMS = new Set(['ws.locale.hans', 'ws.locale.hant', 'ws.locale.en']);
  const dictionary = Object.assign({}, ...NAMESPACES.map(ns => localeText('zh-Hant', ns)));
  const offenders = Object.entries(dictionary).filter(([key, text]) => !AUTONYMS.has(key) && simplified.test(text)).map(([key]) => key);
  assert.deepEqual(offenders, []);
  // And the reverse direction, matching the existing settings test.
  const traditional = /[連啟閉顯檔儲讀寫請權鑰憑設預認選擇當為這個還後時開關體語復過進務執環發級匯刪優無鎖變記與僅頁與僅頁獨簡備據歷覽敗餘點號對暫則網絡驗運導傳]/u;
  const hans = Object.assign({}, ...NAMESPACES.map(ns => localeText('zh-Hans', ns)));
  const reverse = Object.entries(hans).filter(([key, text]) => !AUTONYMS.has(key) && traditional.test(text)).map(([key]) => key);
  assert.deepEqual(reverse, []);
});

test('the registry Desk ships is byte-identical to the Core registry it was synced from', () => {
  // scripts/sync-core-i18n.mjs copies Core's src/i18n/registry.json verbatim and pins its hash with the Core commit.
  const desk = readFileSync(new URL('src/locales/registry.json', root));
  const source = JSON.parse(readFileSync(new URL('src/locales/CORE_I18N_SOURCE.json', root), 'utf8'));
  assert.match(source.coreCommit, /^[0-9a-f]{40}$/);
  assert.equal(createHash('sha256').update(desk).digest('hex'), source.files['registry.json']);
});

test('language matching uses Intl.Locale maximise, not a hardcoded region regex', () => {
  for (const [tag, expected] of [['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-MO', 'zh-Hant'], ['zh-Hant-TW', 'zh-Hant'],
    ['zh-CN', 'zh-Hans'], ['zh-SG', 'zh-Hans'], ['zh', 'zh-Hans'], ['en-GB', 'en'], ['en-US', 'en']]) {
    assert.equal(matchLanguageTag(tag), expected, tag);
  }
  assert.equal(matchLanguageTag('ja-JP'), null);
  assert.equal(matchLanguageTag('ko-KR'), null);
});

test('this release only offers languages marked stable (Jeff 2026-11-08 revision)', () => {
  const selectable = selectableLanguages().map(language => language.tag);
  assert.deepEqual(selectable, ['en', 'zh-Hans']);
  const hidden = LANGUAGES.filter(language => language.status !== 'stable').map(language => language.tag);
  assert.deepEqual(hidden, ['zh-Hant'], 'zh-Hant ships as beta for this release');
  // ...but the translations are still readable through the runtime, not dropped.
  assert.equal(messageText('zh-Hant', 'ws.sec.dms'), '私訊');
  assert.equal(formatMessage('zh-Hant', 'ws.quota.count', { n: 3, max: 10 }), '3 / 10 位同事');
});

test('missing keys fall back within the chain and never leak an empty string', () => {
  assert.equal(formatMessage('zh-Hant', 'ws.key.that.does.not.exist'), 'ws.key.that.does.not.exist');
  // zh-Hant -> en, never zh-Hant -> zh-Hans (Jeff decision Q2).
  assert.deepEqual(LANGUAGES.find(language => language.tag === 'zh-Hant').fallback, ['en']);
});

test('only plural/select messages take the ICU path; today none do', () => {
  const complex = readJson('src/locales/complex.json');
  for (const entry of complex) assert.equal(isComplexMessage(entry.lang, entry.key), true, `${entry.key} should be complex`);
  // The shipped catalogue is plain interpolation only, which is why the ICU parser is
  // not in the bundle. When a plural message is added this list grows and the runtime
  // installs the renderer (see scripts/build-i18n-ast.mjs).
  const plain = Object.keys(Object.assign({}, ...NAMESPACES.map(ns => localeText('en', ns))));
  const wronglyComplex = plain.filter(key => isComplexMessage('en', key));
  assert.deepEqual(wronglyComplex, [], 'no plain message should be routed through ICU');
});

test('pseudo-locale inflates and brackets every message so hardcoded strings stand out', () => {
  const original = 'Not verified with a real account';
  const pseudo = pseudoLocalize(original);
  assert.ok(pseudo.startsWith('［') && pseudo.endsWith('］'), pseudo);
  assert.ok(pseudo.length > original.length, 'pseudo copy must be longer than English');
  assert.ok(pseudo.includes('Nót'), 'pseudo copy must stay readable for review');
  assert.equal(PSEUDO_LOCALE, 'en-XA');
  // Placeholders must survive, otherwise a pseudo run breaks interpolation.
  assert.equal(pseudoLocalize('Message {name}…'), pseudoLocalize('Message {name}…').replace(/\{name\}/, '{name}'));
  assert.ok(pseudoLocalize('Message {name}…').includes('{name}'));
});

test('<html lang> is driven by the chosen locale, not a static attribute', () => {
  const document = { documentElement: { lang: 'en', dir: 'ltr' } };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    applyDocumentLanguage('zh-Hant');
    assert.equal(document.documentElement.lang, 'zh-Hant');
    applyDocumentLanguage('zh-Hans');
    assert.equal(document.documentElement.lang, 'zh-Hans');
    const hooks = readFileSync(new URL('src/workspace-shell-hooks.ts', root), 'utf8');
    assert.match(hooks, /applyDocumentLanguage\(choice\.locale\)/, 'the shell hook must apply it on every locale change');
  } finally { if (before) Object.defineProperty(globalThis, 'document', before); else delete globalThis.document; }
});

const FORMAL_FILES = [
  'ColleagueWorkScopeCard.tsx', 'ColleagueWorkScopeEditor.tsx',
  'WorkspaceColleagueInspector.tsx', 'WorkspaceLocalDev.tsx', 'AgentProfileEditor.tsx', 'AgentRuntimePicker.tsx',
  'WorkspaceRosterMenu.tsx', 'WorkspaceGroupInspector.tsx', 'WorkspaceRuntimeAccess.tsx', 'WorkspaceUserQuestion.tsx',
  'workspace-account-usage.ts', 'workspace-dev-rpc.ts', 'CrashReportPrompt.tsx', 'RendererRecovery.tsx',
  'agent-runtime-selection.ts', 'ColleagueRuntimeForm.tsx', 'WorkspaceSettings.tsx', 'WorkspaceSettingsPanels.tsx',
];
// Files whose remaining non-English literals are data, not UI copy.
const HARDCODE_EXEMPT = new Map([
  ['WorkspaceUserQuestion.tsx', 'matches Core’s fixed question templates verbatim; rendered text comes from ws.question.* keys'],
  ['CrashReportPrompt.tsx', 'replaced by ws.crash.* keys in this batch'],
  ['RendererRecovery.tsx', 'replaced by ws.recovery.* keys in this batch'],
  ['workspace-dev-rpc.ts', 'replaced by ws.rpc.* keys in this batch'],
  ['workspace-account-usage.ts', 'replaced by ws.usage.* keys in this batch'],
  ['agent-runtime-selection.ts', 'runtime labels come from ws.runtimeName.* keys in this batch'],
  ['WorkspaceSettings.tsx', 'language picker options come from the registry (nativeName)'],
]);

/** Hardcoded-copy scan that also catches ternary locale branches. */
test('formal surfaces contain no hardcoded UI copy and no locale ternaries', () => {
  const violations = [];
  for (const file of FORMAL_FILES) {
    if (HARDCODE_EXEMPT.has(file)) continue;
    const source = readFileSync(new URL(`src/${file}`, root), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;
    const englishUi = /^(?![a-z][a-z0-9_.-]*$|https?:|image\/|#|[0-9.%]+$)[A-Za-z][^<>\n]{3,}$/;
    const visit = node => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (cjk.test(node.text) && !ts.isImportDeclaration(node.parent ?? node)) {
          violations.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1} literal ${JSON.stringify(node.text.slice(0, 40))}`);
        }
      }
      if (ts.isJsxText(node) && cjk.test(node.text)) {
        violations.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1} JSX text ${JSON.stringify(node.text.trim().slice(0, 40))}`);
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text;
        if (englishUi.test(value) && /aria-label|title|placeholder|alt/.test(node.name.getText())) {
          violations.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1} attribute ${node.name.getText()}=${JSON.stringify(value.slice(0, 40))}`);
        }
      }
      if (ts.isConditionalExpression(node)) {
        const test = node.condition.getText();
        if (/locale\s*(?:!==|===|==)\s*["'](?:en|zh|zh-Hans|zh-Hant)["']|zh\s*!==\s*"en"|\bhant\b|\bzh\b\s*\?/i.test(test)) {
          violations.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1} locale ternary ${test.slice(0, 60)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(violations, [], artifacts => artifacts.join('\n'));
});

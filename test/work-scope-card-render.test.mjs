import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-work-scope-render-"));
after(() => rmSync(fixture, { recursive: true, force: true }));

// Exercise the actual card and translations. Only its asynchronous read hook is
// replaced with a render fixture; this does not test or grant read authority.
// With no model, the real editor keeps its normal fail-closed behavior.
const bundle = await build({
  stdin: {
    contents: [
      "import { createElement } from 'react';",
      "import { renderToStaticMarkup } from 'react-dom/server';",
      "import { ColleagueWorkScopeCard } from './src/ColleagueWorkScopeCard.tsx';",
      "import { setView } from 'c5-work-scope-ssr-fixture';",
      "export function render(locale, view) {",
      "  setView(view);",
      "  return renderToStaticMarkup(createElement(ColleagueWorkScopeCard, {",
      "    locale, agent: {agentId:'ssr-colleague'},",
      "    workspace: {workspaceId:'ssr-workspace',resourceGeneration:'ssr-generation'}",
      "  }));",
      "}",
    ].join("\n"),
    resolveDir: fileURLToPath(root),
    loader: "js",
  },
  plugins: [{
    name: "work-scope-render-fixture",
    setup(build) {
      build.onResolve({ filter: /^(?:\.\/use-colleague-work-scope|c5-work-scope-ssr-fixture)$/ },
        () => ({ path: "c5-work-scope-ssr-fixture", namespace: "c5-ssr" }));
      build.onLoad({ filter: /.*/, namespace: "c5-ssr" }, () => ({
        contents: "let view; export function setView(value) { view = value; } export function useColleagueWorkScope() { return {value:{key:'ssr',state:'ready',view},retry(){}}; }",
        loader: "js",
      }));
    },
  }],
  bundle: true, format: "cjs", platform: "node", jsx: "automatic",
  loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "card.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(compiled);

function saved(label, path) {
  return {
    state: "saved",
    profile: { title: "Accounts colleague", description: "", owns: [], rejects: [] },
    tools: { allow: [], deny: [], readOnly: true }, approvals: [],
    resources: [{ resourceId: "ssr-directory", label, path, access: ["read"] }],
    revisions: { policy: 1, duty: 1, boundary: 1 },
    limits: { modelCalls: 0, toolEffects: 0 },
  };
}

for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
  test("C5 real card keeps full paths only in collapsed Advanced: " + locale, () => {
    const cases = [
      ["Accounts", "/Users/synthetic/private/Accounts"],
      ["~/Documents/Accounts", "/Users/synthetic/Documents/Accounts"],
      [null, "D:\\private\\Accounts"],
      [null, "\\\\server\\private\\Accounts"],
    ];
    for (const [label, path] of cases) {
      const html = render(locale, saved(label, path));
      const advanced = html.match(/<details\b[^>]*class="hd-work-scope-advanced"[^>]*>[\s\S]*?<\/details>/)?.[0];
      assert.ok(advanced, "Advanced remains available");
      assert.doesNotMatch(advanced.slice(0, advanced.indexOf(">") + 1), /\bopen(?:=|\s|>)/,
        "Advanced starts collapsed");
      const defaultMarkup = html.replace(advanced, "");
      const directories = defaultMarkup.match(/<ul class="hd-work-scope-directories">[\s\S]*?<\/ul>/)?.[0];
      assert.ok(directories, "The default directory list is still rendered");
      assert.match(directories, /<strong>Accounts<\/strong>/, "The directory name stays visible");
      assert.equal(defaultMarkup.includes(path), false, "Full paths must not appear outside Advanced");
      assert.equal(advanced.includes(path), true, "Advanced retains the exact registered path");
      assert.equal(html.split(path).length - 1, 1, "The path occurs once, under Advanced only");
    }
  });
}

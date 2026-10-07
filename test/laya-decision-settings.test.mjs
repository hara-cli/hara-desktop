import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-laya-settings-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { LayaDecisionPanel, layaErrorMessage } from "./src/DecisionGuardSettings.tsx";
      export { layaErrorMessage };
      export function render(locale, runtime) {
        return renderToStaticMarkup(createElement(LayaDecisionPanel, { locale, runtime }));
      }
    `,
    resolveDir: root.pathname,
    loader: "tsx",
  },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", write: false,
});
const compiled = join(fixture, "settings.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render, layaErrorMessage } = createRequire(import.meta.url)(compiled);
const runtime = { supported: true, status: "missing", model: "aac6fef/laya-multilingual-mlx", revision: "pinned", contextTokens: 1024, experimental: true };

test("the actual local panel clearly shows every preparation state in English and Chinese", () => {
  for (const locale of ["en", "zh"]) {
    for (const status of ["unsupported", "missing", "preparing", "ready", "error"]) {
      const html = render(locale, { ...runtime, status, supported: status !== "unsupported" });
      assert.match(html, new RegExp(`data-runtime-status="${status}"`));
      assert.match(html, /1,024/);
      assert.match(html, /laya-multilingual-mlx/);
      assert.match(html, locale === "zh" ? /不会自动回退到云端/ : /No automatic cloud fallback/);
      assert.match(html, locale === "zh" ? /主聊天模型仍使用自己的连接/ : /main chat model keeps its own connection/);
      assert.match(html, locale === "zh" ? /不负责 OCR、看屏幕或写代码/ : /Not an OCR, screen-reading or coding engine/);
      assert.doesNotMatch(html, /type="password"|api\.typesafe\.ai/);
    }
  }
});

test("model labels and diagnostics remain escaped text, and known local errors are localized", () => {
  const html = render("zh", { ...runtime, status: "error", model: "<script>unsafe()</script>", error: "Laya runtime/model verification failed; prepare the local engine again" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /校验失败，请重新准备/);
  assert.match(layaErrorMessage("Laya input exceeds its 1024-token context", "zh"), /不会截断/);
  assert.equal(layaErrorMessage("diagnostic", "en"), "diagnostic");
});

test("settings preserve Jev credentials and unsaved edits, require consent, and limit Laya to shadow", () => {
  const source = readFileSync(new URL("src/DecisionGuardSettings.tsx", root), "utf8");
  assert.match(source, /state\.laya && <option value="laya-mlx" disabled=\{!state\.laya\.supported\}/);
  assert.match(source, /if \(next === "laya-mlx"\) setMode\("shadow"\)/);
  assert.match(source, /disabled=\{local \|\| !state\.modeEditable \|\| busy\}/);
  assert.match(source, /window\.confirm\(words\.localConfirm\)/);
  assert.match(source, /prepareLayaRuntime\(true\)/);
  assert.match(source, /!local && apiKey\.trim\(\) \? \{ apiKey:/,
    "choosing local does not overwrite or forward a stored cloud key");
  assert.match(source, /current \? \{ \.\.\.current, laya: next\.laya \}/,
    "preparation polling changes only runtime status, not the user's draft engine or credentials");
  assert.match(source, /if \(local && !result\.ok\)[\s\S]*?client\.getDecisionSettings/,
    "failed verification makes the repair action available without navigating away");
  assert.match(source, /operationLock\.current = true;[\s\S]*?ticket = generation\.current/);
  assert.match(source, /ticket !== generation\.current/,
    "responses from an old Engine cannot update a new Engine's settings");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { parseRuntimeFailure, RUNTIME_FAILURE_KINDS, RUNTIME_FAILURE_MARKER, runtimeDiagnosticSummary, runtimeCooldownRemaining, retryRuntimeFailure, copyRuntimeDiagnostic } from "../src/runtime-failure.ts";
import { runtimeTurnFailure, connectionRecoveryReason } from "../src/workspace-resume.ts";

const sample = (overrides = {}) => ({ runtime: "codex", kind: "runtime_auth_rejected", version: "0.163.0", loginSource: "host", homeMatchesAccount: false, elapsedMs: 812, retryAtMs: 0, consecutiveFailures: 2, ...overrides });
const envelope = (overrides) => `[registered-codex error] ${RUNTIME_FAILURE_MARKER}${JSON.stringify(sample(overrides))} — check existing results`;
const require = createRequire(import.meta.url);
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceTaskRecovery.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" }, bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { WorkspaceTaskRecovery } = module.exports, { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const conversation = error => ({ state: "blocked", taskState: "blocked", sessionId: "original-session", taskId: "original-task", runId: "original-run", blockReason: error, history: [{ role: "user", content: "original request" }], resumeAdmission: { allowed: true } });
const props = (error, locale = "en", runtimeId = "codex") => ({ conversation: conversation(error), t: makeT(locale), runtimeId, disabled: false, onContinue() { throw Error("render must not retry"); }, onRepair() {}, onLogin() {}, onRuntimeSettings() {}, onRescan() {} });

for (const runtime of ["pi", "codex", "claude", "opencode"]) for (const kind of RUNTIME_FAILURE_KINDS) test(`${runtime} ${kind} diagnostic retains only closed fields`, () => {
  const parsed = parseRuntimeFailure(envelope({ runtime, kind }), runtime);
  assert.deepEqual(parsed, sample({ runtime, kind }));
  assert.equal(runtimeTurnFailure(envelope({ runtime, kind }), runtime)?.kind, kind);
  assert.equal(connectionRecoveryReason({ state: "blocked", blockReason: envelope({ runtime, kind }) }), null);
});

test("malformed, private, cross-runtime and oversized diagnostics cannot reach the card or clipboard", () => {
  const privateText = "PRIVATE_PROMPT token=secret /Users/private/account https://private.example/?key=secret";
  const errors = [undefined, null, "", RUNTIME_FAILURE_MARKER + "no-json", RUNTIME_FAILURE_MARKER + JSON.stringify(sample({ version: privateText })),
    envelope({ secret: privateText }), envelope({ kind: privateText }), envelope({ runtime: privateText }), envelope({ loginSource: privateText }), envelope({ elapsedMs: -1 }), envelope({ elapsedMs: 600001 }), envelope({ elapsedMs: 0.5 }), envelope({ retryAtMs: Infinity }), envelope({ consecutiveFailures: 1001 }), envelope({ homeMatchesAccount: "yes" }), envelope({ version: "2.1.0\n" }), envelope({ version: "2.1.0-beta" }),
    envelope() + envelope(), "x".repeat(4097) + envelope(), envelope({ runtime: "claude" }), RUNTIME_FAILURE_MARKER + "{}", RUNTIME_FAILURE_MARKER + JSON.stringify(sample()).replace("{", '{"runtime":"codex",')];
  for (const error of errors) {
    assert.equal(parseRuntimeFailure(error, "codex"), null);
    if (typeof error === "string" && error.includes(RUNTIME_FAILURE_MARKER)) {
      const html = render(h(WorkspaceTaskRecovery, props(error)));
      assert.doesNotMatch(html, /PRIVATE_PROMPT|token=|\/Users\/private|private\.example|hara_runtime_failure_v1|ws\.runtimeDiagnostic|data-runtime-diagnostic/);
    }
  }
  const safe = parseRuntimeFailure("PRIVATE_PREFIX " + envelope() + " PRIVATE_SUFFIX", "codex");
  const summary = runtimeDiagnosticSummary(safe, makeT("en"));
  assert.doesNotMatch(summary, /PRIVATE|original request|token|secret|\/Users|example/);
  assert.match(summary, /0\.163\.0/);
});

test("all categories render distinct localized explanations and summaries without upstream error or translation keys", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const runtime of ["pi", "codex", "claude", "opencode"]) for (const kind of RUNTIME_FAILURE_KINDS) {
    const t = makeT(locale), html = render(h(WorkspaceTaskRecovery, props("PRIVATE " + envelope({ runtime, kind }) + " PRIVATE", locale, runtime)));
    assert.ok(html.includes(`data-failure-kind="${kind}"`));
    assert.ok(html.includes(t(`ws.resume.runtime.${kind}.title`).replace(/'/g, "&#x27;")));
    assert.ok(html.includes('data-runtime-diagnostic="true"'));
    assert.ok(html.includes(t("ws.runtimeDiagnostic.copy")));
    assert.doesNotMatch(html, /PRIVATE|hara_runtime_failure_v1|ws\.resume\.|ws\.runtimeDiagnostic\.|Raft/);
    assert.match(html, /data-recovery-retry="true"/);
  }
});

test("401 rejection does not assert missing host login, and private login never offers global commands", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const runtime of ["codex", "claude", "opencode"]) {
    const t = makeT(locale), host = render(h(WorkspaceTaskRecovery, props(envelope({ runtime }), locale, runtime)));
    const command = runtime === "codex" ? "codex login" : runtime === "claude" ? "claude" : "opencode auth login";
    assert.ok(host.includes(t("ws.runtimeDiagnostic.hostLogin", { command })));
    assert.ok(host.includes(t("ws.runtimeDiagnostic.homeMismatch")));
    assert.ok(!host.includes(t("ws.resume.runtime.runtime_auth_required.title")));
    const isolated = render(h(WorkspaceTaskRecovery, props(envelope({ runtime, loginSource: "isolated" }), locale, runtime)));
    assert.ok(isolated.includes(t("ws.runtimeDiagnostic.privateLogin")));
    if (runtime !== "claude") assert.equal(isolated.includes(command), false);
    const unknown = render(h(WorkspaceTaskRecovery, props(envelope({ runtime, loginSource: "unknown", version: null, homeMatchesAccount: null }), locale, runtime)));
    assert.ok(unknown.includes(t("ws.runtimeDiagnostic.unknownLogin")));
  }
});

test("cooldown blocks manual retry, expiry enables only an explicit click, and existing locks remain authoritative", () => {
  const diagnostic = sample({ retryAtMs: 31_000 }); let clicks = 0;
  const onContinue = () => clicks++;
  assert.equal(runtimeCooldownRemaining(diagnostic, 1000), 30_000);
  assert.equal(retryRuntimeFailure(diagnostic, false, onContinue, 30_999), false);
  assert.equal(clicks, 0);
  assert.equal(runtimeCooldownRemaining(diagnostic, 31_000), 0);
  assert.equal(clicks, 0, "time alone never submits");
  assert.equal(retryRuntimeFailure(diagnostic, true, onContinue, 31_000), false);
  assert.equal(retryRuntimeFailure(diagnostic, false, onContinue, 31_000), true);
  assert.equal(clicks, 1);
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const cooling = render(h(WorkspaceTaskRecovery, props(envelope({ retryAtMs: Date.now() + 30000 }), locale)));
    assert.match(cooling, /data-runtime-cooldown="true"/); assert.match(cooling, /data-recovery-retry="true"[^>]*disabled/);
    const expired = render(h(WorkspaceTaskRecovery, props(envelope({ retryAtMs: Date.now() - 1 }), locale)));
    assert.doesNotMatch(expired, /data-runtime-cooldown="true"|data-recovery-retry="true"[^>]*disabled/);
    for (const locks of [{ disabled: true }, { continueDisabled: true }, { conversation: { ...conversation(envelope()), state: "draining" } }, { conversation: { ...conversation(envelope()), resumeAdmission: { allowed: false, reason: "run_tokens" } } }]) {
      assert.match(render(h(WorkspaceTaskRecovery, { ...props(envelope(), locale), ...locks })), /data-recovery-retry="true"[^>]*disabled/);
    }
  }
});

test("copy uses only the reconstructed summary and reports clipboard rejection without details", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const parsed = parseRuntimeFailure("PRIVATE " + envelope() + " PRIVATE", "codex"), summary = runtimeDiagnosticSummary(parsed, makeT(locale));
    const copied = [];
    assert.equal(await copyRuntimeDiagnostic(summary, async value => { copied.push(value); }), "copied");
    assert.deepEqual(copied, [summary]); assert.doesNotMatch(copied[0], /PRIVATE|token|prompt/);
    assert.equal(await copyRuntimeDiagnostic(summary, undefined), "copyFailed");
    assert.equal(await copyRuntimeDiagnostic(summary, async () => { throw Error("PRIVATE clipboard error"); }), "copyFailed");
  }
});

test("OpenCode legacy fixed failures and registered native errors receive safe recovery", () => {
  assert.equal(runtimeTurnFailure("registered Runtime failed (command_failed); no fallback was selected", "opencode")?.kind, "command_failed");
  assert.equal(runtimeTurnFailure("runtime_network", "opencode")?.kind, "runtime_network");
  assert.equal(runtimeTurnFailure("opencode Runtime failed (command_not_found); private", "opencode")?.kind, "runtime_unavailable");
});


test("far-future cooldown records safely fall back while expired history stays usable", () => {
  const now = Date.now();
  assert.ok(parseRuntimeFailure(envelope({ retryAtMs: now + 30_000 }), "codex"));
  assert.ok(parseRuntimeFailure(envelope({ retryAtMs: 1 }), "codex"), "old history must not start a fresh cooldown");
  for (const retryAtMs of [now + 32_000, 8_640_000_000_000_000]) {
    const error = envelope({ retryAtMs });
    assert.equal(parseRuntimeFailure(error, "codex"), null);
    assert.equal(runtimeTurnFailure(error, "codex")?.kind, "runtime_failed");
    const html = render(h(WorkspaceTaskRecovery, props(error)));
    assert.doesNotMatch(html, /data-runtime-cooldown|data-runtime-diagnostic|hara_runtime_failure_v1|data-recovery-retry="true"[^>]*disabled/);
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const body = makeT(locale)("ws.resume.runtime.not_installed.body");
    assert.match(body, locale === "en" ? /uninstalled or not registered/ : locale === "zh-Hans" ? /尚未安装或尚未注册/ : /尚未安裝或尚未註冊/);
  }
});

test("escaped duplicate protocol keys cannot evade the closed diagnostic shape", () => {
  const source = "hara_runtime_failure_v1=" + JSON.stringify({ runtime: "codex", kind: "runtime_failed", version: null,
    loginSource: "unknown", homeMatchesAccount: null, elapsedMs: 0, retryAtMs: 0, consecutiveFailures: 0 });
  const duplicate = source.replace('"runtime":"codex"', '"runtime":"claude","\\u0072untime":"codex"');
  assert.equal(parseRuntimeFailure(duplicate, "codex"), null);
});

test("legacy auth-required records do not assert the host is signed out", () => {
  const legacy = "codex Runtime failed (runtime_auth_required); 401 PRIVATE_ACCOUNT";
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = render(h(WorkspaceTaskRecovery, props(legacy, locale)));
    assert.ok(html.includes(t("ws.resume.runtime.runtime_auth_required.title")));
    assert.match(html, locale === "en" ? /does not show whether login is missing or was rejected/ : locale === "zh-Hans" ? /无法确定是未登录还是认证被拒/ : /無法確定是未登入還是驗證遭拒/);
    assert.doesNotMatch(html, /PRIVATE_ACCOUNT|reported that login is missing|报告尚未登录|回報尚未登入/);
  }
});


test("Pi diagnostics use Hara connection repair and never offer a native or private login", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const html=render(h(WorkspaceTaskRecovery,props(envelope({runtime:"pi",version:"1.5.0",loginSource:"isolated"}),locale,"pi")));
    assert.match(html,/data-runtime-diagnostic="true"/);assert.match(html,/data-runtime-connection-guidance="true"/);
    assert.equal(html.includes(makeT(locale)("ws.runtimeDiagnostic.piConnection")),true);
    assert.equal(html.includes(makeT(locale)("ws.runtimeDiagnostic.homeMismatch")),false);
    assert.doesNotMatch(html,/data-runtime-login-guidance|codex login|opencode auth login|pi login/);
    assert.equal(html.includes(makeT(locale)("ws.runtimeDiagnostic.privateLogin")),false);
  }
});
for (const runtime of ["copilot", "cursor", "grok"]) test(runtime + " retains host binding and never offers re-login in any recovery source", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const loginSource of ["host", "isolated", "unknown"]) for (const kind of ["runtime_auth_required", "runtime_auth_rejected"]) {
    const t = makeT(locale), html = render(h(WorkspaceTaskRecovery, props(envelope({ runtime, kind, loginSource }), locale, runtime)));
    assert.ok(html.includes(t("ws.runtimeExpansion.loginReuseFailed")));
    assert.equal(html.includes(t("ws.resume.runtime.runtime_auth_required.body")), false);
    assert.equal((html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).some(button => button.replace(/<[^>]*>/g, "") === t("ws.resume.runtimeLogin")), false);
    assert.doesNotMatch(html, /onLogin|data-runtime-login-guidance|ws\.runtimeExpansion\.|PRIVATE/);
  }
});

test("inherited extension diagnostics remain closed, backward compatible and localized", () => {
  for (const runtime of ["copilot", "cursor", "grok"]) {
    const error = envelope({ runtime, extensionsIsolation: "inherited" });
    assert.equal(parseRuntimeFailure(error, runtime).extensionsIsolation, "inherited");
    assert.equal(Object.hasOwn(parseRuntimeFailure(envelope({ runtime }), runtime), "extensionsIsolation"), false);
    for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
      const html = render(h(WorkspaceTaskRecovery, props(error, locale, runtime)));
      assert.ok(html.includes(makeT(locale)("ws.runtimeDiagnostic.extensionsIsolation")));
      assert.ok(html.includes("inherited"));
    }
  }
  for (const overrides of [{ runtime: "codex", extensionsIsolation: "inherited" }, { runtime: "claude", extensionsIsolation: "inherited" },
    { runtime: "cursor", extensionsIsolation: "isolated" }, { runtime: "cursor", extensionsIsolation: "PRIVATE" }, { runtime: "cursor", extensionsIsolation: null },
    { runtime: "cursor", extensionsIsolation: "inherited", token: "PRIVATE" }]) assert.equal(parseRuntimeFailure(envelope(overrides)), null);
  const duplicate = envelope({ runtime: "cursor", extensionsIsolation: "inherited" }).replace('"extensionsIsolation":"inherited"', '"extensionsIsolation":"inherited","extensionsIsolation":"inherited"');
  assert.equal(parseRuntimeFailure(duplicate), null);
});


test("redacted native first line survives escaped JSON and appears first in card and clipboard summary", async () => {
  const firstLine = 'Error: invalid transport in mcp_servers."disabled" {transport}';
  for (const runtime of ["codex", "copilot", "cursor", "grok"]) for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const error = envelope({ runtime, errorFirstLine: firstLine, ...(runtime === "codex" ? {} : { extensionsIsolation: "inherited" }) });
    const parsed = parseRuntimeFailure(error, runtime);
    assert.equal(parsed.errorFirstLine, firstLine);
    const summary = runtimeDiagnosticSummary(parsed, makeT(locale));
    assert.ok(summary.split("\n")[0].endsWith(firstLine));
    const html = render(h(WorkspaceTaskRecovery, props(error, locale, runtime)));
    assert.match(html, /Error: invalid transport/);
    const copied = []; await copyRuntimeDiagnostic(summary, async text => copied.push(text));
    assert.equal(copied[0], summary);
  }
});

test("first-line extension cannot introduce nested fields, duplicate escaped keys, secrets or extra lines", () => {
  for (const errorFirstLine of ["x\ny", "x\ry", "x".repeat(321), "token=secret", "Authorization: Bearer secret", "/Users/private/auth.json", "https://private.example/?token=secret", "private@example.com", { message: "nested" }, "\u001b[31mError"]) {
    assert.equal(parseRuntimeFailure(envelope({ errorFirstLine }), "codex"), null);
  }
  const escapedDuplicate = RUNTIME_FAILURE_MARKER + JSON.stringify(sample({ errorFirstLine: "safe" })).replace('{', '{"errorFirstL\\u0069ne":"duplicate",');
  assert.equal(parseRuntimeFailure(escapedDuplicate, "codex"), null);
  assert.equal(parseRuntimeFailure(envelope({ errorFirstLine: "token=*** [path] [url] [account]" }), "codex").errorFirstLine, "token=*** [path] [url] [account]");
});

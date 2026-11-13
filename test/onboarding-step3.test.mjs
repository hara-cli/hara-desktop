import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/OnboardingColleaguesStep.tsx"; export * from "./src/onboarding-team.ts"; export * from "./src/workspace-create-batch.ts"; export { ONBOARDING_STEP_VIEWS } from "./src/onboarding-steps.ts";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl", ".webp": "dataurl", ".png": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const M = module.exports;
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../src/OnboardingColleaguesStep.tsx", import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const LOCALES = ["zh-Hans", "en", "zh-Hant"];
function withStorage(store, locale, run) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : store[key] ?? null, setItem: (key, value) => { store[key] = value; } } });
  try { return run(); } finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const RUN = "11111111-1111-4111-8111-111111111111";
const workspace = (agents = []) => ({ workspaceId: "A", resourceGeneration: "g", agentRevision: 4, agents, connections: { connections: [{ id: "c", status: "ready" }] },
  runtimes: { options: [{ runtimeId: "codex", label: "Codex", installed: true, registered: true, state: "registered", generalAgentDriverAvailable: true, use: "ready" }] } });
const progress = (patch = {}) => ({ schemaVersion: 1, revision: 1, readOnly: false, recovered: false, runId: RUN, step: 3, engineChoice: "codex", thirdPartySkipped: false, dismissed: false, completedAt: null, ...patch });
const sheet = { step: 3, readOnly: false, busy: false, notice: "", onLater() {}, onBack() {} };
const render = (props, locale, store = {}) => withStorage(store, locale, () => renderToStaticMarkup(createElement(M.OnboardingColleaguesStep, { progress: progress(), sheet, next() {}, workspace: workspace(),
  model: { supportsCreateBatch: () => true }, ...props })));
const stored = (draft) => ({ [M.TEAM_DRAFT_KEY]: JSON.stringify({ A: draft }) });

test("step 3 is registered, but the guide's entry stays off until Jeff has seen it", () => {
  assert.equal(M.ONBOARDING_STEP_VIEWS[3], M.OnboardingColleaguesStep);
  assert.match(readFileSync(new URL("../src/workspace-onboarding-state.ts", import.meta.url), "utf8"), /export const ONBOARDING_STEPS_READY = false;/);
});

test("local rules: chosen helps first, padded to three, capped at five; «Just one» drafts one; «Add one more» stops at eight", () => {
  assert.deepEqual(M.suggestTeam({ focus: null, custom: "", helps: [], size: "team" }), []);
  assert.deepEqual(M.suggestTeam({ focus: "software", custom: "", helps: ["review"], size: "team" }), ["code-reviewer", "frontend-developer", "backend-architect"]);
  assert.deepEqual(M.suggestTeam({ focus: "software", custom: "", helps: ["security", "tests", "deploy", "review", "api", "ui"], size: "team" }).length, 5);
  assert.deepEqual(M.suggestTeam({ focus: "operations", custom: "", helps: ["hiring"], size: "one" }), ["recruitment-specialist"]);
  assert.deepEqual(M.suggestTeam({ focus: "sales", custom: "", helps: [], size: "one" }), ["sales-pipeline"]);
  const taken = []; for (let next; (next = M.nextSuggestion("content", taken)); ) taken.push(next);
  assert.equal(taken.length, M.TEAM_LIMIT); assert.equal(new Set(taken).size, 8); assert.equal(M.TEAM_LIMIT, 8);
  assert.deepEqual(taken.slice(0, 4), ["content-creator", "china-growth-strategist", "analytics-reporter", "support-responder"]);
});

for (const locale of LOCALES) test(`every suggested colleague has a curated blueprint and a valid C0 duty profile from the shared module (${locale})`, () => {
  assert.ok(M.TEAM_POOL.length >= 20);
  for (const username of M.TEAM_POOL) {
    assert.ok(M.teamBlueprint(username), username);
    const duty = M.teamDuty(username, locale);
    assert.deepEqual(Object.keys(duty).sort(), ["description", "owns", "rejects", "title"]);
    assert.ok(duty.owns.length >= 2 && duty.rejects.length >= 2, username);
    if (locale !== "en") for (const line of [...duty.owns, ...duty.rejects]) assert.doesNotMatch(line, /[一-鿿]\s+[一-鿿]/, `${username}: ${line}`);
  }
});

test("Traditional Chinese duties are not Simplified copies", () => {
  const changed = M.TEAM_POOL.filter(username => M.teamDuty(username, "zh-Hant").rejects.join() !== M.teamDuty(username, "zh-Hans").rejects.join());
  assert.ok(changed.length >= M.TEAM_POOL.length - 2, changed.length);
});

for (const locale of LOCALES) test(`G2 rows: «follow» omits runtimeId so Core uses the workspace default; done, unchecked and existing rows are not sent; duties are labelled drafts (${locale})`, () => {
  const draft = { runId: RUN, phase: "draft", answers: M.EMPTY_ANSWERS, results: { "code-reviewer": { status: "created", agentId: "x" }, "ui-designer": { status: "failed", reason: "runtime_unavailable" } },
    rows: [M.teamRow("frontend-developer"), { ...M.teamRow("backend-architect"), engine: "codex" }, M.teamRow("code-reviewer"), { ...M.teamRow("product-manager"), checked: false }, M.teamRow("ux-researcher"), M.teamRow("ui-designer")] };
  const rows = M.batchRows(draft, locale, new Set(["ux-researcher"]));
  assert.deepEqual(rows.map(row => row.draftKey), ["frontend-developer", "backend-architect", "ui-designer"]);
  assert.equal("runtimeId" in rows[0], false); assert.equal(rows[1].runtimeId, "codex");
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).filter(key => !["draftKey", "username", "profile", "description", "instructions", "runtimeId"].includes(key)), [], "no fields outside the G2 contract");
    assert.equal(row.username, row.draftKey); assert.match(row.draftKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    assert.equal(row.profile.version, 1); assert.equal(row.profile.source, "hara");
    const label = M.DUTY_SECTION[locale], duty = M.teamDuty(row.username, locale);
    assert.ok(row.instructions.includes(label.head) && row.instructions.includes(label.note), "labelled as a draft that grants nothing");
    for (const item of [...duty.owns, ...duty.rejects]) assert.ok(row.instructions.includes(item), item);
    assert.doesNotMatch(row.instructions.slice(row.instructions.indexOf(label.head)), /approved|grant:|permissionTier|allowTools/i, "the duty section asks for nothing");
  }
  assert.equal(M.DUTY_SECTION["zh-Hans"].head, "职责（草案，职责卡上线后再确认）");
  assert.equal(M.DUTY_SECTION["zh-Hant"].head, "職責（草案，職責卡上線後再確認）");
  for (const value of Object.values(M.DUTY_SECTION)) assert.doesNotMatch(JSON.stringify(value), /\bC\d+\b/, "no internal code names for users or models (review of #97, M2)");
});

test("createBatch replies are checked against the rows sent; anything unexpected throws", () => {
  const rows = [{ draftKey: "a" }, { draftKey: "b" }, { draftKey: "c" }];
  const ok = { runId: RUN, revision: 7, results: [{ index: 0, draftKey: "a", status: "created", agent: { agentId: "1" } }, { index: 1, draftKey: "b", status: "exists", agent: { agentId: "2" } }, { index: 2, draftKey: "c", status: "failed", reason: "runtime_unconfirmed" }] };
  assert.deepEqual(M.createBatchView(ok, RUN, rows), { runId: RUN, revision: 7, results: [{ index: 0, draftKey: "a", status: "created", agentId: "1" }, { index: 1, draftKey: "b", status: "exists", agentId: "2" }, { index: 2, draftKey: "c", status: "failed", reason: "runtime_unconfirmed" }] });
  for (const bad of [{ ...ok, runId: "other" }, { ...ok, revision: 1.5 }, { ...ok, results: ok.results.slice(1) }, { ...ok, results: [{ ...ok.results[0], draftKey: "z" }, ...ok.results.slice(1)] },
    { ...ok, results: [{ ...ok.results[0], index: 1 }, ...ok.results.slice(1)] }, { ...ok, results: [...ok.results.slice(0, 2), { ...ok.results[2], reason: "approved" }] },
    { ...ok, results: [{ ...ok.results[0], agent: null }, ...ok.results.slice(1)] }]) assert.throws(() => M.createBatchView(bad, RUN, rows));
});

function modelFixture(capabilities, reply) {
  const calls = [];
  const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, agentRevision: 4, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main", agents: [], approvals: [],
    connections: { revision: 0, defaultConnectionId: null, connections: [] }, conversation: { history: [], state: "idle" } });
  const model = new WorkspaceDevModel({ supportsCapability: name => capabilities.includes(name), async request(method, params) {
    calls.push({ method, params });
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
    if (method === "workspace.agents.createBatch") return reply(params);
    return snapshot(params.workspaceId);
  } }, () => "request", false, "workspace");
  return { model, calls };
}

test("createColleagues sends exactly one workspace-scoped createBatch with the contract fields; old Cores, stale scopes and >8 rows send nothing", async () => {
  const rows = [{ draftKey: "a", username: "a", profile: { version: 1, displayName: "A", source: "hara" }, instructions: "x" }];
  const f = modelFixture(["workspace.agents.create-batch.v1"], params => ({ runId: params.runId, revision: params.expectedCatalogRevision + 1, results: [{ index: 0, draftKey: "a", status: "created", agent: { agentId: "n" } }] }));
  await f.model.selectWorkspace("A");
  assert.equal(f.model.supportsCreateBatch(), true);
  const view = await f.model.createColleagues(RUN, rows, 4, "A", "generation-A");
  assert.equal(view.revision, 5);
  assert.deepEqual(f.calls.filter(call => call.method === "workspace.agents.createBatch"), [{ method: "workspace.agents.createBatch", params: { expectedCatalogRevision: 4, runId: RUN, rows, workspaceId: "A", expectedGeneration: "generation-A" } }]);
  await assert.rejects(() => f.model.createColleagues(RUN, rows, 4, "B", "generation-B"));
  await assert.rejects(() => f.model.createColleagues(RUN, Array.from({ length: 9 }, (_, i) => ({ ...rows[0], draftKey: `k${i}` })), 4, "A", "generation-A"));
  await assert.rejects(() => f.model.createColleagues(RUN, [], 4, "A", "generation-A"));
  assert.equal(f.calls.filter(call => call.method === "workspace.agents.createBatch").length, 1);
  const old = modelFixture([], () => { throw new Error("must not be called"); }); await old.model.selectWorkspace("A");
  assert.equal(old.model.supportsCreateBatch(), false);
  await assert.rejects(() => old.model.createColleagues(RUN, rows, 4, "A", "generation-A"));
  assert.equal(old.calls.some(call => call.method === "workspace.agents.createBatch"), false);
});

for (const locale of LOCALES) test(`three questions, local note, «Go to the workspace» and «Draft my team» (${locale})`, () => {
  const t = makeT(locale), html = render({}, locale);
  for (const key of ["ws.onboarding.team.title", "ws.onboarding.team.sub", "ws.onboarding.team.local", "ws.onboarding.team.q1", "ws.onboarding.team.q3", "ws.onboarding.team.size.one", "ws.onboarding.team.size.team", "ws.onboarding.team.enter", "ws.onboarding.team.makeDraft"])
    assert.ok(html.includes(esc(t(key))), key);
  for (const focus of M.TEAM_FOCUSES) assert.ok(html.includes(esc(t(`ws.onboarding.team.focus.${focus}`))), focus);
  assert.match(html, /<button type="button" class="hs-btn pri" disabled="">/, "no draft before the first answer");
  const asked = render({}, locale, stored({ runId: RUN, phase: "ask", answers: { focus: "software", custom: "", helps: ["ui"], size: "team" }, rows: [], results: {} }));
  for (const help of M.TEAM_HELPS.software) assert.ok(asked.includes(esc(t(`ws.onboarding.team.help.${help.id}`))), help.id);
  assert.ok(asked.includes(esc(t("ws.onboarding.team.q2"))));
});

for (const locale of LOCALES) test(`draft cards show Owns / Not, an engine each, and «Create N colleagues»; a name already here cannot be picked (${locale})`, () => {
  const t = makeT(locale);
  const draft = { runId: RUN, phase: "draft", answers: { focus: "software", custom: "", helps: [], size: "team" }, results: {}, rows: ["frontend-developer", "backend-architect", "code-reviewer"].map(M.teamRow) };
  const html = render({ workspace: workspace([{ agentId: "x", username: "code-reviewer", kind: "colleague", state: "active", identity: { displayName: "Iris" }, runtime: { id: "codex", label: "Codex", available: true } }]) }, locale, stored(draft));
  for (const username of draft.rows.map(row => row.username)) { const duty = M.teamDuty(username, locale); assert.ok(html.includes(esc(duty.owns.join(" · "))) && html.includes(esc(duty.rejects.join(" · "))), username); }
  assert.ok(html.includes(esc(t("ws.onboarding.team.create", { n: 2 }))), "the existing one is not counted");
  assert.ok(html.includes(esc(t("ws.onboarding.team.willCreate", { n: 2, engine: t("ws.onboarding.team.follow", { name: "Codex" }) }))));
  assert.match(html, new RegExp(`data-draft="code-reviewer"[\\s\\S]*?data-result="exists"`));
  assert.ok(html.includes(esc(t("ws.onboarding.team.dutyNote"))) && html.includes(esc(t("ws.onboarding.team.addOne"))));
  assert.equal((html.match(/<select/g) ?? []).length, 2, "an engine picker for each colleague still to create");
});

test("«Just one» reads «Create 1 colleague»; skipping step 1 or an old Core keeps the draft but cannot create, and says why", () => {
  const t = makeT("en"), draft = { runId: RUN, phase: "draft", answers: { focus: "sales", custom: "", helps: [], size: "one" }, results: {}, rows: [M.teamRow("sales-pipeline")] };
  assert.ok(render({}, "en", stored(draft)).includes(esc(t("ws.onboarding.team.createOne"))));
  const skipped = render({ progress: progress({ engineChoice: null }) }, "en", stored(draft));
  assert.ok(skipped.includes(esc(t("ws.onboarding.team.noEngine")))); assert.match(skipped, /class="hs-btn pri" disabled=""/);
  const old = render({ model: {} }, "en", stored(draft));
  assert.ok(old.includes(esc(t("ws.onboarding.team.unsupported")))); assert.match(old, /class="hs-btn pri" disabled=""/);
});

for (const locale of LOCALES) test(`results: created / already here / not created with the reason; Retry only for failures (${locale})`, () => {
  const t = makeT(locale);
  const draft = { runId: RUN, phase: "result", answers: { focus: "software", custom: "", helps: [], size: "team" }, rows: ["frontend-developer", "backend-architect", "code-reviewer", "test-automation"].map(M.teamRow),
    results: { "frontend-developer": { status: "created", agentId: "1" }, "backend-architect": { status: "exists", agentId: "2" }, "code-reviewer": { status: "created", agentId: "3" }, "test-automation": { status: "failed", reason: "runtime_unconfirmed" } } };
  const html = render({}, locale, stored(draft));
  assert.ok(html.includes(esc(M.resultSummary(t, 3, 0, 1))), "Core «exists» is this run's earlier commit, so it counts as created");
  assert.ok(html.includes(esc(t("ws.onboarding.team.summaryRetry").trim())));
  assert.ok(html.includes(esc(t("ws.onboarding.team.reason.runtime_unconfirmed"))) && html.includes(esc(t("ws.onboarding.team.retry"))));
  assert.equal((html.match(/data-result="failed"/g) ?? []).length, 1);
  const allDone = render({}, locale, stored({ ...draft, results: { ...draft.results, "test-automation": { status: "created", agentId: "4" } } }));
  assert.ok(allDone.includes(esc(t("ws.onboarding.team.resultAll", { n: 4 })))); assert.ok(!allDone.includes(esc(t("ws.onboarding.team.retry"))));
  // A name another colleague already uses is «already here», never «created» (review of #97, M1).
  const taken = render({}, locale, stored({ ...draft, results: { ...draft.results, "code-reviewer": { status: "taken" }, "test-automation": { status: "created", agentId: "4" } } }));
  assert.ok(taken.includes(esc(M.resultSummary(t, 3, 1, 0))) && !taken.includes(esc(t("ws.onboarding.team.resultAll", { n: 4 }))));
  assert.match(taken, /data-draft="code-reviewer"[\s\S]*?data-result="exists"/);
  assert.equal((taken.match(/data-result="created"/g) ?? []).length, 3);
});

test("result summaries count created, already here and not created apart, in every language", () => {
  const expect = {
    en: ["2 created, 1 already here.", "1 already here, 1 not created. Created colleagues won't be created again; Retry only handles the ones that failed.", "All 3 colleagues are ready.", "Your colleague is ready."],
    "zh-Hans": ["建好了 2 位，1 位已存在。", "1 位已存在，1 位没建成。已建好的不会重复建，重试只会处理没建成的。", "3 位同事都建好了。", "同事建好了。"],
    "zh-Hant": ["建好了 2 位，1 位已存在。", "1 位已存在，1 位沒建成。已建好的不會重複建立，重試只會處理沒建成的。", "3 位同事都建好了。", "同事建好了。"] };
  for (const locale of LOCALES) { const t = makeT(locale);
    assert.deepEqual([M.resultSummary(t, 2, 1, 0), M.resultSummary(t, 0, 1, 1), M.resultSummary(t, 3, 0, 0), M.resultSummary(t, 1, 0, 0)], expect[locale], locale); }
});

test("the draft is kept per workspace and run; another run starts from the questions", () => {
  const store = {}, draft = { runId: RUN, phase: "draft", answers: M.EMPTY_ANSWERS, rows: [M.teamRow("chief-of-staff")], results: {} };
  withStorage(store, "en", () => {
    M.saveTeamDraft("A", draft);
    assert.deepEqual(M.loadTeamDraft("A", RUN), draft);
    assert.equal(M.loadTeamDraft("A", "22222222-2222-4222-8222-222222222222"), null);
    assert.equal(M.loadTeamDraft("B", RUN), null);
    store[M.TEAM_DRAFT_KEY] = JSON.stringify({ A: { ...draft, rows: [{ ...M.teamRow("chief-of-staff"), username: "not-in-library" }] } });
    assert.equal(M.loadTeamDraft("A", RUN), null, "a tampered draft is ignored");
    // Older or hand-edited values start over instead of breaking the questions (review of #97, L3).
    for (const bad of [{ answers: { ...M.EMPTY_ANSWERS, focus: "astrology" } }, { answers: { ...M.EMPTY_ANSWERS, size: "many" } }, { answers: { focus: "sales", custom: "", helps: ["ui"], size: "team" } },
      { results: { "chief-of-staff": { status: "maybe" } } }, { results: { "someone-else": { status: "created" } } }, { results: [] }, { sent: "yes" },
      { rows: [M.teamRow("chief-of-staff"), M.teamRow("chief-of-staff")] }, { rows: [{ ...M.teamRow("chief-of-staff"), draftKey: "other" }] }]) {
      store[M.TEAM_DRAFT_KEY] = JSON.stringify({ A: { ...draft, ...bad } });
      assert.equal(M.loadTeamDraft("A", RUN), null, JSON.stringify(bad));
    }
    store[M.TEAM_DRAFT_KEY] = JSON.stringify({ A: { ...draft, sent: true, results: { "chief-of-staff": { status: "taken" } } }, B: draft });
    assert.ok(M.loadTeamDraft("A", RUN));
    M.clearTeamDraft("A");
    assert.equal(M.loadTeamDraft("A", RUN), null); assert.ok(M.loadTeamDraft("B", RUN), "only this workspace's draft is cleared");
  });
});

test("the step creates only through createBatch with the run's G4 runId, and finishing records completion", () => {
  assert.match(source, /model\.createColleagues\(progress\.runId, rows, expected, wsId, workspace\.resourceGeneration\)/);
  assert.doesNotMatch(source, /agents\.create\b|agent_create|duty\.update|saveDefaultRuntime|proposeExtensions/);
  assert.match(source, /const finish = \(\) => \{ clearTeamDraft\(wsId\); next\(\{ completedAt: new Date\(\)\.toISOString\(\) \}\); \};/);
  assert.match(source, /row\.reason === "username_taken" \? \{ status: "taken" \}/);
});

test("finishing from inside the open sheet closes it: completion wins over the open flag", () => {
  const hook = readFileSync(new URL("../src/WorkspaceOnboarding.tsx", import.meta.url), "utf8");
  assert.match(hook, /const finished = onboardingSurface\(progress, \{ seen: true, colleagues: 0 \}\) === "none";/);
  assert.match(hook, /const surface = !hasView \|\| hidden \|\| finished \? "none" : open \? "sheet"/);
});

for (const locale of LOCALES) test(`once a request has gone out, answers and rows are locked so no committed key drops out of the results (review of #97, L4) (${locale})`, () => {
  const t = makeT(locale), draft = { runId: RUN, phase: "draft", sent: true, answers: { focus: "software", custom: "", helps: [], size: "team" }, results: {}, rows: ["frontend-developer", "backend-architect"].map(M.teamRow) };
  const html = render({}, locale, stored(draft));
  assert.match(html, new RegExp(`<button type="button" disabled="">${esc(t("ws.onboarding.team.backToQuestions"))}</button>`));
  assert.ok(!html.includes(`>${esc(t("ws.onboarding.team.remove"))}</button>`));
  const fresh = render({}, locale, stored({ ...draft, sent: undefined }));
  assert.match(fresh, new RegExp(`<button type="button">${esc(t("ws.onboarding.team.backToQuestions"))}</button>`));
  assert.match(source, /setDraft\(current => \(\{ \.\.\.current, sent: true \}\)\);\n    setCreating\(true\)/);
  assert.equal(t("ws.onboarding.team.reason.invalid_request"), { en: "Hara couldn't create this one.", "zh-Hans": "这一位没能建立。", "zh-Hant": "這一位沒能建立。" }[locale], "no «Remove» promised where there is none (L1)");
});

test("the step no longer asks for free text the local rules cannot use (review of #97, L2)", () => {
  assert.doesNotMatch(source, /wob-custom|ws\.onboarding\.team\.custom/);
});

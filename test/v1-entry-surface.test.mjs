import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
const root = new URL("../", import.meta.url).pathname;
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const oldSurfaces = "群组 agents projects external deliverables WorkspaceCollaboration MailboxSettings DeskUsersPanel DeskMailComposer 组织工作台";

// The real entry and rollback router execute with real React Suspense. Only leaf screens are
// replaced by sentinels, so tests can observe module evaluation without touching native services.
async function entryBundle(dev) {
  const bundle = await build({ stdin: { contents: 'export { WorkspaceEntryView } from "./src/WorkspaceEntry.tsx"; export { loads } from "fixture:loads";', resolveDir: root, loader: "tsx" },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react", "react-dom", "react-dom/server"],
    define: { "import.meta.env.DEV": String(dev) }, write: false, plugins: [{ name: "local-entry-sentinels", setup(builder) {
      builder.onResolve({ filter: /^fixture:loads$/ }, () => ({ path: "loads", namespace: "fixture" }));
      builder.onLoad({ filter: /^loads$/, namespace: "fixture" }, () => ({ contents: "export const loads = [];", loader: "js" }));
      builder.onResolve({ filter: /^\.\/(?:App|WorkspaceLocalDev|ProviderSettingsPreview|WorkStarter|MailboxSettingsPreview|ConversationPreview|TalentMarket|AutomationPreview)$/ }, args => ({ path: args.path.slice(2), namespace: "leaf" }));
      builder.onLoad({ filter: /.*/, namespace: "leaf" }, args => ({ contents: `import {createElement} from "react"; import {loads} from "fixture:loads";
        loads.push(${JSON.stringify(args.path)}); function Screen(props) { return createElement("section", {"data-screen": ${JSON.stringify(args.path)}, "data-mode": props.mode}, ${JSON.stringify(args.path === "App" ? oldSurfaces : args.path)}); }
        export default Screen; export {Screen as ProviderSettingsPreview, Screen as WorkStarter, Screen as MailboxSettingsPreview};`, loader: "js" }));
    } }] });
  return bundle.outputFiles[0].text;
}
const productionEntry = await entryBundle(false), devEntry = await entryBundle(true);
async function renderEntry(mode, { dev = false, query = "", failed = false } = {}) {
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", dev ? devEntry : productionEntry)(require, module, module.exports, { location: { search: query }, localStorage: { getItem: () => "legacy" } });
  const { createElement } = require("react"), { renderToPipeableStream } = require("react-dom/server");
  const html = await new Promise((resolve, reject) => {
    const target = new PassThrough(); let html = "";
    target.on("data", chunk => { html += chunk; }); target.on("end", () => resolve(html)); target.on("error", reject);
    const stream = renderToPipeableStream(createElement(module.exports.WorkspaceEntryView, { mode, failed }), { onAllReady() { stream.pipe(target); }, onError: reject });
  });
  return { html, loads: module.exports.loads };
}

test("v1 root has no URL/DEV preview bypass or eager legacy module entry", () => {
  const main = read("src/main.tsx"), entry = read("src/WorkspaceEntry.tsx");
  assert.match(main, /<WorkspaceEntry\s*\/>/); assert.doesNotMatch(main, /URLSearchParams|window\.location|Preview|from "\.\/(?:App|WorkStarter)"/);
  assert.match(entry, /invoke<string>\("workspace_entry_mode"\)/); assert.doesNotMatch(entry, /location\.|localStorage|import\.meta\.env/);
  assert.match(entry, /mode === "legacy" \? <Legacy \/> : <Workspace mode=\{mode\} \/>/);
});
test("workspace and Lab never evaluate rollback leaves even with hostile preview/storage hints", async () => {
  for (const dev of [false, true]) for (const mode of ["workspace", "lab"]) for (const preview of ["mailbox", "workbench", "conversation", "providers", "automation", "talent", "channels", "groups"]) {
    const result = await renderEntry(mode, { dev, query: `?preview=${preview}&legacy=1&HARA_DESKTOP_LEGACY_ENTRY=1` });
    assert.deepEqual(result.loads, ["WorkspaceLocalDev"]); assert.match(result.html, new RegExp(`data-mode="${mode}"`));
    assert.doesNotMatch(result.html, /MailboxSettings|DeskUsersPanel|DeskMailComposer|WorkspaceCollaboration|群组|组织工作台|deliverables/);
  }
});
test("unresolved or failed native entry decision cannot load either screen as a fallback", async () => {
  for (const failed of [false, true]) {
    const result = await renderEntry(null, { failed, dev: true, query: "?preview=mailbox&legacy=1" });
    assert.deepEqual(result.loads, []); assert.match(result.html, failed ? /Could not verify the workspace entry/ : /Opening your workspace/);
  }
});
test("explicit native rollback retains the old app including its legacy feature surface", async () => {
  const result = await renderEntry("legacy", { query: "?preview=mailbox" });
  assert.deepEqual(result.loads, ["App"]); assert.match(result.html, /群组 agents projects external deliverables/);
  assert.match(result.html, /WorkspaceCollaboration MailboxSettings DeskUsersPanel DeskMailComposer 组织工作台/);
  assert.doesNotMatch(result.html, /data-screen="WorkspaceLocalDev"/);
});
test("old development previews remain usable only inside native-selected rollback", async () => {
  const previews = { mailbox: "MailboxSettingsPreview", workbench: "WorkStarter", conversation: "ConversationPreview", providers: "ProviderSettingsPreview", automation: "AutomationPreview", talent: "TalentMarket" };
  for (const [preview, name] of Object.entries(previews)) {
    const result = await renderEntry("legacy", { dev: true, query: `?preview=${preview}` }); assert.deepEqual(result.loads, [name]);
    assert.match(result.html, new RegExp(`data-screen="${name}"`));
  }
});

const screenBundle = await build({ stdin: { contents: 'import React from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {WorkspaceScreen} from "./src/WorkspaceLocalDev.tsx"; export const render = props => renderToStaticMarkup(React.createElement(WorkspaceScreen, props));', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react", "react-dom/server"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const screenModule = { exports: {} };
new Function("require", "module", "exports", screenBundle.outputFiles[0].text)(require, screenModule, screenModule.exports);
const agents = [ { agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } },
  { agentId: "coder", kind: "colleague", state: "active", identity: { displayName: "Coder", title: "Coding colleague" }, runtime: { id: "pi", label: "Pi", available: true } } ];
const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
function view({ empty = false, state = "completed", approval = false, directory = true } = {}) {
  return { directory: directory ? { revision: 1, activeWorkspaceId: "A", workspaces: [{ workspaceId: "A", label: "My Workspace", role: "owner", active: true }], syntheticOnly: false, executionMode: "workspace" } : null,
    workspaceId: empty ? null : "A", agentId: empty ? null : "main", roster: empty ? [] : agents, draft: "", loading: false, sending: false, pendingUnknown: false, error: "", syncNotice: "",
    workspace: empty ? null : { workspaceId: "A", resourceGeneration: "generation-A", label: "My Workspace", selectedAgentId: "main", agents, syntheticOnly: false, executionMode: "workspace",
      connections: { revision: 1, defaultConnectionId: "local", connections: [{ id: "local", label: "Local fake", status: "active", defaultModel: "fake" }] },
      approvals: approval ? [{ id: "card", workspaceId: "A", resourceGeneration: "generation-A", agentId: "main", expiresAt: "2099-01-01T00:00:00Z", draft: { username: "reviewer", displayName: "Reviewer", title: "Local reviewer", instructions: "Only this Workspace", runtimeId: "pi" } }] : [],
      conversation: { revision: 1, state, taskState: state === "completed" ? "completed" : "blocked", taskId: "task", runId: "run", sessionId: "S", objective: "Local fixture", pastTaskCount: 1, usage, runUsage: usage,
        completion: state === "completed" ? { state: "verified" } : null, history: [{ role: "assistant", text: "Local fixture reply", tools: ["workspace_verify"] }, { role: "tool", results: [{ id: "receipt", name: "workspace_verify", content: "verified", isError: false }] }] } } };
}
function renderScreen(value, mode = "workspace", locale = "zh-Hant") {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:key=>key==="hara.locale"?locale:null}});
  try { return screenModule.exports.render({ model: { getSnapshot: () => value, subscribe: () => () => {} }, disconnected: "", root: "/private/synthetic", mode, onReconnect() {} }); }
  finally { if(descriptor)Object.defineProperty(globalThis,"localStorage",descriptor);else delete globalThis.localStorage; }
}
test("production keeps lab copy out of the sidebar; explicit Lab is a distinct annotated entry", () => {
  for (const value of [view(), view({ empty: true }), view({ empty: true, directory: false })]) {
    assert.doesNotMatch(renderScreen(value), /WORKSPACE LAB|Workspace Lab/);
    assert.match(renderScreen(value, "lab"), /data-workspace-mode="lab"/);
  }
});
test("real workspace screen retains colleague decisions, collapsed execution and verified task closure", () => {
  const html = renderScreen(view({ state:"blocked", approval: true }));
  for (const marker of [/主 Hara/, /Coder/, /與 Hara 討論新同事/, /確認建立同事/, /讓 Reviewer 加入這個空間/, /<details class="wsd-execution">/, /查看執行詳情/, /設定/, /傳訊息給 Hara/]) assert.ok(marker.test(html),String(marker));
  assert.match(renderScreen(view()), /已核驗結果/);
  assert.doesNotMatch(html, /core\.groups|群组|群組|MailboxSettings|DeskUsersPanel|DeskMailComposer|組織工作台|组织工作台|WorkspaceCollaboration|deliverables|WORKSPACE LAB/);
  assert.match(html,/還沒有頻道/); // Spec v1.3 intentionally keeps the future-channel empty state.
});
test("real workspace screen preserves explicit resume and never opens a legacy surface for blocked tasks", () => {
  const html = renderScreen(view({ state: "blocked" })); assert.match(html, /上次任務尚未完成/); assert.match(html, /繼續原任務/);
  assert.doesNotMatch(html, /群组|MailboxSettings|WorkspaceCollaboration|WORKSPACE LAB/);
});
test("scoped schedules and skills remain reachable through Settings without legacy pages", () => {
  const html = renderScreen(view());assert.match(html,/aria-label="設定"/);
  assert.doesNotMatch(html,/wsd-feature-nav/);
  const source = read("src/WorkspaceLocalDev.tsx");
  assert.ok(/setFeature\("schedules"\)/.test(source)); assert.ok(/setFeature\("skills"\)/.test(source));
  assert.ok(/<WorkspaceFeaturePanel key=\{`\$\{workspace\.workspaceId\}:\$\{workspace\.resourceGeneration\}:\$\{feature\}`\}/.test(source));
  assert.ok(/\{settings \? <ShellDialog/.test(source));
  assert.doesNotMatch(source, /AutomationsPage|CapabilityDirectory|<App\b|workspace\.collaboration/);
});
test("legacy feature code is retained instead of deleting its stored resources or backend contract", () => {
  const app = read("src/App.tsx"), mailbox = read("src/MailboxSettings.tsx");
  for (const marker of [/"core\.groups"/, /hasOrganizationWorkspace/, /<AgentInboxList/, /<WorkspaceCollaboration/, /<MailboxSettings/, /workbenchInboxMode/]) assert.ok(marker.test(app), `legacy component contract retained: ${marker}`);
  for (const marker of [/DeskUsersPanel/, /DeskMailComposer/]) assert.ok(marker.test(mailbox), `legacy mailbox contract retained: ${marker}`);
});
test("actual Vite production graph keeps old App and feature modules outside the v1 startup/Workspace closure", async () => {
  const { build: buildVite } = await import("vite");
  const result = await buildVite({ root, configFile: `${root}/vite.config.ts`, logLevel: "silent", build: { write: false, manifest: true } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
  const asset = outputs.find(value => value.type === "asset" && value.fileName === ".vite/manifest.json"); assert.ok(asset);
  const manifest = JSON.parse(String(asset.source)), seen = new Set();
  const walk = key => { if (seen.has(key)) return; seen.add(key); for (const next of manifest[key].imports ?? []) walk(next); };
  const workspaceKey = Object.keys(manifest).find(key => manifest[key].name === "WorkspaceLocalDev" && manifest[key].isDynamicEntry);
  assert.ok(workspaceKey, "the native Workspace must remain a dynamic entry");
  assert.ok(manifest["index.html"].dynamicImports.includes(workspaceKey));
  walk("index.html"); walk(workspaceKey);
  const forbidden = new Set(["LegacyDesktopEntry", "App", "WorkspaceCollaboration", "MailboxSettings", "DeskUsersPanel", "DeskMailComposer", "AgentInboxList"]);
  for (const key of seen) assert.equal(forbidden.has(manifest[key].name), false, `old surface in v1 static closure: ${key}`);
  assert.ok(manifest["index.html"].dynamicImports.includes("src/LegacyDesktopEntry.tsx"));
  const appKey = Object.keys(manifest).find(key => manifest[key].name === "App" && manifest[key].file.endsWith(".js")); assert.ok(appKey);
  assert.ok(manifest["src/LegacyDesktopEntry.tsx"].dynamicImports.includes(appKey));
  const forbiddenModule = /(?:^|\/)(?:LegacyDesktopEntry|WorkspaceCollaboration|MailboxSettings|DeskUsersPanel|DeskMailComposer|AgentInboxList|App)\.tsx$/;
  const main = outputs.find(value => value.type === "chunk" && value.isEntry);
  assert.deepEqual(Object.keys(main.modules).filter(path => forbiddenModule.test(path)), []);
  assert.equal(Boolean(manifest["src/MailboxSettingsPreview.tsx"]), false);
});

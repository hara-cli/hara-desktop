import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { CODING_EXECUTOR_PREFERENCES, codingSettingsState, createCodingSettingsController } from "../src/coding-executor-state.ts";
import { HaraClient } from "../src/client.ts";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-coding-settings-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import {createElement} from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {CodingExecutorSettingsPanel} from "./src/CodingExecutorSettings.tsx";
    import {makeT} from "./src/i18n.ts";
    export function render(view, locale="en", personal=true) {
      return renderToStaticMarkup(createElement(CodingExecutorSettingsPanel, {
        view, personal, t:makeT(locale), onSelect(){},onSave(){},onReload(){}
      }));
    }
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", write: false,
});
const compiled = join(fixture, "settings.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(compiled);
const settings = (overrides = {}) => ({ version:1,revision:4,executor:"auto",effectiveExecutor:"opencode",recommendedExecutor:"opencode",executorEditable:true,experimental:false,...overrides });
const ready = (overrides = {}) => ({ phase:"ready",settings:settings(),draft:"auto",message:null,needsReload:false,...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
function fakeApi(initial = settings()) {
  let saved = initial;
  const calls = [];
  return { calls, async getCodingSettings(cwd) { calls.push({method:"get",cwd}); return saved; },
    async updateCodingSettings(input,cwd) { calls.push({method:"update",input,cwd});
      saved = settings({revision:input.expectedRevision+1,executor:input.executor,effectiveExecutor:input.executor === "auto" ? "opencode" : input.executor,experimental:input.executor === "pi"});
      return saved;
    } };
}

test("versioned snapshot projects only safe fields and rejects unknown contracts", () => {
  assert.deepEqual(CODING_EXECUTOR_PREFERENCES,["auto","opencode","pi","codex","claude"]);
  assert.deepEqual(codingSettingsState({...settings(),apiKey:"synthetic-private",path:"/private/user"}),settings());
  for (const bad of [null,[],{},settings({version:2}),settings({revision:-1}),settings({revision:1.2}),settings({revision:Number.MAX_SAFE_INTEGER+1}),
    settings({executor:"runtime"}),settings({effectiveExecutor:"auto"}),settings({recommendedExecutor:"pi"}),settings({executorEditable:1}),settings({experimental:"false"})]) {
    assert.equal(codingSettingsState(bad),null);
  }
});

test("a human preference saves exactly one revision-bound request and changes committed state only after ACK", async () => {
  const wait = deferred(); const api = fakeApi();
  api.updateCodingSettings = (input,cwd) => {api.calls.push({method:"update",input,cwd});return wait.promise;};
  const controller = createCodingSettingsController(api,"/fixture");
  await controller.load();
  assert.equal(controller.select("pi"),true);
  const saved = controller.save();
  assert.equal(controller.getSnapshot().phase,"saving");
  assert.equal(controller.getSnapshot().settings.executor,"auto");
  assert.equal(await controller.save(),false);
  assert.equal(controller.select("codex"),false);
  assert.equal(await controller.load(),false);
  assert.deepEqual(api.calls,[{method:"get",cwd:"/fixture"},{method:"update",input:{executor:"pi",expectedRevision:4},cwd:"/fixture"}]);
  wait.resolve(settings({revision:5,executor:"pi",effectiveExecutor:"pi",experimental:true}));
  assert.equal(await saved,true);
  assert.equal(controller.getSnapshot().message,"saved");
  assert.equal(controller.getSnapshot().settings.executor,"pi");
  controller.dispose();
});

test("all five preferences are supported without writing authority or model settings", async () => {
  for (const executor of CODING_EXECUTOR_PREFERENCES) {
    const api = fakeApi(settings({executor:"claude",effectiveExecutor:"claude"}));
    const controller = createCodingSettingsController(api);
    await controller.load();
    controller.select(executor);
    assert.equal(await controller.save(),executor !== "claude");
    assert.equal(api.calls.filter(c=>c.method==="update").length,executor === "claude" ? 0 : 1);
    controller.dispose();
  }
});

test("environment-managed values and invalid choices never produce a write", async () => {
  const api = fakeApi(settings({executorEditable:false}));
  const controller = createCodingSettingsController(api);
  await controller.load();
  assert.equal(controller.select("pi"),false);
  assert.equal(await controller.save(),false);
  assert.equal(api.calls.length,1);
  for (const value of ["runtime","full-auto","",null,{executor:"pi"}]) assert.equal(controller.select(value),false);
  controller.dispose();
});

test("CAS errors or lost ACKs require a fresh read and never trigger an automatic retry", async () => {
  const api = fakeApi();
  api.updateCodingSettings = async (input) => { api.calls.push({method:"update",input}); throw new Error("synthetic-private-server-error"); };
  const controller = createCodingSettingsController(api);
  await controller.load(); controller.select("codex");
  assert.equal(await controller.save(),false);
  assert.equal(controller.getSnapshot().message,"update_failed");
  assert.equal(controller.getSnapshot().needsReload,true);
  assert.equal(controller.select("claude"),false);
  assert.equal(await controller.save(),false);
  assert.equal(api.calls.filter(c=>c.method==="update").length,1);
  assert.doesNotMatch(JSON.stringify(controller.getSnapshot()),/synthetic-private/);
  await controller.load();
  assert.equal(controller.getSnapshot().needsReload,false);
  assert.equal(controller.getSnapshot().draft,"auto");
  controller.dispose();
});

for (const [label,response] of [["stale revision",settings({executor:"pi",effectiveExecutor:"pi"})],
  ["wrong executor",settings({revision:5})],["unknown protocol",settings({version:2,revision:5,executor:"pi"})]]) {
  test(`invalid update ACK (${label}) is not shown as saved`,async () => {
    const api = fakeApi(); api.updateCodingSettings = async () => response;
    const controller = createCodingSettingsController(api);
    await controller.load(); controller.select("pi");
    assert.equal(await controller.save(),false);
    assert.equal(controller.getSnapshot().settings.executor,"auto");
    assert.equal(controller.getSnapshot().needsReload,true);
    controller.dispose();
  });
}

test("old load and save responses cannot modify a disposed client/Space scope", async () => {
  const pendingLoad = deferred();
  const first = createCodingSettingsController({getCodingSettings:()=>pendingLoad.promise,updateCodingSettings:async()=>settings()});
  const loading = first.load(); first.dispose();
  pendingLoad.resolve(settings()); assert.equal(await loading,false);
  assert.equal(first.getSnapshot().settings,null);
  const api = fakeApi(); const pendingSave = deferred(); api.updateCodingSettings = ()=>pendingSave.promise;
  const old = createCodingSettingsController(api); await old.load(); old.select("pi");
  const saving = old.save(); old.dispose();
  const fresh = createCodingSettingsController(fakeApi(settings({revision:9,executor:"codex",effectiveExecutor:"codex"})));
  await fresh.load();
  pendingSave.resolve(settings({revision:5,executor:"pi",effectiveExecutor:"pi"}));
  assert.equal(await saving,false);
  assert.equal(fresh.getSnapshot().settings.executor,"codex");
  fresh.dispose();
});

test("strict lifecycle reactivation invalidates earlier promises and allows a clean read", async () => {
  const wait = deferred(); const api = fakeApi();
  const original = api.getCodingSettings; let count=0;
  api.getCodingSettings = () => ++count===1 ? wait.promise : original();
  const controller = createCodingSettingsController(api);
  const first = controller.load(); controller.dispose(); controller.activate();
  assert.equal(await controller.load(),true);
  wait.resolve(settings({revision:99,executor:"pi",effectiveExecutor:"pi"}));
  assert.equal(await first,false);
  assert.equal(controller.getSnapshot().settings.revision,4);
  controller.dispose();
});

test("unsupported and invalid reads are closed, with no write and only fixed error messages",async () => {
  for (const response of [null,settings({version:999})]) {
    const api = fakeApi(); api.getCodingSettings = async()=>response;
    const controller = createCodingSettingsController(api);
    assert.equal(await controller.load(),false);
    assert.equal(controller.getSnapshot().phase,response === null ? "unsupported" : "error");
    assert.equal(controller.select("pi"),false);
    assert.equal(await controller.save(),false);
    assert.equal(api.calls.length,0);
    controller.dispose();
  }
});

test("actual panel gives all choices, bounded scope and separate accounts in both locales", () => {
  for (const locale of ["en","zh"]) {
    const html = render(ready(),locale);
    assert.equal((html.match(/<option /g)??[]).length,5);
    assert.equal((html.match(/selected=""/g)??[]).length,1);
    assert.match(html,/<label for="coding-executor-preference"/);
    assert.match(html,/OpenCode/); assert.match(html,/Pi/); assert.match(html,/Codex/); assert.match(html,/Claude Code/);
    assert.match(html,locale === "zh" ? /不代表执行授权/ : /not permission to run actions/);
    assert.match(html,locale === "zh" ? /不会共享账号、安装工具/ : /does not share accounts, install tools/);
    assert.doesNotMatch(html,/type="password"|apiKey|commandId|runtimeGrants/);
  }
  assert.match(render(ready({draft:"pi"})),/not a benchmark winner/);
});

test("actual panel is inert for managed/unsupported/Company states and failed ACKs cannot look saved", () => {
  assert.match(render(ready({settings:settings({executorEditable:false})})),/<select[^>]*disabled=""/);
  assert.match(render(ready({phase:"saving",draft:"pi"})),/<select[^>]*disabled=""/);
  const failed = render(ready({draft:"pi",message:"update_failed",needsReload:true}));
  assert.match(failed,/<select[^>]*disabled=""/);
  assert.doesNotMatch(failed,/Preference saved/);
  assert.match(failed,/Read the latest preference before saving again/);
  for (const html of [render(ready({phase:"unsupported",settings:null})),render(ready(),"en",false)]) {
    assert.doesNotMatch(html,/<select|<option|Save preference/);
  }
  assert.doesNotMatch(render(ready({settings:settings({executor:"pi",effectiveExecutor:"pi",experimental:true})}),"en",false),/Pi|existing local sign-ins/);
});

test("App places preference only in system Engine settings and keeps advanced sessions", () => {
  const app = readFileSync(new URL("src/App.tsx",root),"utf8");
  assert.equal((app.match(/<CodingExecutorSettings /g)??[]).length,1);
  assert.match(app,/setSec === "engine"[\s\S]*?<CodingExecutorSettings[\s\S]*?personal=\{activeSpaceId === "personal"\}/);
  assert.match(app,/client=\{phase === "ready" \? clientRef.current : null\}/);
  assert.match(app,/<ExternalSessionCenter/);
  assert.match(app,/key=\{`\$\{activeSpaceId\}:\$\{server\?\.pid \?\? "none"\}:\$\{phase\}`\}/);
});

test("actual client requires complete negotiation and sends only revision-bound preference fields", async (t) => {
  const oldWebSocket = globalThis.WebSocket; const oldWindow = globalThis.window;
  const calls=[]; let response=settings(); let rpcError;
  class FakeWebSocket {
    OPEN=1;readyState=1;
    constructor(){queueMicrotask(()=>this.onopen?.());}
    send(raw){const call=JSON.parse(raw);calls.push(call);
      const result=call.method === "initialize" ? {name:"hara",version:"test",protocol:1,cwd:"/fixture",provider:"fixture",model:"fixture",
        capabilities:{methods:["settings.coding.get","settings.coding.update"],events:[],features:["coding.settings.v1"]}} : response;
      queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({jsonrpc:"2.0",id:call.id,...(rpcError && call.method !== "initialize" ? {error:rpcError} : {result})})}));}
    close(){this.readyState=3;this.onclose?.();}
  }
  globalThis.WebSocket=FakeWebSocket;globalThis.window={setTimeout,clearTimeout};
  const client=new HaraClient();
  t.after(()=>{client.close();globalThis.WebSocket=oldWebSocket;globalThis.window=oldWindow;});
  await client.connect("127.0.0.1",4242);await client.initialize("fixture-token");
  assert.deepEqual(await client.getCodingSettings("/fixture"),settings());
  response=settings({revision:5,executor:"pi",effectiveExecutor:"pi",experimental:true,apiKey:"synthetic-private"});
  assert.deepEqual(await client.updateCodingSettings({executor:"pi",expectedRevision:4,always:true,apiKey:"synthetic-private"},"/fixture"),codingSettingsState(response));
  assert.deepEqual(calls.at(-1).params,{executor:"pi",expectedRevision:4,cwd:"/fixture"});
  const count=calls.length;
  for (const input of [{executor:"runtime",expectedRevision:4},{executor:"pi",expectedRevision:-1},{executor:"pi",expectedRevision:1.2}]) {
    await assert.rejects(client.updateCodingSettings(input),/invalid_coding_settings_input/);
  }
  assert.equal(calls.length,count);
  response=settings({version:2});await assert.rejects(client.getCodingSettings(),/invalid_coding_settings/);
  rpcError={code:-32601,message:"method missing"};assert.equal(await client.getCodingSettings(),null);
  rpcError={code:-32602,message:"preference changed"};await assert.rejects(client.updateCodingSettings({executor:"pi",expectedRevision:4}),/preference changed/);
});

test("legacy/partial clients do not call either settings method", async () => {
  for (const missing of ["settings.coding.get","settings.coding.update","coding.settings.v1"]) {
    const client = new HaraClient(); let calls=0;
    client.methods = new Set(["settings.coding.get","settings.coding.update"].filter(x=>x!==missing));
    client.features = new Set(["coding.settings.v1"].filter(x=>x!==missing));
    client.call = async()=>{calls++;return settings();};
    assert.equal(await client.getCodingSettings(),null);
    await assert.rejects(client.updateCodingSettings({executor:"pi",expectedRevision:4}),/coding_settings_unsupported/);
    assert.equal(calls,0);
  }
});

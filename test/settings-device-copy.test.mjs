import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeT } from "../src/i18n.ts";
import { settingsDevicePlatform, settingsTranslator } from "../src/settings-device-copy.ts";

for (const [raw,expected] of [["MacIntel","mac"],["MacARM64","mac"],["darwin","mac"],["Win32","windows"],["Windows","windows"],["Linux x86_64","other"],["Android","other"],["Unknown","other"],["","other"]]) test(`device label classification: ${raw || "empty"}`, () => assert.equal(settingsDevicePlatform(raw),expected));
const translated = ["ws.settings.savedHere","ws.settings.detail.overview","ws.settings.detail.appearance","ws.theme.note","ws.updates.archMismatch","ws.runtimeAccess.host","ws.runtimeAccess.hostRecommended","ws.runtimeAccess.hostRecommendedRuntime","ws.runtimeAccess.switchHost","ws.runtimes.check.network","ws.connections.confirmMigrate","ws.connections.deleteNote","ws.connections.importConfirmNote","ws.connections.keyNote","ws.connections.migrationPending","ws.connections.savedKey","ws.connections.keyNoteShort","ws.connections.keyNoteFirst"];
for (const locale of ["en","zh-Hans","zh-Hant"]) for (const platform of ["mac","windows","other"]) test(`Settings copy is backend-neutral and keeps true platform restrictions: ${locale}/${platform}`, () => {
 const raw=makeT(locale),t=settingsTranslator(raw,platform),values={runtime:"Fixture Engine",proxy:"Fixture Proxy",workspace:"Synthetic Workspace",n:2};
 for (const key of translated){const value=t(key,values);assert.notEqual(value,key);assert.doesNotMatch(value,/Keychain|macOS|Mac|钥匙串|鑰匙圈|DPAPI/i,key);}
 assert.equal(t("ws.settings.device"),raw(platform==="mac"?"ws.settings.device":platform==="windows"?"ws.settings.deviceCopy.windows":"ws.settings.deviceCopy.other"));
 if(platform==="windows")assert.match(t("ws.settings.device"),/Windows/);else if(platform==="mac")assert.match(t("ws.settings.device"),/Mac/);else assert.doesNotMatch(t("ws.settings.device"),/Mac|Windows/);
 assert.ok(t("ws.runtimeAccess.hostRecommendedRuntime",values).includes(values.runtime));assert.ok(t("ws.runtimes.check.network",values).includes(values.proxy));
 assert.ok(t("ws.connections.confirmMigrate",values).includes(values.workspace));assert.ok(t("ws.connections.confirmMigrate",values).includes("2"));
 for(const key of ["ws.mcpReview.unsupported_platform","ws.permissions.unavailableHere","ws.connections.saveUnknown","ws.connections.editUnknown"])assert.equal(t(key),raw(key),"a real unsupported-platform/unknown condition must not become a claim of support");
 assert.ok(t("ws.connections.deleteNote").match(/cleanup|清理/));
});

const require=createRequire(import.meta.url),root=fileURLToPath(new URL("../",import.meta.url));
const output=buildSync({stdin:{contents:'export {WorkspaceConnectionForm} from "./src/WorkspaceRuntimeSettings.tsx"; export {WorkspaceConnections} from "./src/WorkspaceSettingsPanels.tsx"; export {WorkspaceSoftwareUpdate} from "./src/WorkspaceSoftwareUpdate.tsx";',resolveDir:root,loader:"tsx"},bundle:true,platform:"node",format:"cjs",jsx:"automatic",external:["react"],loader:{".css":"empty",".svg":"dataurl"},write:false});
const module={exports:{}};new Function("require","module","exports",output.outputFiles[0].text)(require,module,module.exports);
const esc=value=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#x27;");
for(const locale of ["en","zh-Hans","zh-Hant"])test(`actual form default stays unchanged; Settings override and page copy are neutral (${locale})`,()=>{
 const storage=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),nav=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:key=>key==="hara.locale"?locale:null}});Object.defineProperty(globalThis,"navigator",{configurable:true,value:{platform:"Win32"}});
 try{
  const raw=makeT(locale),t=settingsTranslator(raw,"windows"),model={legacyConnections:async()=>[]};
  const props={model,firstKey:true};const original=renderToStaticMarkup(createElement(module.exports.WorkspaceConnectionForm,props));
  assert.ok(original.includes(esc(raw("ws.connections.keyNoteFirst"))),"onboarding's shared-form default copy is intact");
  const settings=renderToStaticMarkup(createElement(module.exports.WorkspaceConnectionForm,{...props,keyNote:t("ws.connections.keyNoteFirst")}));
  assert.ok(settings.includes(esc(t("ws.connections.keyNoteFirst"))));assert.ok(!settings.includes(esc(raw("ws.connections.keyNoteFirst"))));
  const workspace={workspaceId:"A",resourceGeneration:"g",label:"Synthetic",connections:{revision:1,defaultConnectionId:"c1",connections:[{id:"c1",label:"Fixture",status:"active",defaultModel:"m",keySaved:true,keyState:"saved"}]}};
  const panel=renderToStaticMarkup(createElement(module.exports.WorkspaceConnections,{model,workspace}));assert.ok(panel.includes(esc(t("ws.connections.savedKey"))));assert.ok(!panel.includes(esc(raw("ws.connections.keyNote"))));
  const value={phase:"error",version:null,notes:"",downloaded:0,total:0,notice:false,message:"ws.updates.archMismatch",preferences:{channel:"stable",autoCheck:false,lastChecked:null},installing:false};const controller={subscribe:()=>()=>{},getSnapshot:()=>value};
  const update=renderToStaticMarkup(createElement(module.exports.WorkspaceSoftwareUpdate,{controller,info:null}));assert.ok(update.includes(esc(t("ws.updates.archMismatch"))));assert.ok(!update.includes(esc(raw("ws.updates.archMismatch"))));
 }finally{if(storage)Object.defineProperty(globalThis,"localStorage",storage);else delete globalThis.localStorage;if(nav)Object.defineProperty(globalThis,"navigator",nav);else delete globalThis.navigator;}
});

const permission = {
 en: "Your system may ask for permission the first time you save.",
 "zh-Hans": "首次保存时，系统可能请求授权。",
 "zh-Hant": "首次儲存時，系統可能要求授權。",
};
const privacy = {
 en: "Hara does not write saved keys to settings or logs.",
 "zh-Hans": "Hara不会将保存的Key写入设置或日志。",
 "zh-Hant": "Hara不會將儲存的Key寫入設定或日誌。",
};
for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const platform of ["mac", "windows", "other"]) test(`first-save authorization is explained without repeating it on edit or later saves (${locale}/${platform})`, () => {
 const t = settingsTranslator(makeT(locale), platform), sentence = permission[locale];
 assert.ok(t("ws.connections.keyNoteFirst").includes(sentence), "first save keeps the system permission notice");
 assert.ok(t("ws.connections.keyNote").includes(sentence), "Advanced retains the permission explanation");
 assert.ok(!t("ws.connections.keyNoteShort").includes(sentence), "the short note for later saves has no first-save warning");
 const model = {}, existing = { id: "c1", label: "Synthetic", provider: "openai", baseURL: "https://fixture.example.invalid/v1", defaultModel: "model-fixture", credentialRequired: false };
 const first = renderToStaticMarkup(createElement(module.exports.WorkspaceConnectionForm, { model, firstKey: true, keyNote: t("ws.connections.keyNoteFirst") }));
 assert.ok(first.includes(esc(sentence)), "actual Settings form displays the first-save permission notice");
 for (const props of [{ firstKey: false }, { firstKey: true, existing }]) {
  const html = renderToStaticMarkup(createElement(module.exports.WorkspaceConnectionForm, { model, ...props, keyNote: t("ws.connections.keyNoteShort") }));
  assert.ok(!html.includes(esc(sentence)), "edit and non-first-save forms don't repeat the first-save notice");
 }
});
for (const locale of ["en", "zh-Hans", "zh-Hant"]) test(`Settings retains the platform-independent settings/log privacy statement (${locale})`, () => {
 for (const platform of ["mac", "windows", "other"]) assert.ok(settingsTranslator(makeT(locale), platform)("ws.connections.keyNote").includes(privacy[locale]));
});
test("Simplified Chinese saved-record copy uses 保存 rather than 儲存 terminology", () => {
 const t = settingsTranslator(makeT("zh-Hans"), "windows");
 for (const key of ["ws.connections.keyNote", "ws.connections.savedKey"]) { assert.doesNotMatch(t(key), /储存/); assert.match(t(key), /保存/); }
});

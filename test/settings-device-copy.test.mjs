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
 assert.equal(t("ws.settings.device"),raw(platform==="mac"?"ws.settings.deviceCopy.mac":platform==="windows"?"ws.settings.deviceCopy.windows":"ws.settings.deviceCopy.other"));
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

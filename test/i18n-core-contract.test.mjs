import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {WorkspacePublicRpcError,workspaceErrorState,workspaceCoreMessage} from '../src/core-i18n.ts';
import {localizedWorkspaceView} from '../src/workspace-default-labels.ts';
import {localeDescriptor,LOCALE_REGISTRY} from '../src/locales/core-locale.ts';
import {LOCALE_REGISTRY_SHA256} from '../src/locales/registry.generated.ts';
const dir=new URL('../src/locales/',import.meta.url),read=name=>fs.readFileSync(new URL(name,dir),'utf8'),hash=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
test('CI 7/8: every Core code has stable locale keys; all copied resources match provenance and normalized registry hash',()=>{
 const manifest=JSON.parse(read('CORE_I18N_SOURCE.json'));for(const[name,digest]of Object.entries(manifest.files))assert.equal(hash(read(name)),digest,name);
 assert.equal(hash(read('registry.json')),LOCALE_REGISTRY_SHA256);const errors=JSON.parse(read('errors.json')),en=JSON.parse(read('en/errors.json')),zh=JSON.parse(read('zh-Hans/errors.json'));assert.equal(errors.errors.length,102);
 for(const row of errors.errors){assert.equal(typeof en[row.key],'string');assert.equal(typeof zh[row.key],'string');assert.equal(workspaceCoreMessage(row.key,'en'),en[row.key]);}
 assert.deepEqual(LOCALE_REGISTRY.languages.filter(row=>row.status==='stable').map(row=>row.tag),['en','zh-Hans']);assert.deepEqual(localeDescriptor('zh-Hant').fallback,['en']);
});
test('Core i18n provenance names the exact pinned sidecar commit, as the release signer re-syncs it',()=>{
 // build-mac-signed.sh -> refresh-sidecar.sh rewrites CORE_I18N_SOURCE.json from SIDECAR_COMMIT and then
 // requires a clean tree; a stale coreCommit stamp failed the v1.2.0 signer after notarization.
 const manifest=JSON.parse(read('CORE_I18N_SOURCE.json'));
 const pinned=fs.readFileSync(new URL('../src-tauri/binaries/SIDECAR_COMMIT',import.meta.url),'utf8').trim();
 assert.match(pinned,/^[0-9a-f]{40}$/);assert.equal(manifest.coreCommit,pinned);
});
test('known errors localize while unknown/invalid parameter data stays generic with bounded technical detail',()=>{
 for(const tag of ['en','zh-Hans']){const e=new WorkspacePublicRpcError(-32602,{code:'message_invalid',params:{},technicalDetail:'diagnostic'},'old raw message',tag);assert.equal(String(e),'core.error.message_invalid');assert.equal(workspaceErrorState(e).errorTechnicalDetail,'diagnostic');assert(!e.message.includes('raw message'));}
 for(const data of [{code:'future',params:{}},{code:'message_invalid',params:{credential:'secret'}},{code:'message_invalid',params:[]}]){const e=new WorkspacePublicRpcError(-32602,data,'raw technical','en');assert.equal(e.publicCode,'request_failed');assert.equal(String(e),'core.error.request_failed');assert(e.message.startsWith('The operation failed'));}
});
test('default labels follow viewer locale without mutating source/custom names/configuration fields',()=>{
 const agent={agentId:'main',kind:'main',state:'active',titleSource:'default',titleKey:'core.name.orchestrator',identity:{displayName:'Hara',title:'Root Orchestrator'},runtime:{id:'pi',available:true}};
 const view={directory:{workspaces:[{workspaceId:'a',label:'我的空間',labelSource:'default',labelKey:'core.name.workspace'},{workspaceId:'b',label:'Jeff Studio'}]},roster:[agent],workspace:{label:'我的空間',labelSource:'default',labelKey:'core.name.workspace',agents:[agent]}};const original=JSON.stringify(view);
 assert.equal(localizedWorkspaceView(view,'en').workspace.label,'My workspace');const zh=localizedWorkspaceView(view,'zh-Hans');assert.equal(zh.workspace.label,'我的工作空间');assert.equal(zh.workspace.agents[0].identity.title,'总调度');assert.equal(zh.directory.workspaces[1].label,'Jeff Studio');assert.equal(JSON.stringify(view),original);
 const custom=structuredClone(view);delete custom.workspace.agents[0].titleSource;delete custom.workspace.agents[0].titleKey;assert.equal(localizedWorkspaceView(custom,'zh-Hans').workspace.agents[0].identity.title,'Root Orchestrator');
});

test("partial settings snapshots preserve loading behavior before roster arrival",()=>{const view={directory:null,workspace:null};assert.deepEqual(localizedWorkspaceView(view,"en").roster,[]);assert.deepEqual(view,{directory:null,workspace:null});});

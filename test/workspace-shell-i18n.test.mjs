import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { detectLocale, detectLocalePreference, detectLegacyLocale, localeFromLanguages, localeFromSystem, makeT, normalizeLocale, saveLocale } from '../src/i18n.ts';
import { WORKSPACE_KEYS, WORKSPACE_EXTRA_KEYS } from '../src/workspace-i18n.ts';
test('every canonical and additional shell key has all three locales and identical variables',()=>{
  const seen=new Set();
  for(const [key,...values] of [...WORKSPACE_KEYS,...WORKSPACE_EXTRA_KEYS]){
    assert.equal(seen.has(key),false,`Duplicate key ${key}`);seen.add(key);
    const variables=text=>[...text.matchAll(/\{(\w+)\}/g)].map(value=>value[1]).sort();
    for(const [i,locale] of ['en','zh-Hans','zh-Hant'].entries()){
      assert.ok(values[i],`${key} ${locale}`);assert.equal(makeT(locale)(key),values[i]);
      assert.deepEqual(variables(values[i]),variables(values[0]));
    }
  }
  assert.equal(makeT('zh-Hant')('ws.sec.dms'),'私訊');assert.equal(makeT('zh-Hans')('ws.sec.dms'),'私信');
  assert.equal(makeT('en')('ws.quota.count',{n:3,max:10}),'3 / 10 colleagues');
});
test('system language and saved zh migrate without mistaking Traditional Chinese for Simplified',()=>{
  const storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'), navigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try {
    let saved=null;
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>saved}});
    for(const [language,expected] of [['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['zh-Hant-TW','zh-Hant'],['zh-CN','zh-Hans'],['zh-SG','zh-Hans'],['en-GB','en']]){
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});assert.equal(detectLocale(),expected);
    }
    saved='zh';assert.equal(detectLocale(),'zh-Hans');assert.equal(detectLegacyLocale(),'zh');
    saved='zh-Hant';assert.equal(detectLocale(),'zh-Hant');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked');}});
    assert.equal(detectLocale(),'en');assert.equal(normalizeLocale('unknown'),null);
  } finally {
    if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete globalThis.localStorage;
    if(navigator)Object.defineProperty(globalThis,'navigator',navigator);else delete globalThis.navigator;
  }
});
test('the workspace shell contains no hardcoded Chinese JSX text or UI string attributes',()=>{
  for(const file of ['WorkspaceLocalDev.tsx','WorkspaceLocalChannels.tsx','WorkspaceShell.tsx','WorkspaceEntry.tsx']){
    const source=readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),violations=[];
    function visit(node){
      if(ts.isJsxText(node)&&/[\u3400-\u9fff]/u.test(node.text))violations.push(node.text.trim());
      if(ts.isJsxAttribute(node)&&node.initializer&&ts.isStringLiteral(node.initializer)&&/[\u3400-\u9fff]/u.test(node.initializer.text))violations.push(node.initializer.text);
      ts.forEachChild(node,visit);
    }visit(ast); assert.deepEqual(violations,[],file);
    assert.equal(/[⚙↗⌄＋◎⌕↑▶]/u.test(source),false,file);
  }
});
test('language defaults to the first supported system preference and manual choices remain explicit',()=>{
  const before = Object.fromEntries(['localStorage','navigator','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let saved=null;const events=new EventTarget(),changes=[];
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}}});
    Object.defineProperty(globalThis,'window',{configurable:true,value:events});
    events.addEventListener('hara:locale-changed',event=>changes.push(event.detail));
    const system=languages=>Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:languages[0],languages}});
    system(['zh-Hans-CN','en-US']);assert.equal(detectLocalePreference(),'system');assert.equal(detectLocale(),'zh-Hans');assert.equal(saved,null,'reading the default must not pin the system language');
    saveLocale('zh-Hant');system(['en-US']);assert.equal(detectLocalePreference(),'zh-Hant');assert.equal(detectLocale(),'zh-Hant');
    saveLocale('system');assert.equal(detectLocalePreference(),'system');assert.equal(detectLocale(),'en');
    system(['zh-CN']);assert.equal(detectLocale(),'zh-Hans');
    assert.deepEqual(changes,['zh-Hant','system']);
    assert.equal(localeFromLanguages(['fr-FR','zh-TW','en-US']),'zh-Hant');
    assert.equal(localeFromLanguages(['en-CN','zh-Hans-CN']),'en');
    assert.equal(localeFromLanguages(['fr-FR']),'en');
    assert.equal(localeFromSystem('zh-Hans-HK'),'zh-Hans','the explicit script takes precedence over the region');
    assert.equal(localeFromSystem('zh-Hant-CN'),'zh-Hant');assert.equal(localeFromSystem('zh_CN'),'zh-Hans');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null,setItem(){throw new Error('blocked');}}});
    saveLocale('en');assert.equal(changes.at(-1),'en','an explicit choice is broadcast even if storage is unavailable');
  } finally {
    for(const key of ['localStorage','navigator','window']) {if(before[key])Object.defineProperty(globalThis,key,before[key]);else delete globalThis[key];}
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { detectLocale, detectLegacyLocale, makeT, normalizeLocale } from '../src/i18n.ts';
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
  for(const file of ['WorkspaceLocalDev.tsx','WorkspaceShell.tsx','WorkspaceEntry.tsx']){
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

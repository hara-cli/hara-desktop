import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { workspaceBrowserCopy } from "../src/workspace-browser-copy.ts";
const read = file=>readFileSync(new URL(`../${file}`,import.meta.url),"utf8"), require=createRequire(import.meta.url);
const bundled=await build({entryPoints:[new URL("../src/WorkspaceBrowserExtension.tsx",import.meta.url).pathname],bundle:true,format:"cjs",platform:"node",jsx:"automatic",external:["react"],loader:{".css":"empty"},write:false});
const module={exports:{}};new Function("require","module","exports",bundled.outputFiles[0].text)(require,module,module.exports);
const {createElement}=require("react"),{renderToStaticMarkup}=require("react-dom/server");
test("Workspace uses one controlled mode; only explicit maximize hides, without unmounting chat",()=>{
  const source=read("src/WorkspaceLocalDev.tsx"),css=read("src/workspace-settings.css");
  assert.match(source,/useState<ExtensionDockMode>\("docked"\)/);assert.match(source,/mode=\{browserMode\} onModeChange=\{setBrowserMode\}/);
  assert.match(css,/\.wsd-app\.is-browser-maximized>\.wsd-chat\{display:none\}/);
  assert(!/wsd-browser-extension[^}]*position:\s*(?:absolute|fixed)/.test(css));
  assert.match(css,/\.wsd-app\.has-browser\{[^}]*grid-template-columns:/);assert.match(source,/onWidthChange=\{setBrowserWidth\}/);
});
for(const mode of ["docked","maximized"])test(`real browser surface renders ${mode} and keeps sandbox/credentials boundary`,()=>{
  const html=renderToStaticMarkup(createElement(module.exports.default,{label:"Local workspace",copy:workspaceBrowserCopy("zh-Hans"),mode,onModeChange(){},onWidthChange(){},resizeContainerRef:{current:null},onClose(){}}));
  assert(html.includes(`is-${mode}`));assert.match(html,/aria-label="扩展: 浏览器扩展"/);assert.match(html,/aria-pressed="(?:true|false)"/);
  assert.equal(/<iframe/.test(html),false);assert.equal(/type="password"/.test(html),false);assert.match(html,/本机预览/);
});
test("panel copy follows supported English, Simplified and Traditional forms without mixing labels",()=>{
  assert.equal(workspaceBrowserCopy("en-US").title,"Browser extension");assert.equal(workspaceBrowserCopy("zh-CN").title,"浏览器扩展");
  for(const locale of ["zh-Hant","zh-TW","zh-HK"])assert.equal(workspaceBrowserCopy(locale).title,"瀏覽器擴展");
  assert.equal(workspaceBrowserCopy("zh-Hant").open,"開啟");assert.equal(workspaceBrowserCopy("zh-Hans").open,"打开");
  for(const locale of ["en","zh-Hans","zh-Hant"])assert.deepEqual(Object.keys(workspaceBrowserCopy(locale)),Object.keys(workspaceBrowserCopy("en")));
});
test("panel-specific ink/theme overrides and boundary resizer do not change legacy surfaces",()=>{
  const css=read("src/workspace-settings.css"),dock=read("src/ExtensionDock.tsx");
  assert.match(css,/\.wsd-browser-extension \.extension-dock-identity strong\{color:var\(--wsd-ink\)\}/);
  assert.match(css,/\.wsd-browser-extension>\.extension-dock:focus-within:not\(\.is-collapsed\)\{box-shadow:none\}/);
  assert.match(dock,/resizeContainerRef\?\.current \?\? asideRef\.current\?\.parentElement/);
  assert.match(dock,/onWidthChange\?\.\(width\)/);assert.match(dock,/\[width, onWidthChange\]/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const recovery = readFileSync(new URL("../src/RendererRecovery.tsx", import.meta.url), "utf8");
const nativeHost = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

test("renderer watchdog is installed before the module entrypoint", () => {
  const watchdog = index.indexOf("__HARA_RENDERER_STATE__");
  const entrypoint = index.indexOf('type="module"');
  assert.ok(watchdog > 0);
  assert.ok(entrypoint > watchdog);
  assert.match(index, /setTimeout\(recover, 9000\)/);
  assert.match(index, /textContent = zh \?/);
  assert.doesNotMatch(index, /error\.message|error\.stack|reason\.message/);
});

test("React owns a generic recovery boundary and sends a native boot signal", () => {
  assert.match(main, /<RendererErrorBoundary>/);
  assert.match(main, /<RendererBootSignal>/);
  assert.match(recovery, /invoke\("renderer_ready"\)/);
  assert.match(recovery, /componentDidCatch\(\)/);
  assert.doesNotMatch(recovery, /this\.state\.error|error\.stack/);
});

test("Windows bundles conservative WebView2 syntax and a bounded GPU fallback", () => {
  assert.match(vite, /platform === "windows" \? "chrome95" : "safari13"/);
  assert.match(nativeHost, /WINDOWS_RENDERER_BOOT_TIMEOUT[^\n]*from_secs\(10\)/);
  assert.match(nativeHost, /WINDOWS_SOFTWARE_RENDERER_ARGS[\s\S]*--disable-gpu/);
  assert.match(nativeHost, /if !software_renderer \{[\s\S]*schedule_windows_renderer_recovery/);
  assert.match(nativeHost, /RunEvent::ExitRequested \{ api, \.\. \}[\s\S]*fallback_started[\s\S]*api\.prevent_exit\(\)/);
  assert.match(nativeHost, /webview2-software-\{version\}\.flag/);
  assert.doesNotMatch(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    /disable-gpu/,
  );
});

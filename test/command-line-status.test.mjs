import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { managedCliPathCommand } from "../src/command-line-status.ts";

test("managed CLI PATH commands are explicit, quoted, and current-window only", () => {
  assert.equal(managedCliPathCommand("/Users/Jeff/.hara/bin/hara"), 'export PATH=\'/Users/Jeff/.hara/bin\':"$PATH"; hash -r');
  assert.equal(managedCliPathCommand("/Users/Jeff's Mac/.hara/bin/hara"), 'export PATH=\'/Users/Jeff\'\\\'\'s Mac/.hara/bin\':"$PATH"; hash -r');
  assert.equal(managedCliPathCommand("C:\\Users\\Jeff's PC\\.hara\\bin\\hara.exe"), "$env:PATH = 'C:\\Users\\Jeff''s PC\\.hara\\bin;' + $env:PATH");
  for (const path of ["", "hara", "./hara", "~/.hara/bin/hara", "/tmp/bad\nhara", "/tmp/bad\0/hara"]) {
    assert.equal(managedCliPathCommand(path), null);
  }
});

test("CLI diagnostics separate bundled ownership from terminal PATH and never mutate it", () => {
  const source = readFileSync(new URL("../src/CommandLineDiagnostics.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const nativeHost = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const copy = readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /invoke<TerminalHaraStatus>\("inspect_terminal_hara"\)/);
  assert.match(source, /managed\?\.installed && managed\.managed && !managed\.blocked/);
  assert.match(source, /terminal\.pathSource|terminal\?\.pathSource/);
  assert.match(source, /navigator\.clipboard\.writeText\(pathCommand\)/);
  assert.doesNotMatch(source, /invoke[^\n]*\("(?:install|synchronize|execute|shell)/);
  assert.match(app, /<CommandLineDiagnostics managed=\{commandLineHara\} onManagedStatus=\{setCommandLineHara\}/);
  assert.match(nativeHost, /async fn inspect_terminal_hara\(/);
  assert.match(nativeHost, /spawn_blocking\(move \|\| command_line_probe::inspect/);
  for (const key of ["cliTerminalTitle", "cliTerminalRecheck", "cliTerminalShadowedTitle", "cliTerminalEnvironmentHint"]) {
    assert.equal((copy.match(new RegExp(`\\b${key}:`, "g")) || []).length, 2, `${key} is bilingual`);
  }
});

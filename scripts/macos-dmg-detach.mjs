// Exact-version patch adapter: never edit the generated upstream script or packaged App in place.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
export const UPSTREAM_DMG_SHA256 = '3b21448e5eef9b7c4f6bd8593e6c5f577ee5c64db2a237a4908e63fb6d81a89e';
const sha = value => createHash('sha256').update(value).digest('hex');
const originalFunction = /function hdiutil_detach_retry\(\) \{[\s\S]*?\n\}/g;
export function patchedDmgScript(source) {
  assert.equal(sha(source), UPSTREAM_DMG_SHA256, 'Unknown Tauri DMG script; review the new upstream source before patching');
  const text = source.toString('utf8'); assert.equal([...text.matchAll(originalFunction)].length, 1);
  return text.replace(originalFunction, fs.readFileSync(join(directory, 'macos-dmg-detach-retry.sh'), 'utf8').trimEnd());
}
export function packagingEnvironment(env, platform = process.platform) {
  if (platform !== 'darwin') return { ...env };
  assert(!env.BASH_ENV, 'Refuse an inherited BASH_ENV rather than masking a separate shell hook');
  return { ...env, BASH_ENV: join(directory, 'macos-dmg-detach-hook.sh'), HARA_DMG_WRAPPER_NODE: process.execPath,
    HARA_DMG_WRAPPER_MODULE: fileURLToPath(import.meta.url), HARA_DMG_DIAGNOSTICS_MODULE: join(directory, 'macos-dmg-detach-diagnostics.mjs') };
}
async function child(command, args, env) {
  const p = spawn(command, args, { env, stdio: 'inherit' });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) { const handler = () => p.kill(signal); handlers.set(signal, handler); process.on(signal, handler); }
  try { return await new Promise(resolve => { p.once('error', () => resolve(1)); p.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1)); }); }
  finally { for (const [signal, handler] of handlers) process.off(signal, handler); }
}
export async function runPatchedScript(script, args, env = process.env) {
  const file = resolve(script), info = fs.lstatSync(file);
  assert(file.endsWith('/bundle/dmg/bundle_dmg.sh') && info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.uid === process.getuid(), 'Expected an owned generated Tauri DMG script');
  const source = fs.readFileSync(file), patched = patchedDmgScript(source);
  const output = join(dirname(file), 'bundle_dmg.hara-detach-retry.sh');
  try { fs.writeFileSync(output, patched, { mode: 0o700, flag: 'wx' }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; const st = fs.lstatSync(output); assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.uid === process.getuid()); assert.equal(fs.readFileSync(output, 'utf8'), patched, 'Refuse to overwrite another derived script'); }
  assert.equal(sha(fs.readFileSync(file)), UPSTREAM_DMG_SHA256, 'Upstream script changed during preparation');
  const next = { ...env }; delete next.BASH_ENV;
  next.HARA_DMG_WRAPPER_NODE = process.execPath; next.HARA_DMG_DIAGNOSTICS_MODULE = join(directory, 'macos-dmg-detach-diagnostics.mjs');
  console.log(`Hara DMG detach retry: exact upstream ${UPSTREAM_DMG_SHA256}; derived ${sha(patched)}; max 3 attempts; no force`);
  return child('/bin/bash', [output, ...args], next);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, command, ...args] = process.argv.slice(2);
  try {
    assert(command && ['run', 'script'].includes(operation), 'Usage: macos-dmg-detach.mjs run <command> ... | script <generated-script> ...');
    process.exitCode = operation === 'script' ? await runPatchedScript(command, args) : await child(command, args, packagingEnvironment(process.env));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

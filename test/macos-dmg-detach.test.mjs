import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patchedDmgScript, packagingEnvironment, UPSTREAM_DMG_SHA256, runPatchedScript } from '../scripts/macos-dmg-detach.mjs';
import { identifyOwnedImage } from '../scripts/macos-dmg-detach-diagnostics.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const original = fs.readFileSync(join(root, 'test/fixtures/tauri-2.11.4-bundle-dmg.sh'));
const helper = join(root, 'scripts/macos-dmg-detach-retry.sh');
const shell = fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash';
// Git Bash accepts drive-qualified forward-slash paths, unlike native backslashes.
const shellPath = value => value.replaceAll('\\', '/');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(fn) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hdmg-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
for (const [name, sequence, expectedCode, attempts, delays] of [
  ['success is not retried', [0], 0, 1, []],
  ['exit2 gets one finite recovery', [2, 0], 0, 2, [2]],
  ['legacy exit16 still retries', [16, 0], 0, 2, [2]],
  ['mixed busy codes succeed on third', [2, 16, 0], 0, 3, [2, 4]],
  ['permanent2 preserves last status', [2, 2, 2, 0], 2, 3, [2, 4]],
  ['permanent16 preserves last status', [16, 16, 16, 0], 16, 3, [2, 4]],
  ['unrelated failure is immediate', [1, 0], 1, 1, []],
  ['permission-like failure is not masked', [77, 0], 77, 1, []],
]) test(name, () => fixture(dir => {
  const state = join(dir, 'state'), waits = join(dir, 'waits'), calls = join(dir, 'calls'), diagnostics = join(dir, 'diagnostics');
  fs.writeFileSync(state, '0');
  const script = `set -eu\nsource "$1"\nMAXIMUM_UNMOUNTING_ATTEMPTS=3
codes=(${sequence.join(' ')})
hdiutil() { local n; n=$(<"$2"); printf '%s\\n' "$((n+1))" > "$2"; printf '%s\\n' "$*" >> "$3"; return "\${codes[$n]}"; }
sleep() { printf '%s\\n' "$1" >> "$4"; }
hara_dmg_detach_diagnostics() { printf '%s\\n' "$*" >> "$5"; }
hdiutil_detach_retry /dev/disk999
echo COMPLETE`;
  // Fixed positional fixture paths are embedded as quoted variables, never system special parameters.
  const withPaths = script.replaceAll('"$2"', JSON.stringify(state)).replaceAll('"$3"', JSON.stringify(calls)).replaceAll('"$4"', JSON.stringify(waits)).replaceAll('"$5"', JSON.stringify(diagnostics));
  const r = spawnSync(shell, ['-c', withPaths, 'fixture', helper], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, expectedCode, r.stderr); assert.equal(Number(fs.readFileSync(state)), attempts);
  assert.deepEqual(fs.existsSync(waits) ? fs.readFileSync(waits, 'utf8').trim().split('\n').map(Number) : [], delays);
  assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').every(s => s === 'detach /dev/disk999'), true);
  assert.equal(r.stdout.includes('COMPLETE'), expectedCode === 0);
}));
test('invalid/unbounded retry limit refuses before any device operation', () => {
  const r = spawnSync(shell, ['-c', 'set -eu; source "$1"; MAXIMUM_UNMOUNTING_ATTEMPTS=999; hdiutil() { echo BAD; }; hdiutil_detach_retry /dev/disk999', 'fixture', helper], { encoding: 'utf8' });
  assert.equal(r.status, 64); assert(!r.stdout.includes('BAD'));
});
test('exact upstream hash and only the retry function change', () => {
  assert.equal(sha(original), UPSTREAM_DMG_SHA256); const patched = patchedDmgScript(original);
  const marker = /function hdiutil_detach_retry\(\) \{[\s\S]*?\n\}/;
  const before = original.toString(), segment = before.match(marker)[0];
  const replacement = fs.readFileSync(helper, 'utf8').trimEnd(); assert.equal(patched, before.replace(segment, replacement));
  assert(patched.includes('2|16)')); assert(patched.includes('hdiutil convert'));
  assert.throws(() => patchedDmgScript(Buffer.concat([original, Buffer.from('\n# drift')])));
});
test('environment hook is macOS-child-only and never masks an existing hook', () => {
  const value = packagingEnvironment({ PATH: 'fixture', TAURI_SIGNING_PRIVATE_KEY: 'synthetic-only' }, 'darwin');
  assert.equal(value.BASH_ENV, join(root, 'scripts/macos-dmg-detach-hook.sh')); assert.equal(value.TAURI_SIGNING_PRIVATE_KEY, 'synthetic-only');
  assert.deepEqual(packagingEnvironment({ PATH: 'fixture' }, 'win32'), { PATH: 'fixture' });
  assert.throws(() => packagingEnvironment({ BASH_ENV: '/other-hook' }, 'darwin'));
});
test('BASH_ENV intercepts only the generated Tauri path, not other shell commands', () => fixture(dir => {
  const dmg = join(dir, 'bundle/dmg'); fs.mkdirSync(dmg, { recursive: true });
  const script = join(dmg, 'bundle_dmg.sh'), unrelated = join(dir, 'ordinary.sh'), mock = join(dir, 'mock.mjs');
  fs.writeFileSync(script, 'echo UNINTERCEPTED'); fs.writeFileSync(unrelated, 'echo ORDINARY');
  fs.writeFileSync(mock, 'console.log(JSON.stringify(process.argv.slice(2)));');
  const env = { PATH: process.env.PATH, BASH_ENV: shellPath(join(root, 'scripts/macos-dmg-detach-hook.sh')), HARA_DMG_WRAPPER_NODE: shellPath(process.execPath), HARA_DMG_WRAPPER_MODULE: shellPath(mock), MSYS2_ARG_CONV_EXCL: '*' };
  const intercepted = spawnSync(shell, [shellPath(script), 'with space', '--unchanged'], { env, encoding: 'utf8' });
  assert.equal(intercepted.status, 0, intercepted.stderr); assert.deepEqual(JSON.parse(intercepted.stdout), ['script', shellPath(script), 'with space', '--unchanged']);
  const ordinary = spawnSync(shell, [shellPath(unrelated)], { env, encoding: 'utf8' }); assert.equal(ordinary.stdout.trim(), 'ORDINARY');
}));
test('diagnostics bind exact creator/image/device, never a reused or unrelated volume', () => {
  const images = [{ 'image-path': '/private/tmp/fixture/rw.1234.test.dmg', 'system-entities': [{ 'dev-entry': '/dev/disk99' }, { 'dev-entry': '/dev/disk99s1', 'mount-point': '/Volumes/dmg.example' }] }];
  assert.equal(identifyOwnedImage(images, '/dev/disk99', '1234').mount, '/Volumes/dmg.example');
  assert.throws(() => identifyOwnedImage(images, '/dev/disk99', '4444'));
  assert.throws(() => identifyOwnedImage(images, '/dev/disk88', '1234'));
  assert.throws(() => identifyOwnedImage([...images, ...images], '/dev/disk99', '1234'));
  assert.throws(() => identifyOwnedImage(images, '/dev/disk99;echo BAD', '1234'));
});
test('reject changed generated source, symlinks and hardlinks before execution', async () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hdmg-'));
  try {
    const dmg = join(dir, 'bundle/dmg'); fs.mkdirSync(dmg, { recursive: true });
    const script = join(dmg, 'bundle_dmg.sh'); fs.writeFileSync(script, '#!/bin/bash\necho BAD\n');
    await assert.rejects(runPatchedScript(script, [])); assert(!fs.existsSync(join(dmg, 'bundle_dmg.hara-detach-retry.sh')));
    if (process.platform !== 'win32') {
      fs.renameSync(script, script + '.original'); fs.symlinkSync(script + '.original', script); await assert.rejects(runPatchedScript(script, []));
      fs.unlinkSync(script); fs.linkSync(script + '.original', script); await assert.rejects(runPatchedScript(script, []));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('reviewed candidate and formal Mac producers share the patch adapter', () => {
  const candidate = fs.readFileSync(join(root, 'scripts/candidate-native.mjs'), 'utf8');
  assert.equal((candidate.match(/scripts\/macos-dmg-detach\.mjs/g) ?? []).length, 2);
  const formal = fs.readFileSync(join(root, 'scripts/build-mac-signed.sh'), 'utf8');
  assert.equal((formal.match(/with-updater-file\.mjs node scripts\/macos-dmg-detach\.mjs run npm run tauri build/g) ?? []).length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { INPUT, ROOT } from '../scripts/candidate-common.mjs';
import path from 'node:path';

const read = file => fs.readFileSync(path.join(ROOT, file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('candidate Core identity exactly matches the committed sidecar, not an earlier plan', () => {
  const commit = read('src-tauri/binaries/SIDECAR_COMMIT').toString().trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(INPUT.core.commit, commit);
  assert.match(INPUT.core.tree, /^[a-f0-9]{40}$/);
  assert.equal(INPUT.core.version, read('src-tauri/binaries/SIDECAR_VERSION').toString().trim());
  assert.equal(INPUT.desktop.version, JSON.parse(read('package.json')).version);
  // The application source is a frozen ancestor; orchestration adds the binding afterwards.
  // Requiring INPUT.desktop.commit === HEAD here would create an impossible self-reference.
  assert.match(INPUT.desktop.commit, /^[a-f0-9]{40}$/);
  assert.match(INPUT.desktop.tree, /^[a-f0-9]{40}$/);
});

test('candidate lock hashes are hashes of the exact committed lock bytes, including the sidecar newline', () => {
  for (const [file, field] of [['package-lock.json', 'npm'], ['src-tauri/Cargo.lock', 'cargo'], ['src-tauri/binaries/SIDECAR_COMMIT', 'sidecar']]) {
    assert.equal(INPUT.locks[field], hash(read(file)), `${field} candidate lock drift`);
  }
});

test('candidate versions and updater public-key identity stay bound without reading signing keys', () => {
  for (const tool of ['node', 'bun', 'rust']) assert.equal(INPUT.toolchain[tool], read(`.${tool}-version`).toString().trim());
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(INPUT.updaterPublicKeySha256, hash(config.plugins.updater.pubkey));
  assert.equal(config.version, INPUT.desktop.version);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { candidateEvidence, readJson, save, saveRetainedNotary } from '../scripts/candidate-common.mjs';

// Runner must NOT sit under TMPDIR/HOME from withCiEnvironment (those land inside evidence).
// Mirror production: durable notary lives under a host runner root outside the evidence whitelist.
const RUNNER_PARENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.runners-live33-notary-test');

function freshRunner() {
  fs.mkdirSync(RUNNER_PARENT, { recursive: true, mode: 0o755 });
  const runner = fs.realpathSync(fs.mkdtempSync(path.join(RUNNER_PARENT, 'runner-')));
  fs.chmodSync(runner, 0o755);
  return runner;
}

test('saveRetainedNotary writes under runner _candidate-notary outside evidence whitelist', () => {
  const scope = candidateEvidence(), base = scope.fixture('retained-notary-ok'), runner = freshRunner();
  const statePath = path.join(runner, '_candidate-notary', 'identity', 'aarch64-apple-darwin', 'app', 'digest', 'notary.json');
  saveRetainedNotary(statePath, { status: 'submission-starting-outcome-unknown', inputSha256: 'abc' }, runner);
  assert.equal(readJson(statePath).status, 'submission-starting-outcome-unknown');
  if (process.getuid) assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  saveRetainedNotary(statePath, { status: 'In Progress', submissionId: '01234567-0123-0123-0123-0123456789ab' }, runner);
  assert.equal(readJson(statePath).status, 'In Progress');
  assert.throws(() => save(statePath, { should: 'fail' }), /outside evidence whitelist|forbidden evidence prefix/);
  const publicPath = path.join(base, 'app-notary.json');
  save(publicPath, { status: 'Accepted', submissionId: '01234567-0123-0123-0123-0123456789ab' });
  assert.equal(readJson(publicPath).status, 'Accepted');
});

test('saveRetainedNotary refuses paths outside runner _candidate-notary and symlink escape', () => {
  const scope = candidateEvidence(), base = scope.fixture('retained-notary-refuse'), runner = freshRunner();
  assert.throws(
    () => saveRetainedNotary(path.join(runner, 'notary.json'), { x: 1 }, runner),
    /retained notary path must stay under runnerDirectory\/_candidate-notary/);
  assert.throws(
    () => saveRetainedNotary(path.join(base, 'notary.json'), { x: 1 }, runner),
    /retained notary path must stay under runnerDirectory\/_candidate-notary/);
  const retained = path.join(runner, '_candidate-notary');
  fs.mkdirSync(retained, { mode: 0o700 });
  // Escape target also outside evidence (sibling under RUNNER_PARENT).
  const outside = fs.mkdtempSync(path.join(RUNNER_PARENT, 'escape-'));
  fs.symlinkSync(outside, path.join(retained, 'escape'));
  assert.throws(
    () => saveRetainedNotary(path.join(retained, 'escape', 'notary.json'), { x: 1 }, runner),
    /retained notary|alias|directory|symlink|escaped/);
});

test('durableNotary persists retained state via saveRetainedNotary not evidence save', () => {
  const source = fs.readFileSync(new URL('../scripts/candidate-signing.mjs', import.meta.url), 'utf8');
  assert.match(source, /saveRetainedNotary/);
  assert.match(source, /const persist = value => saveRetainedNotary\(statePath, value, config\.runnerDirectory\)/);
  assert.match(source, /save\(output, publicState\)/);
  assert.doesNotMatch(source, /save\(statePath/);
});

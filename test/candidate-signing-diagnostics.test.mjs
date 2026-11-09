import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run, candidateEvidence } from '../scripts/candidate-common.mjs';
import { signingLogFile, signingRun, signingRecorder, timestampedCodesign, TIMESTAMP_RETRYABLE, TIMESTAMP_RETRY_DELAYS_MS } from '../scripts/candidate-signing.mjs';

const IDENTITY = 'Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)';
const SIGN = ['--force', '--options', 'runtime', '--timestamp', '--keychain', '/private/fixture/signing.keychain-db', '--sign', IDENTITY, '--entitlements', '/fixture/Entitlements.plist', '/fixture/Hara.app'];
const failure = reason => Object.assign(new Error(`candidate phase failed: Sign exact native-built executable/App (exit=1, signal=none, reason=${reason})`), { reason });

// A fake runner that behaves like run(): it writes the (redacted) output to logFile and throws on failure.
function fakeRunner(outcomes) {
  const calls = [], logs = new Map();
  const runner = async (label, command, args, options) => {
    calls.push({ label, command, args: [...args], options: { ...options } });
    args.push('--mutated-by-runner'); // the next attempt must not see this
    const next = outcomes[calls.length - 1] ?? outcomes.at(-1);
    logs.set(options.logFile, next.output ?? '');
    if (next.ok) return next.output ?? '';
    throw failure(next.reason ?? 'exit');
  };
  return { runner, calls, readLog: file => { assert(logs.has(file), 'log read only for files the runner wrote'); return logs.get(file); } };
}
function harness(outcomes, extra = {}) {
  const fake = fakeRunner(outcomes), records = [], waits = [];
  const options = { logDir: '/private/fixture/evidence/signing-diagnostics', record: value => records.push(structuredClone(value)),
    runner: fake.runner, readLog: fake.readLog, wait: async ms => { waits.push(ms); }, ...extra };
  return { ...fake, records, waits, options };
}

test('signing log files are absolute, unique and inside the requested evidence directory', () => {
  const directory = '/private/fixture/evidence/signing-diagnostics';
  const a = signingLogFile(directory, 'Sign exact native-built executable/App'), b = signingLogFile(directory, 'Sign exact native-built executable/App');
  assert.notEqual(a, b);
  for (const file of [a, b]) { assert.equal(path.dirname(file), directory); assert.match(path.basename(file), /^\d{3}-sign-exact-native-built-executable-app-[0-9a-f]{8}\.log$/); }
  assert.throws(() => signingLogFile('relative/dir', 'x'), /absolute/);
  assert.throws(() => signingLogFile(undefined, 'x'), /absolute/);
});

test('signingRun always captures into a private logFile and echoes redacted output only when asked', async () => {
  const fake = fakeRunner([{ ok: true, output: 'accepted\nsource=Notarized Developer ID\n' }]);
  const written = []; const original = process.stdout.write;
  process.stdout.write = chunk => { written.push(String(chunk)); return true; };
  try {
    const output = await signingRun('Gatekeeper notarized App', '/usr/sbin/spctl', ['-a', '-vv', '/fixture/Hara.app'], { logDir: '/private/fixture/evidence/signing-diagnostics', echo: true, env: { A: '1' }, runner: fake.runner, readLog: fake.readLog });
    assert.equal(output, 'accepted\nsource=Notarized Developer ID\n');
  } finally { process.stdout.write = original; }
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.capture, true); assert.deepEqual(fake.calls[0].options.env, { A: '1' });
  assert.equal(path.dirname(fake.calls[0].options.logFile), '/private/fixture/evidence/signing-diagnostics');
  assert.deepEqual(written, ['accepted\nsource=Notarized Developer ID\n']);
});

test('signingRun failures propagate unchanged', async () => {
  const fake = fakeRunner([{ ok: false, output: 'Error: HTTP status code: 401' }]);
  await assert.rejects(() => signingRun('Query notarization', '/usr/bin/xcrun', ['notarytool', 'info', 'x'], { logDir: '/private/fixture/evidence/d', runner: fake.runner, readLog: fake.readLog }), /candidate phase failed: .*reason=exit/);
});

test('timestamped codesign succeeds once without retrying and records the attempt', async () => {
  const h = harness([{ ok: true, output: '/fixture/Hara.app: replacing existing signature\n' }]);
  await timestampedCodesign('Sign exact native-built executable/App', SIGN, h.options);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].command, '/usr/bin/codesign'); assert.deepEqual(h.calls[0].args, SIGN);
  assert.deepEqual(h.waits, []);
  assert.equal(h.records.length, 1);
  assert.deepEqual({ ...h.records[0], attempts: h.records[0].attempts.map(a => a.outcome) },
    { label: 'Sign exact native-built executable/App', file: '/fixture/Hara.app', identity: IDENTITY, maxRetries: 2, attempts: ['success'], outcome: 'success', retriesUsed: 0 });
});

test('a timestamp-service failure is retried with the exact same file, identity, keychain and options', async () => {
  const h = harness([{ ok: false, output: '/fixture/Hara.app: The timestamp service is not available.\n' }, { ok: true, output: 'signed\n' }]);
  assert.equal(await timestampedCodesign('Sign exact native-built executable/App', SIGN, h.options), 'signed\n');
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) { assert.deepEqual(call.args, SIGN); assert.equal(call.command, '/usr/bin/codesign'); assert.equal(call.options.capture, true); assert.equal(call.options.timeout, 120000); }
  assert.notEqual(h.calls[0].options.logFile, h.calls[1].options.logFile, 'every attempt keeps its own diagnostic log');
  assert.deepEqual(h.waits, [TIMESTAMP_RETRY_DELAYS_MS[0]]);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].retriesUsed, 1); assert.equal(h.records[0].outcome, 'success');
  assert.deepEqual(h.records[0].attempts.map(a => a.outcome), ['timestamp-service-unavailable', 'success']);
  assert.equal(h.records[0].attempts[0].logFile, path.basename(h.calls[0].options.logFile));
});

test('timestamp retries stop after two and the failure is not swallowed', async () => {
  const h = harness([{ ok: false, output: 'The timestamp service is not available.' }]);
  await assert.rejects(() => timestampedCodesign('Sign exact native-built executable/App', SIGN, h.options), error => {
    assert.match(error.message, /^candidate phase failed: Sign exact native-built executable\/App \(exit=1, signal=none, reason=exit\); codesign attempts=3 \(timestamp retries=2, retryable=true\)$/);
    assert.match(error.cause.message, /reason=exit/);
    return true;
  });
  assert.equal(h.calls.length, 3); assert.deepEqual(h.waits, [...TIMESTAMP_RETRY_DELAYS_MS]);
  assert.equal(h.records.length, 1); assert.equal(h.records[0].outcome, 'failure'); assert.equal(h.records[0].retriesUsed, 2);
  assert.deepEqual(h.records[0].attempts.map(a => a.attempt), [1, 2, 3]);
});

test('non-timestamp codesign failures are never retried', async () => {
  for (const output of ['/fixture/Hara.app: resource fork, Finder information, or similar detritus not allowed',
    '/fixture/Hara.app: errSecInternalComponent', 'error: The specified item could not be found in the keychain.', '',
    'Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."', 'The network connection was lost.', '/fixture/Hara.app: MacOS error -67886']) {
    const h = harness([{ ok: false, output }, { ok: true }]);
    await assert.rejects(() => timestampedCodesign('Sign exact native-built executable/App', SIGN, h.options), /codesign attempts=1 \(timestamp retries=0, retryable=false\)/);
    assert.equal(h.calls.length, 1, output); assert.deepEqual(h.waits, []);
    assert.equal(h.records[0].outcome, 'failure'); assert.equal(h.records[0].attempts[0].outcome, 'failure');
  }
});

test('a timeout kill or signal is not retried even when the partial output mentions the timestamp service', async () => {
  for (const reason of ['timeout', 'output-limit']) {
    const h = harness([{ ok: false, reason, output: 'The timestamp service is not available.' }, { ok: true }]);
    await assert.rejects(() => timestampedCodesign('Sign exact native-built executable/App', SIGN, h.options), /retryable=false/);
    assert.equal(h.calls.length, 1, reason);
  }
});

test('timestamped codesign refuses calls without timestamp, identity, keychain or an evidence recorder', async () => {
  const h = harness([{ ok: true }]);
  for (const args of [SIGN.filter(a => a !== '--timestamp'), ['--force', '--timestamp', '--keychain', '/k', '/fixture/x'], ['--force', '--timestamp', '--sign', IDENTITY, '/fixture/x']])
    await assert.rejects(() => timestampedCodesign('x', args, h.options), /timestamped Developer ID codesign required/);
  await assert.rejects(() => timestampedCodesign('x', SIGN, { ...h.options, record: undefined }), /recorded in evidence/);
  assert.equal(h.calls.length, 0);
});

test('retry classification matches only the timestamp-service-unavailable failure (-67885)', () => {
  assert.deepEqual([...TIMESTAMP_RETRY_DELAYS_MS], [10000, 30000]);
  for (const text of ['/fixture/Hara.app: The timestamp service is not available.', 'Hara.app: MacOS error -67885', 'security error -67885: The timestamp service is not available.'])
    assert.match(text, TIMESTAMP_RETRYABLE, text);
  for (const text of ['resource fork, Finder information, or similar detritus not allowed', 'errSecInternalComponent', 'replacing existing signature',
    'A timestamp was expected but was not found.', 'code object is not signed at all', 'User interaction is not allowed.', 'MacOS error -678850', 'MacOS error -167885',
    'Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."', 'The network connection was lost.', 'Could not connect to the server.'])
    assert.doesNotMatch(text, TIMESTAMP_RETRYABLE, text);
});

test('signingRecorder keeps full attempt evidence privately and a summary for the receipt', () => {
  const written = [], summary = [];
  const record = signingRecorder('/private/fixture/evidence/signing-diagnostics', summary, { write: (file, value) => written.push({ file, value }) });
  record({ label: 'Sign exact native-built executable/App', file: '/fixture/x/Hara.app', identity: IDENTITY, maxRetries: 2,
    attempts: [{ attempt: 1, outcome: 'timestamp-service-unavailable' }, { attempt: 2, outcome: 'success' }], outcome: 'success', retriesUsed: 1 });
  assert.equal(written.length, 1); assert.equal(path.dirname(written[0].file), '/private/fixture/evidence/signing-diagnostics');
  assert.match(path.basename(written[0].file), /^\d{3}-codesign-attempts-[0-9a-f]{8}\.json$/);
  assert.equal(written[0].value.attempts.length, 2);
  assert.deepEqual(summary, [{ label: 'Sign exact native-built executable/App', file: 'Hara.app', attempts: 2, retriesUsed: 1, outcome: 'success' }]);
});

test('with the real run(), a failing signing call keeps redacted output in its logFile and prints its tail', async () => {
  const scope = candidateEvidence(), logDir = path.join(scope.fixture('signing-diagnostics'), 'signing-diagnostics');
  const secret = 'synthetic-signing-password-123456'; process.env.SYNTHETIC_SIGNING_PASSWORD = secret;
  const stderr = []; const original = process.stderr.write;
  // Stand in for /usr/bin/codesign with a child that prints a timestamp failure (and a secret) and exits 1.
  const runner = (label, _command, _args, options) => run(label, process.execPath, ['-e', `console.error("Hara.app: The timestamp service is not available. ${secret}");process.exitCode=1`], options);
  const records = [];
  process.stderr.write = chunk => { stderr.push(String(chunk)); return true; };
  try {
    await assert.rejects(() => timestampedCodesign('Sign exact native-built executable/App', SIGN, { logDir, runner, record: v => records.push(v), wait: async () => {} }), /codesign attempts=3 \(timestamp retries=2, retryable=true\)/);
  } finally { process.stderr.write = original; delete process.env.SYNTHETIC_SIGNING_PASSWORD; }
  const logs = fs.readdirSync(logDir).filter(n => n.endsWith('.log')).sort();
  assert.equal(logs.length, 3);
  for (const name of logs) {
    const text = fs.readFileSync(path.join(logDir, name), 'utf8');
    assert.match(text, /The timestamp service is not available/); assert(!text.includes(secret)); assert.match(text, /REDACTED/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(logDir, name + '.result.json'))).code, 1);
  }
  const printed = stderr.join('');
  assert.match(printed, /The timestamp service is not available/); assert(!printed.includes(secret));
  assert.deepEqual(records[0].attempts.map(a => a.logFile), logs);
});

test('every codesign/notarytool/stapler/spctl call in the signing script goes through a logged helper', () => {
  const source = fs.readFileSync(new URL('../scripts/candidate-signing.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:run|sync)\([^;]*'\/usr\/bin\/codesign'/);
  assert.doesNotMatch(source, /\b(?:run|sync)\([^;]*'\/usr\/sbin\/spctl'/);
  assert.doesNotMatch(source, /\b(?:run|sync)\([^;]*\['(?:notarytool|stapler)'/);
  assert.equal(source.match(/await timestampedCodesign\(/g).length, 3, 'probe, App and DMG signing use the timestamp helper');
  for (const label of ['Submit ${target} ${kind} notarization once', 'Query ${target} ${kind} notarization', 'Staple notarized App', 'Gatekeeper notarized App',
    'Staple notarized native DMG', 'Gatekeeper final DMG', 'Strict Developer ID verification', 'Read Developer ID metadata'])
    assert(source.includes('signingRun(' + (label.includes('${') ? '`' : "'") + label), label);
  assert.match(source, /'credential-preflight\.json'[^\n]*codesignAttempts: probeCodesign/);
  assert.match(source, /phase: 'app-signed'[^\n]*codesignAttempts,/);
  assert.match(source, /nativeTarget: prior\.nativeTarget, codesignAttempts \}/);
});

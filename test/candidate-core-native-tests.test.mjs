import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { intelFileBudgetBatches, warmHeadlessBrowser, INTEL_SLOW_FILE_TIMEOUT_MS, ORIGINAL_FILE_TIMEOUT_MS, DEADLINES }
  from '../scripts/candidate-core-native-tests.mjs';

// Mirrors pinned Core 29ecc4ac native-ci-tests.mjs / intel-ci-test-budget.mjs batch semantics.
const SLOW = ['legacy-copy-roundtrip.test.mjs', 'legacy-startup.test.mjs'], CONTENTION = ['presentations.test.mjs'];
const FILES = ['a.test.mjs', 'b.test.mjs', ...SLOW, ...CONTENTION].sort();
function coreRunner({ slowTimeout = 300000, mutate = batches => batches } = {}) {
  const intel = files => [
    { timeout: slowTimeout, concurrency: 1, files: files.filter(f => SLOW.includes(f)), slow: true },
    { timeout: 120000, concurrency: 4, files: files.filter(f => !SLOW.includes(f) && !CONTENTION.includes(f)), slow: false },
    { timeout: 120000, concurrency: 1, files: files.filter(f => CONTENTION.includes(f)), slow: false, isolated: true },
  ];
  const nativeTestBatches = (files, arch) => mutate(intel(files).map(b => ({ ...b, timeout: arch === 'arm64' ? 120000 : b.timeout })));
  return { nativeTestBatches, strictNativeTestBatches: (files, arch) => intel(files).map(b => ({ ...b, timeout: 120000 })) };
}

test('Intel candidate raises only Core-named slow files to a bounded 300s file deadline', () => {
  const batches = intelFileBudgetBatches(coreRunner(), SLOW, FILES);
  assert.equal(DEADLINES, 'intel-slow-file-300s-v1');
  assert.deepEqual(batches.map(b => [b.timeout, b.concurrency, b.files]), [
    [INTEL_SLOW_FILE_TIMEOUT_MS, 1, SLOW], [ORIGINAL_FILE_TIMEOUT_MS, 4, ['a.test.mjs', 'b.test.mjs']], [ORIGINAL_FILE_TIMEOUT_MS, 1, CONTENTION]]);
  assert.equal(batches.flatMap(b => b.files).length, FILES.length, 'no file is skipped');
});

test('Intel candidate refuses any batch drift beyond the reviewed slow-file deadline', () => {
  const refuse = (runner, slow = SLOW) => assert.throws(() => intelFileBudgetBatches(runner, slow, FILES));
  refuse(coreRunner({ slowTimeout: 600000 }));
  refuse(coreRunner({ mutate: b => b.map(x => x.isolated ? { ...x, timeout: 300000 } : x) }));
  refuse(coreRunner({ mutate: b => b.map(x => x.slow ? { ...x, concurrency: 4 } : x) }));
  refuse(coreRunner({ mutate: b => b.map(x => x.slow ? { ...x, files: [...x.files, 'a.test.mjs'] } : x) }));
  refuse(coreRunner({ mutate: b => b.slice(1) }));
  refuse(coreRunner(), [...SLOW, 'presentations.test.mjs']);
});

test('browser warm-up is bounded, non-fatal and stops after the first verified render', async () => {
  let clock = 0, calls = 0; const logs = [];
  const now = () => clock, log = line => logs.push(line);
  assert.deepEqual(await warmHeadlessBrowser({ find: () => undefined, render: () => { calls++; }, log, now }), []);
  assert.equal(calls, 0);
  const flaky = async (html, pages) => { calls++; assert.equal(pages, 1); assert.match(html, /^<!doctype html>/); clock += 60000;
    if (calls === 1) throw Error('Presentation PDF rendering timed out safely.'); };
  assert.deepEqual(await warmHeadlessBrowser({ find: () => '/browser', render: flaky, log, now }),
    [{ attempt: 1, ok: false, ms: 60000 }, { attempt: 2, ok: true, ms: 60000 }]);
  assert.equal(calls, 2); assert.match(logs.join('\n'), /attempt 1: Presentation PDF rendering timed out safely\. after 60000ms/);
  calls = 0;
  const failing = async () => { calls++; throw Error('no'); };
  assert.equal((await warmHeadlessBrowser({ find: () => '/browser', render: failing, log, now })).every(r => !r.ok), true);
  assert.equal(calls, 2, 'warm-up never retries without bound');
});

test('Intel runner keeps Core prelude, strips case budgets and refuses non-Intel execution', () => {
  const source = fs.readFileSync(new URL('../scripts/candidate-core-native-tests.mjs', import.meta.url), 'utf8');
  for (const step of ['node_modules/typescript/bin/tsc', 'scripts/normalize-dist-modes.mjs', 'scripts/check-local-bin-link.mjs', 'scripts/evaluate-feedback-traces.mjs'])
    assert(source.includes(`"${step}"`), step);
  assert(source.includes('delete env.HARA_INTEL_TEST_BUDGET')); assert(!/HARA_INTEL_TEST_BUDGET\s*=/.test(source));
  assert(source.includes('process.platform === "darwin" && process.arch === "x64"'));
  assert(!/--test-skip-pattern|--test-name-pattern|skip:|retry/i.test(source.replace(/never retries|skips?\b/g, '')));
  assert(/^import .+ from "node:[a-z/]+";$/m.test(source) && !/^import .+ from "(?!node:)/m.test(source), 'node builtins only');
});

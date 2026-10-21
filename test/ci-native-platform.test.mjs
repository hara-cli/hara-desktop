import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ROOT} from '../scripts/candidate-common.mjs';
test('ordinary CI exercises original Windows regressions and native Intel Core without signer access',()=>{
  const workflow=fs.readFileSync(ROOT+'.github/workflows/ci.yml','utf8');
  assert.match(workflow,/core-native-install:[\s\S]*os: \[macos-15, macos-15-intel\]/);
  assert.match(workflow,/SIDECAR_COMMIT/);assert.match(workflow,/steps\.core-lock\.outputs\.commit/);
  assert.match(workflow,/regression-windows:[\s\S]*ci-regression\.mjs/);
  assert.match(workflow,/windows-regression-diagnostics/);
  assert.match(workflow,/GIT_CONFIG_COUNT: '1'\s+GIT_CONFIG_KEY_0: core\.autocrlf\s+GIT_CONFIG_VALUE_0: 'false'/);
  assert(!/self-hosted|environment:|secrets\.|contents: write|workflow_dispatch/.test(workflow));
  assert.match(fs.readFileSync(ROOT+'scripts/ci-core-platform.mjs','utf8'),/assertNoRosettaProbe/);
  const native=fs.readFileSync(ROOT+'scripts/candidate-native.mjs','utf8');
  assert.match(native,/Install locked Core with native optional-dependency semantics/);
  assert(!native.includes("['rebuild', '--no-audit'"));
});
test('file-backed regression fixtures convert URLs instead of treating URL pathnames as host paths',()=>{
  const tests = new URL('../test/', import.meta.url);
  for (const name of fs.readdirSync(tests).filter(name=>name.endsWith('.test.mjs'))) {
    const source=fs.readFileSync(new URL(name,tests),'utf8');
    assert.doesNotMatch(source,/new URL\([^;]*import\.meta\.url\)\.pathname|root\.pathname/,name);
  }
});

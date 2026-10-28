import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const blocks = new Map([...workflow.matchAll(/^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n|$(?![\s\S]))/gm)]
  .map(match => [match[1], match[0]]));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function inline(job) {
  const block = blocks.get(job);
  assert(block, 'expected ordinary CI job');
  const scripts = [...block.matchAll(/          node --input-type=module <<'NODE'\n([\s\S]*?)          NODE(?:\n|$)/g)];
  assert.equal(scripts.length, 1, job + ' must have one explicit provision entry');
  const source = scripts[0][1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const imports = [...source.matchAll(/^import .+;$/gm)].map(match => match[0]);
  assert(imports.every(line => /^import .+ from '(?:node:path|\.\/scripts\/(?:ci-evidence|candidate-common|ci-regression|ci-core-platform)\.mjs)';$/.test(line)));
  return new AsyncFunction('path', 'process', 'provisionCiEvidence', 'withCiEnvironment', 'ROOT', 'run', 'runRegression', 'corePlatformSmoke',
    source.replace(/^import .+;\n/gm, ''));
}

function leaf(job, attempt = '2') {
  const block = blocks.get(job);
  const match = block.match(/CI_EVIDENCE_LEAF: (.+)/);
  assert(match, 'job must explicitly choose its evidence leaf');
  return match[1].replaceAll('${{ github.run_id }}', '123456789').replaceAll('${{ github.run_attempt }}', attempt);
}

for (const job of ['quality', 'native', 'core-native-install', 'regression-windows']) {
  for (const [platform, paths, workspace] of [['POSIX', path.posix, '/workspace/desktop'], ['Windows', path.win32, 'D:\\a\\desktop\\desktop']]) {
    test(job + ' inline entry keeps native ' + platform + ' paths and the original gate', async () => {
      const root = paths.join(workspace, leaf(job));
      const output = paths.join(root, 'tmp', job === 'core-native-install' ? 'core-platform-smoke' : job === 'regression-windows' ? 'windows-regressions' : 'regressions');
      const processStub = { env: { GITHUB_WORKSPACE: workspace, CI_EVIDENCE_LEAF: leaf(job), RUNNER_TEMP: '/must-not-be-read' } };
      const privateEnv = { HOME: paths.join(root, 'synthetic-home'), TMPDIR: paths.join(root, 'tmp'),
        CANDIDATE_EVIDENCE_ROOT: root, HARA_WRAPPER_EVIDENCE_ROOT: root, CANDIDATE_OUTPUT_DIR: output };
      let provisions = 0, guarded = false, commands = 0;
      const context = { evidenceRoot: root, base: output, env: privateEnv };
      const provision = options => { provisions++; assert.deepEqual(options, { evidenceRoot: root, output }); return context; };
      const guard = async (c, body) => { assert.equal(c, context); guarded = true; try { return await body(); } finally { guarded = false; } };
      const fullRegression = async (label, command, args, options) => {
        commands++; assert(guarded, 'full regression must be inside the private environment');
        assert.equal(label, 'Ordinary CI original full suite'); assert.equal(command, 'bash'); assert.deepEqual(args, ['-c', 'exec npm test']);
        assert.deepEqual(options, { cwd: workspace, env: privateEnv, capture: true, logFile: paths.join(output, 'tests.log') });
      };
      const windows = async (...args) => {
        commands++; assert.equal(args.length, 1, 'no test-only gate overrides in a workflow');
        assert.deepEqual(args[0], { evidenceRoot: root, output }); assert.equal(job, 'regression-windows');
      };
      const core = async (...args) => {
        commands++; assert.equal(args.length, 1, 'native/lock/hydration gates stay in the real caller');
        assert.deepEqual(args[0], { core: paths.join(workspace, 'core'), evidenceRoot: root, output }); assert.equal(job, 'core-native-install');
      };
      await inline(job)(paths, processStub, provision, guard, workspace, fullRegression, windows, core);
      assert.equal(commands, 1); assert.equal(provisions, job === 'quality' || job === 'native' ? 1 : 0);
      assert.equal(guarded, false); assert.equal(processStub.env.HOME, undefined, 'later steps must keep their original environment');
      assert.equal(paths.normalize(root), root); assert.equal(paths.normalize(output), output);
      assert.notEqual(leaf(job, '3'), leaf(job), 'a new attempt cannot reuse evidence');
    });
  }
  test(job + ' refuses a missing workspace before provisioning or running tools', async () => {
    let effects = 0;
    const unexpected = () => { effects++; throw Error('unexpected effect'); };
    await assert.rejects(() => inline(job)(path.posix, { env: { CI_EVIDENCE_LEAF: leaf(job), RUNNER_TEMP: '/must-not-be-used' } },
      unexpected, unexpected, '/unused', unexpected, unexpected, unexpected), /must be of type string/);
    assert.equal(effects, 0);
  });
}

test('every ordinary full regression consumer is explicitly bound and never receives system-temp authority', () => {
  for (const job of ['quality', 'native', 'core-native-install', 'regression-windows']) {
    const block = blocks.get(job);
    assert(!/\$RUNNER_TEMP|runner\.temp|os\.tmpdir|mkdtemp|rmSync|\brm\s+-/.test(block.replace(/^.*workspace-panel-smoke.*$/gm, '')));
    assert(!/run:\s*npm test\s*$|continue-on-error|--test-name-pattern|--test-skip-pattern/.test(block));
    assert.match(block, /CI_EVIDENCE_LEAF: ci-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-[a-z]+/);
    inline(job);
  }
});

for (const [job, output, log] of [['core-native-install', 'core-platform-smoke', 'search.log'], ['regression-windows', 'windows-regressions', 'tests.log']]) {
  test(job + ' artifact paths select exactly its bound diagnostic files', () => {
    const expected = '${{ github.workspace }}/${{ env.CI_EVIDENCE_LEAF }}/tmp/' + output + '/' + log;
    const block = blocks.get(job);
    assert(block.includes(expected + '\n')); assert(block.includes(expected + '.result.json\n'));
    assert.match(block, /if: always\(\)/); assert.match(block, /retention-days: 7/); assert.match(block, /if-no-files-found: warn/);
    for (const [paths, workspace] of [[path.posix, '/workspace/desktop'], [path.win32, 'D:\\a\\desktop\\desktop']]) {
      const rendered = expected.replace('${{ github.workspace }}', workspace).replace('${{ env.CI_EVIDENCE_LEAF }}', leaf(job));
      assert.equal(paths.normalize(rendered), paths.join(workspace, leaf(job), 'tmp', output, log));
    }
  });
}

test('ordinary provision retains hosted matrices, permissions, timing and isolation from candidate/signing', () => {
  assert.equal((workflow.match(/timeout-minutes: 20/g) ?? []).length, 5);
  assert.match(workflow, /runs-on: ubuntu-22\.04/); assert.match(workflow, /os: \[macos-15, macos-15-intel\]/);
  assert.equal((workflow.match(/runs-on: windows-latest/g) ?? []).length, 2);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert(!/self-hosted|environment:|secrets\.|contents: write|workflow_dispatch|GITHUB_ENV|candidate-ready|candidate-rebind|--dry-run/.test(workflow));
});

// Tag release jobs run the same original suite under the same retained evidence boundary.
const release = fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
const releaseBlocks = new Map([...release.matchAll(/^  ([a-z][a-z0-9_]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9_]*:\n|$(?![\s\S]))/gm)]
  .map(match => [match[1], match[0]]));
for (const [job, label, suffix] of [['prepare_release', 'Release prepare original full suite', 'prepare'],
  ['sign_and_promote', 'Release signing-host original full suite', 'signing']]) {
  test(job + ' runs the original suite inside provisioned retained evidence', async () => {
    const block = releaseBlocks.get(job);
    assert(block, 'expected release job');
    assert(!/run:\s*npm test\s*$/m.test(block), job + ' must not run the suite without evidence');
    assert(!/--test-name-pattern|--test-skip-pattern/.test(block));
    const match = block.match(/CI_EVIDENCE_LEAF: (.+)/);
    assert.equal(match?.[1], 'release-evidence-${{ github.run_id }}-${{ github.run_attempt }}-' + suffix);
    const scripts = [...block.matchAll(/          node --input-type=module <<'NODE'\n([\s\S]*?)          NODE(?:\n|$)/g)]
      .filter(script => script[1].includes('provisionCiEvidence'));
    assert.equal(scripts.length, 1);
    const source = scripts[0][1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
    assert([...source.matchAll(/^import .+;$/gm)].every(line =>
      /^import .+ from '(?:node:path|\.\/scripts\/(?:ci-evidence|candidate-common)\.mjs)';$/.test(line[0])));
    const workspace = '/runner/work/hara-desktop/hara-desktop';
    const leaf = match[1].replaceAll('${{ github.run_id }}', '123456789').replaceAll('${{ github.run_attempt }}', '1');
    const root = path.posix.join(workspace, leaf), output = path.posix.join(root, 'tmp', 'regressions');
    const privateEnv = { HOME: path.posix.join(root, 'synthetic-home'), TMPDIR: path.posix.join(root, 'tmp') };
    const context = { evidenceRoot: root, base: output, env: privateEnv };
    let guarded = false, commands = 0;
    const provision = options => { assert.deepEqual(options, { evidenceRoot: root, output }); return context; };
    const guard = async (c, body) => { assert.equal(c, context); guarded = true; try { return await body(); } finally { guarded = false; } };
    const full = async (name, command, args, options) => {
      commands++; assert(guarded); assert.equal(name, label); assert.equal(command, 'bash'); assert.deepEqual(args, ['-c', 'exec npm test']);
      assert.deepEqual(options, { cwd: '/repo', env: privateEnv, capture: true, logFile: path.posix.join(output, 'tests.log') });
    };
    await new AsyncFunction('path', 'process', 'provisionCiEvidence', 'withCiEnvironment', 'ROOT', 'run',
      source.replace(/^import .+;\n/gm, ''))(path.posix, { env: { GITHUB_WORKSPACE: workspace, CI_EVIDENCE_LEAF: leaf } },
      provision, guard, '/repo', full);
    assert.equal(commands, 1);
  });
}

test('prepare_release evidence is ignored by Git and signing evidence stays outside the source checkout', () => {
  const ignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\/release-evidence-\*\/$/m);
  const prepare = releaseBlocks.get('prepare_release');
  assert(prepare.indexOf("'Release prepare original full suite'") < prepare.indexOf('[ -z "$(git status --porcelain)" ]'),
    'the clean-tree gate must still run after the suite');
  const sign = releaseBlocks.get('sign_and_promote');
  assert.match(sign, /HARA_RELEASE_SOURCE_ROOT: \$\{\{ github\.workspace \}\}\/source-/);
  assert(!/source-\$\{\{ github\.run_id \}\}.*\/release-evidence/.test(sign));
});

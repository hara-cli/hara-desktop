import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localTarInvocation, runLocalTar } from '../scripts/candidate-local-tar.mjs';
import { validateTar, validateExtractedTree } from '../scripts/candidate-archive.mjs';
import { candidateEvidence } from '../scripts/candidate-common.mjs';

test('all platforms pass only a local archive basename to -f, including Windows cross-drive directories', () => {
  for (const operation of ['create', 'extract']) {
    const entries = operation === 'create' ? ['bundle'] : [];
    const flag = operation === 'create' ? '-czf' : '-xzf';
    assert.deepEqual(localTarInvocation(operation, 'D:\\output space\\bundle.tar.gz', 'C:\\source space\\release', entries, 'win32'),
      { cwd: 'D:\\output space', args: [flag, './bundle.tar.gz', '-C', 'C:/source space/release', '--', ...entries] });
    for (const platform of ['darwin', 'linux']) assert.deepEqual(localTarInvocation(operation, '/output space/bundle.tar.gz', '/source space/release', entries, platform),
      { cwd: '/output space', args: [flag, './bundle.tar.gz', '-C', '/source space/release', '--', ...entries] });
  }
});

test('remote archives, drive-relative paths, option entries and path traversal are refused', () => {
  for (const archive of ['host:bundle.tar.gz', 'D:bundle.tar.gz', '\\\\server\\share\\bundle.tar.gz', 'D:\\out\\host:bundle.tar.gz']) {
    assert.throws(() => localTarInvocation('create', archive, 'C:\\input', ['bundle'], 'win32'));
  }
  for (const entry of ['../bundle', '/bundle', '--use-compress-program=other', 'C:/bundle', 'a\\b', 'bundle/../outside', 'bundle\nother']) {
    assert.throws(() => localTarInvocation('create', '/out/bundle.tar.gz', '/input', [entry], 'linux'));
  }
  assert.throws(() => localTarInvocation('create', '/out/bundle.tar.gz', '/input', [], 'darwin'));
  assert.throws(() => localTarInvocation('extract', '/out/bundle.tar.gz', '/input', ['bundle'], 'darwin'));
});

test('native, signing and upgrade paths share local tar handling without weakening extraction validation', () => {
  const counts = { native: 2, signing: 3, upgrade: 1 };
  for (const [name, count] of Object.entries(counts)) {
    const source = fs.readFileSync(new URL(`../scripts/candidate-${name}.mjs`, import.meta.url), 'utf8');
    assert.equal((source.match(/\brunLocalTar\(/g) ?? []).length, count);
    assert.equal(/(?:run|sync)\([^\n]*['"]tar['"]/.test(source), false, `${name} must not bypass local archive handling`);
    const extract = source.indexOf("'extract',");
    assert(extract > source.indexOf('await validateTar('), `${name} must validate before extraction`);
    assert(source.indexOf('validateExtractedTree(', extract) > extract, `${name} must validate the extracted tree`);
  }
});

test('real local tar round-trips spaces and package bytes with each installed Windows tar implementation', { timeout: 10000 }, async t => {
  const scope = candidateEvidence(), output = scope.fixture('candidate-tar-output'), input = scope.fixture('candidate-tar-source');
  // Keep real round-trips inside the retained evidence root. The unconditional C:/D:
  // operand contract above covers cross-drive selection without allocating outside it.
  const release = scope.mkdir(path.join(input, 'release space')), bundle = scope.mkdir(path.join(release, 'bundle'));
  scope.mkdir(path.join(bundle, 'msi')); scope.mkdir(path.join(bundle, 'nsis'));
  const bytes = Buffer.from([0, 255, 128, 1, 17]);
  fs.writeFileSync(scope.checked(path.join(bundle, 'msi/Hara package.msi'), { missing: true }), bytes, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(scope.checked(path.join(bundle, 'nsis/Hara setup.exe'), { missing: true }), bytes, { flag: 'wx', mode: 0o600 });
  const env = scope.environment({ COPYFILE_DISABLE: '1' });
  const archive = path.join(output, 'bundle package.tar.gz');
  await runLocalTar('Synthetic package archive', 'create', archive, path.join(input, 'release space'), ['bundle'], { env });
  await validateTar(archive);
  const restored = scope.mkdir(path.join(output, 'restored space'));
  await runLocalTar('Synthetic package restore', 'extract', archive, restored, [], { env });
  validateExtractedTree(path.join(restored, 'bundle'));
  assert.deepEqual(fs.readFileSync(path.join(restored, 'bundle/msi/Hara package.msi')), bytes);

  const implementations = new Set(['tar']);
  if (process.platform === 'win32') {
    const found = scope.guardSync(env, () => spawnSync('where.exe', ['tar'], { env, encoding: 'utf8', timeout: 5000 }));
    assert.equal(found.status, 0, 'Windows must expose its actual tar implementations');
    for (const file of found.stdout.trim().split(/\r?\n/)) if (fs.existsSync(file)) implementations.add(file);
    const gitTar = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git/usr/bin/tar.exe');
    if (fs.existsSync(gitTar)) implementations.add(gitTar);
  }
  let index = 0;
  for (const command of implementations) {
    const file = path.join(output, `implementation-${index}.tar.gz`), destination = path.join(output, `implementation-${index++}`);
    scope.mkdir(destination);
    for (const [operation, directory, entries] of [['create', path.join(input, 'release space'), ['bundle']], ['extract', destination, []]]) {
      const invocation = localTarInvocation(operation, file, directory, entries);
      const result = scope.guardSync(env, () => spawnSync(command, invocation.args, { cwd: invocation.cwd, env, encoding: 'utf8', timeout: 5000 }));
      assert.equal(result.status, 0, `${path.basename(command)} ${operation}: ${result.stderr}`);
      if (operation === 'create') await validateTar(file);
    }
    validateExtractedTree(path.join(destination, 'bundle'));
    assert.deepEqual(fs.readFileSync(path.join(destination, 'bundle/nsis/Hara setup.exe')), bytes);
  }
  scope.assertEnvironment(env); assert(fs.existsSync(input)); assert(fs.existsSync(output));
  t.diagnostic(`local tar implementations verified: ${implementations.size}; cross-drive=${path.parse(input).root !== path.parse(output).root}`);
});

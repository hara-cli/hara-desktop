import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
    assert.deepEqual(localTarInvocation(operation, '/output space/bundle.tar.gz', '/source space/release', entries, 'linux'),
      { cwd: '/output space', args: [flag, './bundle.tar.gz', '-C', '/source space/release', '--', ...entries] });
    // bsdtar on macOS otherwise writes AppleDouble `._*` siblings (e.g. `._bundle`) for extended attributes.
    const mac = operation === 'create' ? ['--no-mac-metadata', '--no-xattrs'] : [];
    assert.deepEqual(localTarInvocation(operation, '/output space/bundle.tar.gz', '/source space/release', entries, 'darwin'),
      { cwd: '/output space', args: [...mac, flag, './bundle.tar.gz', '-C', '/source space/release', '--', ...entries] });
  }
});

function rawTarNames(file) {
  const bytes = zlib.gunzipSync(fs.readFileSync(file)), names = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512); if (header.every(b => b === 0)) break;
    names.push(header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, ''));
    offset += 512 + Math.ceil(parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8) / 512) * 512;
  }
  return names;
}

test('darwin archives of extended-attribute payloads carry no AppleDouble siblings and pass validation', { skip: process.platform !== 'darwin', timeout: 10000 }, async () => {
  const scope = candidateEvidence(), output = scope.fixture('candidate-tar-xattr-output'), input = scope.fixture('candidate-tar-xattr-source');
  const bundle = scope.mkdir(path.join(input, 'bundle')), file = path.join(bundle, 'dmg/Hara.dmg');
  scope.mkdir(path.dirname(file)); fs.writeFileSync(scope.checked(file, { missing: true }), 'payload', { flag: 'wx', mode: 0o600 });
  // Regression for candidate run 42769059165: the self-hosted signer's files carry xattrs and the
  // archiving environment does not set COPYFILE_DISABLE, so the invocation itself must suppress them.
  const env = scope.environment();
  assert.equal(env.COPYFILE_DISABLE, undefined, 'the regression must not be masked by COPYFILE_DISABLE');
  for (const target of [bundle, file]) {
    const set = scope.guardSync(env, () => spawnSync('/usr/bin/xattr', ['-w', 'com.hara.candidate-test', 'x', target], { env, encoding: 'utf8', timeout: 5000 }));
    assert.equal(set.status, 0, set.stderr);
  }
  const archive = path.join(output, 'bundle.tar.gz');
  await runLocalTar('Synthetic xattr package archive', 'create', archive, input, ['bundle'], { env });
  const names = rawTarNames(archive);
  assert.deepEqual(names.filter(name => /(?:^|\/)\._/.test(name)), [], 'AppleDouble entries must not be archived');
  assert(names.every(name => name === 'bundle/' || name.startsWith('bundle/')), `entries outside bundle/: ${names.join(', ')}`);
  await validateTar(archive);
  scope.assertEnvironment(env);
});

test('every archive the pipeline creates is validated immediately after creation', () => {
  for (const [name, label] of [['native', 'Archive immutable native payload'], ['signing', 'Archive immutable final package set']]) {
    const source = fs.readFileSync(new URL(`../scripts/candidate-${name}.mjs`, import.meta.url), 'utf8');
    const create = source.indexOf(`runLocalTar('${label}', 'create'`);
    assert(create > 0, `${name} must create ${label}`);
    const line = source.slice(create, source.indexOf('\n', create)), next = source.slice(source.indexOf('\n', create) + 1, source.indexOf('\n', source.indexOf('\n', create) + 1));
    assert(/await validateTar\(/.test(line + next), `${name} must validate ${label} right after creating it`);
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

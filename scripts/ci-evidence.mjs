// Ordinary CI caller provision only. No credential files, candidate authority or deletion API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateEvidence } from './candidate-upgrade.mjs';

const contexts = new WeakSet();
export function provisionCiEvidence({ evidenceRoot, output, env = process.env, io = fs, paths = path,
  accountHome = os.userInfo().homedir, ownerUid = process.getuid?.() } = {}) {
  const folded = value => value.replaceAll('\\', '/').toLowerCase();
  const forbidden = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders',
    paths.join(accountHome, 'Library', 'Caches'), paths.join(accountHome, '.hara')].map(folded);
  function lexical(value) {
    assert(typeof value === 'string' && paths.isAbsolute(value) && !/[\0\r\n]/.test(value)
      && !value.split(/[\\/]/).includes('..') && paths.normalize(value) === value, 'explicit canonical CI evidence path required');
    assert(!forbidden.some(prefix => folded(value).startsWith(prefix)), 'forbidden CI evidence prefix');
    return value;
  }
  const root = lexical(evidenceRoot ?? env.CANDIDATE_EVIDENCE_ROOT ?? env.HARA_WRAPPER_EVIDENCE_ROOT);
  const base = lexical(output ?? env.CANDIDATE_OUTPUT_DIR);
  for (const key of ['CANDIDATE_EVIDENCE_ROOT', 'HARA_WRAPPER_EVIDENCE_ROOT'])
    assert(env[key] === undefined || env[key] === root, 'conflicting CI evidence binding');
  const home = paths.join(root, 'synthetic-home'), tmp = paths.join(root, 'tmp');
  const relative = paths.relative(tmp, base);
  assert(relative && !paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + paths.sep), 'CI output must be below evidence tmp');
  function identity(directory) {
    const st = io.lstatSync(directory, { bigint: true });
    assert(st.isDirectory() && !st.isSymbolicLink(), 'plain CI evidence directory required');
    if (ownerUid !== undefined) assert(Number(st.uid) === ownerUid && (Number(st.mode) & 0o022) === 0, 'unsafe CI evidence owner or mode');
    assert.equal(io.realpathSync(directory), directory, 'CI evidence alias refused');
    return [st.dev, st.ino, st.uid].map(String).join(':');
  }
  function ensure(directory) {
    let missing = false;
    try { io.lstatSync(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; }
    if (missing) {
      const parent = paths.dirname(directory), before = identity(parent);
      io.mkdirSync(directory, { mode: 0o700 });
      assert.equal(identity(parent), before, 'CI evidence parent identity changed');
    }
    return identity(directory);
  }
  const anchor = ensure(root);
  for (const directory of [home, tmp]) {
    assert.equal(identity(root), anchor, 'CI evidence root identity changed'); ensure(directory);
  }
  assert.equal(identity(root), anchor, 'CI evidence root identity changed');
  const bound = { ...env, CANDIDATE_EVIDENCE_ROOT: root, HARA_WRAPPER_EVIDENCE_ROOT: root, CANDIDATE_OUTPUT_DIR: base,
    USERPROFILE: home, CFFIXED_USER_HOME: home, HARA_HOME: paths.join(home, '.hara'), TMP: tmp, TEMP: tmp, HOME: home, TMPDIR: tmp };
  const scope = gateEvidence(root, { env: bound, io, paths, accountHome, ownerUid });
  const privateEnv = scope.environment();
  scope.guardSync(privateEnv, () => scope.mkdir(base)); // Exclusive output; retain and reject an existing leaf.
  const context = Object.freeze({ evidenceRoot: root, base, env: privateEnv, scope, cleanup: 'keep', deletionEnabled: false });
  contexts.add(context); return context;
}

export async function withCiEnvironment(context, operation, target = process.env) {
  assert(contexts.has(context), 'provisioned CI context required');
  const previous = { ...target };
  const replace = values => {
    for (const key of Object.keys(target)) if (!Object.hasOwn(values, key)) delete target[key];
    Object.assign(target, values);
  };
  try {
    replace(context.env);
    return await context.scope.guard(context.env, () => operation(context));
  } finally {
    // Restore only this process's environment, never remove evidence or temporary directories.
    replace(previous);
  }
}

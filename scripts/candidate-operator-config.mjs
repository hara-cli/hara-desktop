// Non-secret machine locations/identifiers come from the protected environment, never source defaults.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertToolchain} from './candidate-common.mjs';

function value(env, name) {
  const text = env[name];
  assert(typeof text === 'string' && text.length > 0 && text.length <= 4096
    && text === text.trim() && !/[\u0000-\u001f\u007f]/.test(text), `candidate configuration missing or invalid: ${name}`);
  return text;
}
function absolute(env, name) {
  const text = value(env, name);
  assert(path.isAbsolute(text) && path.resolve(text) === text && path.dirname(text) !== text,
    `candidate configuration requires a normalized absolute location: ${name}`);
  return text;
}
export function candidateRunnerName(env = process.env) {
  const name = value(env, 'HARA_CANDIDATE_RUNNER_NAME');
  assert(name.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(name), 'candidate signer name invalid');
  return name;
}
export function candidateSigningConfiguration(env = process.env) {
  const result = {
    runnerName: candidateRunnerName(env),
    runnerDirectory: absolute(env, 'HARA_CANDIDATE_RUNNER_DIRECTORY'),
    operationsDirectory: absolute(env, 'HARA_CANDIDATE_OPS_DIRECTORY'),
    keychain: absolute(env, 'HARA_CANDIDATE_SIGNING_KEYCHAIN'),
    passwordFile: absolute(env, 'HARA_CANDIDATE_SIGNING_PASSWORD_FILE'),
    notaryKeyFile: absolute(env, 'HARA_CANDIDATE_NOTARY_KEY_FILE'),
    notaryKeyId: value(env, 'HARA_CANDIDATE_NOTARY_KEY_ID'),
    notaryIssuerId: value(env, 'HARA_CANDIDATE_NOTARY_ISSUER_ID'),
  };
  assert(/^[A-Z0-9]{10}$/.test(result.notaryKeyId), 'candidate notarization key identifier invalid');
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result.notaryIssuerId), 'candidate notarization issuer invalid');
  assert(!/^(?:login|system)(?:\.|$)/i.test(path.basename(result.keychain)), 'candidate requires a dedicated signing keychain');
  assert(new Set([result.keychain,result.passwordFile,result.notaryKeyFile]).size === 3, 'candidate signing files must be distinct');
  return Object.freeze(result);
}
export function candidateToolchainDirectories(env = process.env) {
  const directories = value(env, 'HARA_CANDIDATE_TOOLCHAIN_PATH').split(path.delimiter);
  assert(directories.length >= 1 && directories.length <= 8 && new Set(directories).size === directories.length,
    'candidate toolchain directory list invalid');
  for (const directory of directories) absolute({directory}, 'directory');
  return directories;
}
export function selectCandidateToolchains(env = process.env, verify = assertToolchain) {
  const directories = candidateToolchainDirectories(env), output = absolute(env, 'GITHUB_PATH');
  // The workflow prepends these directories for this process. Verify exact pinned versions/native
  // architecture BEFORE persisting PATH for subsequent steps, and recheck in every build context.
  verify();
  fs.appendFileSync(output, directories.join('\n') + '\n', {encoding:'utf8',flag:'a'});
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv[2], 'select-tools'); candidateSigningConfiguration(); selectCandidateToolchains();
    console.log('Candidate pinned toolchains verified; private runner PATH selected.');
  } catch { console.error('Candidate toolchain configuration/version check failed; no signing started.'); process.exitCode=1; }
}

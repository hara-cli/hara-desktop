import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ROOT} from '../scripts/candidate-common.mjs';
import {candidateRunnerName,candidateSigningConfiguration,candidateToolchainDirectories,selectCandidateToolchains} from '../scripts/candidate-operator-config.mjs';

function environment(root = path.resolve(os.tmpdir(),'candidate-config-fixture')) {
  return {
    HARA_CANDIDATE_RUNNER_NAME:'synthetic-candidate-signer',
    HARA_CANDIDATE_RUNNER_DIRECTORY:path.join(root,'runner'),
    HARA_CANDIDATE_OPS_DIRECTORY:path.join(root,'operations'),
    HARA_CANDIDATE_SIGNING_KEYCHAIN:path.join(root,'dedicated.keychain-db'),
    HARA_CANDIDATE_SIGNING_PASSWORD_FILE:path.join(root,'password-reference'),
    HARA_CANDIDATE_NOTARY_KEY_FILE:path.join(root,'notary-key-reference'),
    HARA_CANDIDATE_NOTARY_KEY_ID:'FAKEKEY123',
    HARA_CANDIDATE_NOTARY_ISSUER_ID:'00000000-0000-4000-8000-000000000001',
  };
}
test('candidate configuration uses only declared environment locations and identifiers, with no file/key reads',()=>{
  const e=environment(), config=candidateSigningConfiguration(e);
  assert.equal(config.runnerName,e.HARA_CANDIDATE_RUNNER_NAME);
  assert.equal(config.operationsDirectory,e.HARA_CANDIDATE_OPS_DIRECTORY);
  assert.equal(config.passwordFile,e.HARA_CANDIDATE_SIGNING_PASSWORD_FILE);
  assert.equal(config.notaryKeyId,e.HARA_CANDIDATE_NOTARY_KEY_ID);
  assert.equal(config.notaryIssuerId,e.HARA_CANDIDATE_NOTARY_ISSUER_ID);
  assert(Object.isFrozen(config)); assert.equal(candidateRunnerName(e),'synthetic-candidate-signer');
});
for(const key of Object.keys(environment())) test(`missing ${key} fails closed without machine defaults`,()=>{
  const e=environment();delete e[key];assert.throws(()=>candidateSigningConfiguration(e));
});
for(const bad of ['', 'relative/location', '/', 'https://example.invalid', 'bad\npath']) test(`invalid operator location ${JSON.stringify(bad)} is refused`,()=>{
  const e=environment();e.HARA_CANDIDATE_OPS_DIRECTORY=bad;assert.throws(()=>candidateSigningConfiguration(e));
});
test('wrong notary identifiers, login keychains and aliased secret files are refused',()=>{
  for(const change of [
    e=>e.HARA_CANDIDATE_NOTARY_KEY_ID='invalid', e=>e.HARA_CANDIDATE_NOTARY_ISSUER_ID='invalid',
    e=>e.HARA_CANDIDATE_SIGNING_KEYCHAIN=path.join(os.tmpdir(),'login.keychain-db'),
    e=>e.HARA_CANDIDATE_NOTARY_KEY_FILE=e.HARA_CANDIDATE_SIGNING_PASSWORD_FILE,
  ]){const e=environment();change(e);assert.throws(()=>candidateSigningConfiguration(e));}
});
test('tool locations do not waive version verification; drift refuses before PATH writes',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'candidate-tool-config-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'job-path'), original='existing\n';fs.writeFileSync(file,original);
  const directories=[path.join(root,'node'),path.join(root,'bun'),path.join(root,'rust')];
  const env={HARA_CANDIDATE_TOOLCHAIN_PATH:directories.join(path.delimiter),GITHUB_PATH:file};
  assert.deepEqual(candidateToolchainDirectories(env),directories);
  assert.throws(()=>selectCandidateToolchains(env,()=>{throw Error('synthetic version drift');}));
  assert.equal(fs.readFileSync(file,'utf8'),original);
  let checked=0;selectCandidateToolchains(env,()=>checked++);assert.equal(checked,1);
  assert.equal(fs.readFileSync(file,'utf8'),original+directories.join('\n')+'\n');
  for(const bad of ['',directories[0]+path.delimiter,path.delimiter+directories[0],directories[0]+path.delimiter+directories[0]])
    assert.throws(()=>candidateToolchainDirectories({...env,HARA_CANDIDATE_TOOLCHAIN_PATH:bad}));
});
test('all three signer jobs consume protected variables and validate tools before hydration',()=>{
  const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/candidate.yml'),'utf8');
  for(const name of [...Object.keys(environment()),'HARA_CANDIDATE_TOOLCHAIN_PATH'])
    assert.equal(workflow.split('${{ vars.'+name+' }}').length-1,3,`${name} must be configured in every signer job`);
  assert.equal(workflow.split('node scripts/candidate-operator-config.mjs select-tools').length-1,3);
  for(const name of ['credential_preflight','sign_apps','sign_payloads']) {
    const job=workflow.slice(workflow.indexOf('\n  '+name+':')+1).split(/\n  [a-z_]+:/)[0];
    assert(job.indexOf('select-tools')>0 && job.indexOf('select-tools')<job.indexOf('candidate-native.mjs hydrate'));
  }
});
test('public candidate files contain no machine home, personal approval timeline or internal roles section',()=>{
  const scripts=fs.readdirSync(path.join(ROOT,'scripts')).filter(n=>/^candidate-.*\.(?:mjs|swift)$/.test(n));
  const files=['AGENTS.md','.github/workflows/candidate.yml','docs/CANDIDATE_GATE_A.md','docs/PRETAG_CANDIDATE_GATE.md',...scripts.map(n=>'scripts/'+n)];
  for(const file of files) {
    const content=fs.readFileSync(path.join(ROOT,file),'utf8');
    assert(!/(?:^|[\s"'])\/(?:Users|Volumes)\//m.test(content),`${file} contains a machine-specific path`);
    assert(!/approved plan A on|oc_[a-f0-9]{20,}|编码工具分工/.test(content),`${file} contains internal operator context`);
  }
  const swift=fs.readFileSync(path.join(ROOT,'scripts/candidate-unlock.swift'),'utf8');
  assert(swift.includes('environment["HARA_CANDIDATE_SIGNING_KEYCHAIN"]'));
  assert(swift.includes('environment["HARA_CANDIDATE_SIGNING_PASSWORD_FILE"]'));
  assert(swift.includes('O_NOFOLLOW')&&swift.includes('metadata.st_nlink == 1')&&swift.includes('metadata.st_mode & 0o777 == 0o600'));
  const guide=fs.readFileSync(path.join(ROOT,'docs/CANDIDATE_GATE_A.md'),'utf8');
  assert(guide.includes('approve their own candidate run')&&guide.includes('not** an'));
  assert(fs.readFileSync(path.join(ROOT,'docs/PRETAG_CANDIDATE_GATE.md'),'utf8').includes('PATH is a locator, not a version pin.'));
});

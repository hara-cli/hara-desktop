// Read-only, OUTSIDE the run: join real GitHub job/approval metadata to freshly downloaded bytes.
// This is not the earlier hypothetical v1 adapter. No env/tag context is fabricated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { INPUT, ROOT, TARGETS, api, sync, assertReceipt, downloadArtifact, readJson, save, fileHash } from './candidate-common.mjs';
import { candidateAssetNames } from './candidate-gate.mjs';
import { readAdmission } from './candidate-admission.mjs';
import { candidateRunnerName } from './candidate-operator-config.mjs';

export function checkRunMetadata(run, jobs, approvals, expected, configuredRunnerName = candidateRunnerName()) {
  assert.equal(run.id, expected.runId); assert.equal(run.run_attempt, expected.attempt);
  assert.equal(run.head_sha, expected.orchestration); assert.equal(run.repository.full_name, 'hara-cli/hara-desktop');
  assert.equal(run.head_repository.full_name, 'hara-cli/hara-desktop'); assert.equal(run.event, 'push');
  assert.equal(run.head_branch, INPUT.controlledRef.slice('refs/heads/'.length));
  assert.equal(run.path.split('@')[0], '.github/workflows/candidate.yml');
  assert.equal(run.actor.id, INPUT.approverId); assert.equal(run.triggering_actor.id, INPUT.approverId);
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  // GitHub review history is run-scoped, not an attempt-scoped authorization API. Until GitHub
  // exposes independent attempt linkage, refuse promotion proof for reruns rather than invent it.
  assert.equal(expected.attempt, 1, 'reruns need separate independently linked approval evidence');
  assert(approvals.some(r => r.state === 'approved' && r.user.id === INPUT.approverId && r.environments.some(e => e.id === INPUT.environmentId && e.name === INPUT.environment)), 'designated reviewer approval missing');
  assert(!approvals.some(r => r.state === 'rejected'));
  const named = name => { const rows = jobs.filter(j => j.name === name); assert.equal(rows.length, 1); const j = rows[0];
    assert.equal(j.run_id, expected.runId); assert.equal(j.run_attempt, expected.attempt); assert.equal(j.head_sha, expected.orchestration);
    assert.equal(j.status, 'completed'); assert.equal(j.conclusion, 'success'); return j; };
  const step = (j, name) => { const rows = j.steps.filter(s => s.name === name); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'completed'); assert.equal(rows[0].conclusion, 'success'); };
  for (const name of ['credential_preflight', 'sign_apps', 'sign_payloads']) {
    const j = named(name); assert.equal(j.runner_id, INPUT.runnerId); assert.equal(j.runner_group_id, INPUT.runnerGroupId);
    assert(typeof configuredRunnerName === 'string' && configuredRunnerName.length > 0, 'configured signer name missing');
    assert.equal(j.runner_name, configuredRunnerName);
  }
  step(named('credential_preflight'), 'Original updater-file and background Developer ID preflight');
  step(named('sign_apps'), 'Developer ID sign, notarize and staple exact native Apps');
  step(named('sign_payloads'), 'Sign and notarize native DMGs; sign Linux/Windows updater payloads locally');
  for (const target of TARGETS) {
    const label = target === TARGETS[0] ? 'macos-15' : target === TARGETS[1] ? 'macos-15-intel' : target === TARGETS[2] ? 'ubuntu-22.04' : 'windows-latest';
    const build = named(`candidate-build-${target}`), verify = named(`candidate-verify-${target}`);
    for (const j of [build, verify]) assert(j.labels.includes(label) && j.runner_group_id !== INPUT.runnerGroupId && j.runner_id !== INPUT.runnerId, 'native hosted runner evidence missing');
    step(build, 'Original complete Core and Desktop tests plus renderer'); step(build, 'Native sidecar boundary smoke and locked Rust tests');
    step(build, 'Complete formal native installer build including Intel DMG');
    step(verify, 'Native package smoke, signature verification and private old-version upgrade checks');
    if (target.endsWith('apple-darwin')) { const dmg = named(`candidate-dmg-${target}`); assert(dmg.labels.includes(label));
      assert.notEqual(dmg.runner_id, INPUT.runnerId); step(dmg, 'Repackage the exact signed App into final DMG on its native CPU'); }
  }
  return true;
}
export function checkVerifiedDirectory(directory, target, expected) {
  const proof = readJson(path.join(directory, 'candidate-verification.json')); assertReceipt(proof, expected);
  assert.equal(proof.target, target); assert.equal(proof.phase, 'verified'); assert.equal(proof.nativePackageSmoke, true);
  assert.equal(proof.piOnlyPreinstalledRequirementMet, true); assert.equal(proof.publicationAuthorized, false);
  const files = Object.fromEntries(candidateAssetNames(target, INPUT.desktop.version).map(name => { const file = path.join(directory, name);
    const st = fs.lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size > 0); return [name, { size: st.size, sha256: fileHash(file) }]; }));
  const upgrade = readJson(path.join(directory, 'candidate-upgrade.json')); assertReceipt(upgrade, expected); assert.equal(upgrade.target, target);
  assert.equal(upgrade.liveAppOrHomeChanged, false); assert.equal(upgrade.publicChannelChanged, false); assert.equal(upgrade.rows.length, INPUT.upgradeFrom.length);
  for (const from of INPUT.upgradeFrom) { const rows = upgrade.rows.filter(r => r.from === from); assert.equal(rows.length, 1); const row = rows[0];
    assert.equal(row.to, INPUT.desktop.version); assert.equal(row.signatureVerified, true); assert.equal(row.checked, true);
    assert.equal(row.privateInstalled, target.endsWith('apple-darwin')); }
  if (target.endsWith('apple-darwin')) {
    const quarantine = readJson(path.join(directory, 'candidate-quarantine.json')); assertReceipt(quarantine, expected);
    for (const k of ['gatekeeper','staple','strictSignature','privateCopyOnly']) assert.equal(quarantine[k], true);
    const signing = proof.signing; assert.equal(signing.nativeDmg, true); assert.equal(signing.nativeTarget, target);
    assert.equal(signing.finalDmgSha256, files[candidateAssetNames(target, INPUT.desktop.version)[0]].sha256);
    for (const notary of [signing.appNotary, signing.dmgNotary]) { assert.equal(notary.status, 'Accepted'); assert.match(notary.submissionId,/^[a-f0-9-]{36}$/); assert.match(notary.inputSha256,/^[a-f0-9]{64}$/); }
    assert.notEqual(signing.appNotary.submissionId, signing.dmgNotary.submissionId);
  }
  return { target, files, upgrades: upgrade.rows };
}
async function main() {
  const [runArg, sha, output] = process.argv.slice(2); assert.match(runArg??'',/^\d+$/); assert.match(sha??'',/^[a-f0-9]{40}$/); assert(path.isAbsolute(output));
  assert.equal(sync('git',['rev-parse','HEAD']),sha, 'run verifier must be the exact reviewed orchestration source');
  const expected = { runId:Number(runArg), attempt:1, orchestration:sha }, admission = await readAdmission({expected});
  const run = api(`repos/hara-cli/hara-desktop/actions/runs/${expected.runId}`);
  const jobs=[]; for(let page=1;page<=10;page++) { const r=api(`repos/hara-cli/hara-desktop/actions/runs/${expected.runId}/attempts/1/jobs?per_page=100&page=${page}`); jobs.push(...r.jobs); if(r.jobs.length<100)break; assert(page<10); }
  const approvals=api(`repos/hara-cli/hara-desktop/actions/runs/${expected.runId}/approvals`);
  checkRunMetadata(run,jobs,approvals,expected); fs.mkdirSync(output,{recursive:true,mode:0o700});
  const platforms=[];
  for(const target of TARGETS) { const directory=await downloadArtifact('verified',target,path.join(output,target),expected); platforms.push({ ...checkVerifiedDirectory(directory,target,expected), artifact:readJson(path.join(directory,'transport-evidence.json')) }); }
  save(path.join(output,'verified-candidate.json'),{schema:2,...expected, application:INPUT.desktop, core:INPUT.core, input:INPUT, admission, workflowSha256:fileHash(path.join(ROOT,'.github/workflows/candidate.yml')), platforms, publicationAuthorized:false});
  save(path.join(output,'independent-github-evidence.json'),{run,jobs,approvals});
  console.log('Independent candidate verification passed. No tag or publication was performed.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();

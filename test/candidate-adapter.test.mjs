import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT, TARGETS } from '../scripts/candidate-common.mjs';
import { validateAdmission } from '../scripts/candidate-admission.mjs';
import { checkRunMetadata } from '../scripts/candidate-run-verifier.mjs';

function policy() {
  return [{id:INPUT.environmentId,name:INPUT.environment,can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:INPUT.approverId}}]},{type:'branch_policy'}]},
    {total_count:1,branch_policies:[{id:INPUT.branchPolicyId,type:'branch',name:INPUT.controlledRef.slice(11)}]},
    {id:INPUT.rulesetId,enforcement:'active',target:'branch',source_type:'Repository',source:'hara-cli/hara-desktop',updated_at:'2026-10-21T02:45:13.435+08:00',bypass_actors:[{actor_id:INPUT.approverId,actor_type:'User',bypass_mode:'always'}],conditions:{ref_name:{include:[INPUT.controlledRef],exclude:[]}},rules:['creation','update','deletion','non_fast_forward'].map(type=>({type}))}];
}
test('live admission schema has exact environment/ref/reviewer and no admin bypass',()=>assert.match(validateAdmission(...policy()).sha256,/^[a-f0-9]{64}$/));
for(const [name,change] of Object.entries({ bypass:p=>p[0].can_admins_bypass=true, foreignEnvironment:p=>p[0].id++, noReviewer:p=>p[0].protection_rules.shift(), extraReviewer:p=>p[0].protection_rules[0].reviewers.push({type:'User',reviewer:{id:1}}),
  broadRef:p=>p[1].branch_policies[0].name='*', extraPolicy:p=>p[1].branch_policies.push({name:'main'}), noProtection:p=>p[2].enforcement='disabled', broadRuleset:p=>p[2].conditions.ref_name.include.push('refs/heads/main'), extraBypass:p=>p[2].bypass_actors.push({actor_id:1,actor_type:'Team',bypass_mode:'always'}), missingRestriction:p=>p[2].rules.pop() })) {
  test(`live admission rejects ${name}`,()=>{const p=policy();change(p);assert.throws(()=>validateAdmission(...p));});
}
function metadata() {
  const expected={runId:1,attempt:1,orchestration:'f'.repeat(40)};
  const run={id:1,run_attempt:1,head_sha:expected.orchestration,repository:{full_name:'hara-cli/hara-desktop'},head_repository:{full_name:'hara-cli/hara-desktop'},event:'push',head_branch:INPUT.controlledRef.slice(11),path:'.github/workflows/candidate.yml',actor:{id:INPUT.approverId},triggering_actor:{id:INPUT.approverId},status:'completed',conclusion:'success'};
  const approval=[{state:'approved',user:{id:INPUT.approverId},environments:[{id:INPUT.environmentId,name:INPUT.environment}]}];
  const jobs=[], success=name=>({name,status:'completed',conclusion:'success'});
  const add=(name,label,steps,signer=false)=>jobs.push({name,run_id:1,run_attempt:1,head_sha:expected.orchestration,status:'completed',conclusion:'success',runner_id:signer?INPUT.runnerId:900000,runner_group_id:signer?INPUT.runnerGroupId:1,runner_name:signer?'hara-desktop-release-Mac-mini-2':'GitHub Runner',labels:[label],steps:steps.map(success)});
  add('credential_preflight','self-hosted',['Original updater-file and background Developer ID preflight'],true);
  add('sign_apps','self-hosted',['Developer ID sign, notarize and staple exact native Apps'],true);
  add('sign_payloads','self-hosted',['Sign and notarize native DMGs; sign Linux/Windows updater payloads locally'],true);
  TARGETS.forEach((target,i)=>{const label=['macos-15','macos-15-intel','ubuntu-22.04','windows-latest'][i];
    add(`candidate-build-${target}`,label,['Original complete Core and Desktop tests plus renderer','Native sidecar boundary smoke and locked Rust tests','Complete formal native installer build including Intel DMG']);
    add(`candidate-verify-${target}`,label,['Native package smoke, signature verification and private old-version upgrade checks']);
    if(i<2)add(`candidate-dmg-${target}`,label,['Repackage the exact signed App into final DMG on its native CPU']);
  });
  return {run,jobs,approval,expected};
}
const verify=m=>checkRunMetadata(m.run,m.jobs,m.approval,m.expected);
test('real REST schema joins multi-phase native evidence to separate orchestration source',()=>assert.equal(verify(metadata()),true));
for(const [name,change] of Object.entries({ foreignSource:m=>m.run.head_sha='e'.repeat(40), foreignRepo:m=>m.run.head_repository.full_name='fork/repo', tag:m=>m.run.event='release', branch:m=>m.run.head_branch='main', fakeWorkflow:m=>m.run.path='build.yml',
  wrongActor:m=>m.run.triggering_actor.id=1, unapproved:m=>m.approval=[], rejected:m=>m.approval[0].state='rejected', staleAttempt:m=>m.expected.attempt=2, pending:m=>m.run.status='in_progress',
  oldJob:m=>m.jobs[0].run_attempt=0, wrongGroup:m=>m.jobs[0].runner_group_id=1, staleRunner:m=>m.jobs[0].runner_id=21, skippedTest:m=>m.jobs.find(j=>j.name.startsWith('candidate-build-')).steps[0].conclusion='skipped',
  missingIntelDmg:m=>m.jobs=m.jobs.filter(j=>j.name!=='candidate-dmg-x86_64-apple-darwin'), rosetta:m=>m.jobs.find(j=>j.name==='candidate-dmg-x86_64-apple-darwin').labels=['macos-15'],
  duplicated:m=>m.jobs.push({...m.jobs[0]}), incompleteWindows:m=>m.jobs.find(j=>j.name==='candidate-verify-x86_64-pc-windows-msvc').status='in_progress' })) {
  test(`independent run verifier rejects ${name}`,()=>{const m=metadata();change(m);assert.throws(()=>verify(m));});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { INPUT, ROOT } from '../scripts/candidate-common.mjs';
import { validateAdmission, readAdmission, PROOF_DIAGNOSTIC_LOOKBACK_SECONDS } from '../scripts/candidate-admission.mjs';
import { assertAttestationRun, assertLocalAdminEnvironment, initializeProofKey } from '../scripts/candidate-policy-admin.mjs';
import { proofExpectation, encodeProof, decodeProof, digest, proofFromComments, proofFailureMessage, PROOF_MARKER } from '../scripts/candidate-policy-proof.mjs';
const now=1735787045;
function policy() {
  return [{id:INPUT.environmentId,name:INPUT.environment,can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:INPUT.approverId}}]},{type:'branch_policy'}]},
    {total_count:1,branch_policies:[{id:INPUT.branchPolicyId,type:'branch',name:INPUT.controlledRef.slice(11)}]},
    {id:INPUT.rulesetId,enforcement:'active',target:'branch',source_type:'Repository',source:'hara-cli/hara-desktop',updated_at:'2025-01-02T03:04:05Z',bypass_actors:[{actor_id:INPUT.approverId,actor_type:'User',bypass_mode:'always'}],conditions:{ref_name:{include:[INPUT.controlledRef],exclude:[]}},rules:['creation','update','deletion','non_fast_forward'].map(type=>({type}))}];
}
function fixture() {
  const keys=generateKeyPairSync('ed25519'), anchor=digest(keys.publicKey.export({format:'der',type:'spki'}));
  const p=policy(), snapshot=validateAdmission(...p), expected=proofExpectation({runId:55,attempt:1,orchestration:'f'.repeat(40)});
  const payload={schema:1,kind:'hara-candidate-gate-a',issuerId:INPUT.approverId,repository:'hara-cli/hara-desktop',...expected,controlledRef:INPUT.controlledRef,
    policy:{environmentId:snapshot.environmentId,rulesetId:snapshot.rulesetId,policyId:snapshot.policyId,updatedAt:snapshot.updatedAt,publicSha256:snapshot.publicSha256,fullRulesetSha256:digest(p[2])},
    bypassActorsVerified:true,issuedAt:now,expiresAt:now+7200,nonce:'e832507a-7da6-42f8-933a-40d73b0f99d7'};
  const seal=value=>encodeProof(value,keys.privateKey), envelope=seal(payload);
  const comment={id:123,user:{id:INPUT.approverId,type:'User'},body:PROOF_MARKER+JSON.stringify(envelope),created_at:new Date(now*1000).toISOString(),updated_at:new Date(now*1000).toISOString(),issue_url:'https://api.github.com/repos/hara-cli/hara-desktop/issues/1',html_url:'https://github.com/hara-cli/hara-desktop/pull/1#issuecomment-123'};
  return {keys,anchor,p,snapshot,expected,payload,seal,envelope,comment};
}
test('plan A full admin and redacted Actions views have identical public fingerprint',()=>{
  const p=policy(), full=validateAdmission(...p); delete p[2].bypass_actors;
  assert.throws(()=>validateAdmission(...p)); assert.deepEqual(validateAdmission(...p,{requireBypass:false}),full);
});
test('redacted view alone never becomes a proof; valid pinned Ed25519 observation does',()=>{
  const f=fixture(); assert.equal(decodeProof(f.envelope,f.expected,f.snapshot,now,f.anchor).bypassActorsVerified,true);
  assert.throws(()=>proofFromComments([],f.expected,f.snapshot,now,f.anchor));
  assert.equal(proofFromComments([f.comment],f.expected,f.snapshot,now,f.anchor).commentId,123);
});
for(const [name,change] of Object.entries({ signature:e=>e.signature='A'.repeat(88), body:e=>e.body=Buffer.from('{}').toString('base64'), extraField:e=>e.fake=true, wrongSchema:e=>e.schema=2,
  unknownKey:e=>e.publicKey=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64') })) test(`proof rejects envelope ${name}`,()=>{const f=fixture();change(f.envelope);assert.throws(()=>decodeProof(f.envelope,f.expected,f.snapshot,now,f.anchor));});
for(const [name,change] of Object.entries({ runId:p=>p.runId++, attempt:p=>p.attempt++, orchestration:p=>p.orchestration='e'.repeat(40), application:p=>p.application='e'.repeat(40), core:p=>p.core='e'.repeat(40), input:p=>p.identity='e'.repeat(64), workflow:p=>p.workflowSha256='e'.repeat(64),
  wrongActor:p=>p.issuerId=1, foreignRepo:p=>p.repository='fork/hara-desktop', branch:p=>p.controlledRef='refs/heads/main', unsignedBypass:p=>p.bypassActorsVerified=false, expired:p=>p.expiresAt=now,
  future:p=>{p.issuedAt=now+600;p.expiresAt=now+700;}, excessiveLifetime:p=>p.expiresAt=now+7201, missingVersion:p=>delete p.policy.updatedAt, wrongPolicy:p=>p.policy.policyId++, wrongPublicHash:p=>p.policy.publicSha256='0'.repeat(64), extra:p=>p.allowPublish=true })) {
  test(`even a signed proof rejects ${name}`,()=>{const f=fixture();change(f.payload);assert.throws(()=>decodeProof(f.seal(f.payload),f.expected,f.snapshot,now,f.anchor));});
}
test('bypass-only server version change invalidates the old proof without revealing actors to Actions',()=>{
  const f=fixture(); delete f.p[2].bypass_actors; f.p[2].updated_at='2025-01-02T03:04:06Z';
  const fresh=validateAdmission(...f.p,{requireBypass:false}); assert.throws(()=>decodeProof(f.envelope,f.expected,fresh,now,f.anchor));
});
for(const [name,change] of Object.entries({ otherAuthor:c=>c.user.id=999, bot:c=>c.user.type='Bot', foreignIssue:c=>c.issue_url='https://api.github.com/repos/hara-cli/hara-desktop/issues/2', badUrl:c=>c.html_url='https://example.invalid', oldComment:c=>c.created_at='2020-01-01T00:00:00Z', lateEdit:c=>c.updated_at=new Date((now+3600)*1000).toISOString(), invalidJson:c=>c.body=PROOF_MARKER+'garbage' })) {
  test(`proof transport rejects ${name}`,()=>{const f=fixture();change(f.comment);assert.throws(()=>proofFromComments([f.comment],f.expected,f.snapshot,now,f.anchor));});
}
test('administrator helper refuses all Actions environments and a completed/wrong-source run',()=>{
  assertLocalAdminEnvironment({}); for(const e of [{GITHUB_ACTIONS:'true'},{ACTIONS_RUNTIME_TOKEN:'fake'},{GITHUB_RUN_ID:'55'}]) assert.throws(()=>assertLocalAdminEnvironment(e));
  const run={id:55,run_attempt:1,head_sha:'f'.repeat(40),event:'push',head_branch:INPUT.controlledRef.slice(11),actor:{id:INPUT.approverId},triggering_actor:{id:INPUT.approverId},repository:{full_name:'hara-cli/hara-desktop'},head_repository:{full_name:'hara-cli/hara-desktop'},path:'.github/workflows/candidate.yml',status:'in_progress'};
  assertAttestationRun(run,'f'.repeat(40)); assert.throws(()=>assertAttestationRun({...run,status:'completed'},'f'.repeat(40))); assert.throws(()=>assertAttestationRun(run,'e'.repeat(40)));
});
test('ephemeral proof key is private, never overwritten, and distinct from production material',t=>{
  // Unit fixture only: the production CLI always tests its actual process environment.
  const envKeys=['GITHUB_ACTIONS','ACTIONS_RUNTIME_TOKEN','GITHUB_RUN_ID'],saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
  for(const k of envKeys)delete process.env[k]; t.after(()=>{for(const k of envKeys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'candidate-proof-key-')));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  if(!process.getuid){assert.throws(()=>initializeProofKey(directory));assert(!fs.existsSync(path.join(directory,'policy-proof-key.pem')));return;}
  const result=initializeProofKey(directory); assert.match(result.publicKeySha256,/^[a-f0-9]{64}$/); assert.equal(Object.keys(result).length,1);
  const file=path.join(directory,'policy-proof-key.pem'); assert.equal(fs.statSync(file).mode&0o777,0o600); const before=digest(fs.readFileSync(file));
  assert.throws(()=>initializeProofKey(directory));assert.equal(digest(fs.readFileSync(file)),before);
});
test('public snapshot with no signed proof fails before any credentials, including wait-disabled invocation',async()=>{
  const p=policy();delete p[2].bypass_actors;
  const get=e=>e.startsWith('issues/')?[]:e.startsWith('rulesets/')?p[2]:e.endsWith('deployment-branch-policies')?p[1]:p[0];
  await assert.rejects(()=>readAdmission({expected:{runId:55,attempt:1,orchestration:'f'.repeat(40)},get,now:()=>now}),/valid administrator proof missing/);
});
test('end-to-end redacted Actions view accepts only the independently signed pinned proof',async()=>{
  const f=fixture();delete f.p[2].bypass_actors;
  const get=e=>e.startsWith('issues/')?[f.comment]:e.startsWith('rulesets/')?f.p[2]:e.endsWith('deployment-branch-policies')?f.p[1]:f.p[0];
  const result=await readAdmission({expected:f.expected,get,now:()=>now,anchor:f.anchor});
  assert.equal(result.administratorProof.commentId,123);assert.equal(result.publicSha256,f.snapshot.publicSha256);
  await assert.rejects(()=>readAdmission({expected:f.expected,get,now:()=>now,anchor:'0'.repeat(64)}));
});
test('late proof publication is awaited finitely without broadening credential permissions',async()=>{
  const f=fixture();delete f.p[2].bypass_actors;let polls=0,clock=now,waits=0;
  const get=e=>e.startsWith('issues/')?(++polls===1?[]:[f.comment]):e.startsWith('rulesets/')?f.p[2]:e.endsWith('deployment-branch-policies')?f.p[1]:f.p[0];
  const result=await readAdmission({expected:f.expected,get,now:()=>clock,anchor:f.anchor,waitForProof:true,wait:async()=>{clock+=15;waits++;}});
  assert.equal(result.administratorProof.commentId,123);assert.equal(waits,1);
});
test('missing proof reaches a finite deadline and never accepts the public snapshot by itself',async()=>{
  const f=fixture();delete f.p[2].bypass_actors;let clock=now,waits=0;
  const get=e=>e.startsWith('issues/')?[]:e.startsWith('rulesets/')?f.p[2]:e.endsWith('deployment-branch-policies')?f.p[1]:f.p[0];
  await assert.rejects(()=>readAdmission({expected:f.expected,get,now:()=>clock,waitForProof:true,wait:async()=>{clock+=15;waits++;}}),/valid administrator proof missing/);
  assert.equal(waits,INPUT.adminProof.waitSeconds/15);
});
// live28 STALE_PROOF_TTL_RACE: env approved hours after the bound proof's TTL elapsed.
const expiredMessage=/administrator proof EXPIRED[\s\S]*issuedAt=1735787045 [\s\S]*expiresAt=1735794245 [\s\S]*overdue=3600s[\s\S]*NOT policy-changed[\s\S]*NOT a codesign PEM\/Keychain\/updater-file\/Developer ID[\s\S]*Re-publish[\s\S]*never reuse the expired comment; no credential access$/;
test('expired but correctly bound proof is reported as TTL expiry, never authorizes',()=>{
  const f=fixture(), late=now+7200+3600;
  assert.throws(()=>decodeProof(f.envelope,f.expected,f.snapshot,late,f.anchor),/expired\/stale/);
  let caught; try { proofFromComments([f.comment],f.expected,f.snapshot,late,f.anchor); } catch(error) { caught=error; }
  assert(caught); assert.deepEqual(caught.diagnosis,{stale:[{commentId:123,url:f.comment.html_url,issuedAt:now,expiresAt:now+7200,now:late,overdueSeconds:3600}],policyChanged:0,otherBinding:0});
  assert.match(proofFailureMessage(caught.diagnosis),expiredMessage);
});
test('expiry wording requires a verified signature and full binding',()=>{
  const late=now+7200+3600, cases={ forged:f=>f.envelope.signature='A'.repeat(88), otherAttempt:f=>{f.payload.attempt++;f.envelope=f.seal(f.payload);},
    policyChanged:f=>{f.payload.policy.policyId++;f.envelope=f.seal(f.payload);}, otherAuthor:f=>f.comment.user.id=999 };
  const expectWording={forged:/proof missing \(no signed/,otherAttempt:/missing for this run\/attempt\/source/,policyChanged:/proof policy-changed/,otherAuthor:/proof missing \(no signed/};
  for(const [name,change] of Object.entries(cases)) {
    const f=fixture(); change(f); f.comment.body=PROOF_MARKER+JSON.stringify(f.envelope);
    let caught; try { proofFromComments([f.comment],f.expected,f.snapshot,late,f.anchor); } catch(error) { caught=error; }
    assert(caught,name); assert.equal(caught.diagnosis.stale.length,0,name);
    const message=proofFailureMessage(caught.diagnosis); assert.match(message,expectWording[name],name); assert.doesNotMatch(message,/EXPIRED/,name);
  }
});
test('wait-disabled preflight names an overnight-expired proof outside the authorizing window',async()=>{
  const f=fixture();delete f.p[2].bypass_actors;const late=now+7200+3600,windows=[];
  const get=e=>{ if(!e.startsWith('issues/')) return e.startsWith('rulesets/')?f.p[2]:e.endsWith('deployment-branch-policies')?f.p[1]:f.p[0];
    const since=Date.parse(decodeURIComponent(e.match(/since=([^&]+)/)[1]))/1000; windows.push(late-since);
    return Date.parse(f.comment.updated_at)/1000>=since?[f.comment]:[]; };
  await assert.rejects(()=>readAdmission({expected:f.expected,get,now:()=>late,anchor:f.anchor}),expiredMessage);
  assert.deepEqual(windows,[INPUT.adminProof.ttlSeconds+120,PROOF_DIAGNOSTIC_LOOKBACK_SECONDS]);
});
test('failed or overflowing diagnostic lookback stays fail-closed with the missing wording',async()=>{
  const f=fixture();let reads=0;
  const get=e=>e.startsWith('issues/')?(++reads===1?[]:Array(100).fill({})):e.startsWith('rulesets/')?f.p[2]:e.endsWith('deployment-branch-policies')?f.p[1]:f.p[0];
  await assert.rejects(()=>readAdmission({expected:f.expected,get,now:()=>now,anchor:f.anchor}),/valid administrator proof missing \(no signed[\s\S]*no credential access$/);
});
test('unbounded comment history is rejected rather than searched or silently truncated',async()=>{
  const f=fixture();let pages=0;
  const get=e=>e.startsWith('issues/')?(pages++,Array(100).fill({})):e.startsWith('rulesets/')?f.p[2]:e.endsWith('deployment-branch-policies')?f.p[1]:f.p[0];
  await assert.rejects(()=>readAdmission({expected:f.expected,get,now:()=>now}),/window overflow/);assert.equal(pages,10);
});
test('a public environment policy change invalidates a signed observation even without a ruleset timestamp change',()=>{
  const f=fixture();f.p[0].protection_rules[0].prevent_self_review=true;
  const changed=validateAdmission(...f.p);assert.throws(()=>decodeProof(f.envelope,f.expected,changed,now,f.anchor));
  for(const badVersion of [undefined,'not-a-date']){f.p[2].updated_at=badVersion;assert.throws(()=>validateAdmission(...f.p));}
});
test('candidate workflow only grants read scopes and cannot run the independent administrator writer',()=>{
  const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/candidate.yml'),'utf8');
  const permissions=workflow.match(/^permissions:\n((?:  .+\n)+)/m)?.[1];assert(permissions);
  assert.deepEqual(permissions.trim().split('\n').map(s=>s.trim()).sort(),['actions: read','contents: read','pull-requests: read']);
  assert.equal((workflow.match(/^\s*permissions:/gm)??[]).length,1);
  assert(!workflow.includes('candidate-policy-admin'));assert(!workflow.includes('write-all'));
  const signer=fs.readFileSync(path.join(ROOT,'scripts/candidate-signing.mjs'),'utf8');
  const hold=signer.indexOf("assert(!fs.existsSync(path.join(config.operationsDirectory, '.candidate-signing-ui-hold.json'))");
  assert(hold>0 && hold<signer.indexOf('await readAdmission()') && hold<signer.indexOf('bytes = readUpdaterKey(realHome)'));
});

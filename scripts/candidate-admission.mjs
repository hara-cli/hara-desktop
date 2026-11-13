import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { INPUT, ROOT, candidateEvidence, assertEvent, githubReadEnvironment } from './candidate-common.mjs';
import { digest, proofExpectation, proofFromComments, proofFailureMessage } from './candidate-policy-proof.mjs';
// Diagnosis-only lookback: long enough to name an overnight-expired proof; never used to authorize.
export const PROOF_DIAGNOSTIC_LOOKBACK_SECONDS = 86400;

export function validateAdmission(environment, policies, ruleset, { requireBypass = true } = {}) {
  assert.equal(environment.id, INPUT.environmentId); assert.equal(environment.name, INPUT.environment); assert.equal(environment.can_admins_bypass, false);
  assert.deepEqual(environment.deployment_branch_policy, { protected_branches:false, custom_branch_policies:true });
  const reviewers = environment.protection_rules.filter(r => r.type === 'required_reviewers'); assert.equal(reviewers.length,1);
  assert.deepEqual(reviewers[0].reviewers.map(r=>({type:r.type,id:r.reviewer.id})),[{type:'User',id:INPUT.approverId}]);
  assert(environment.protection_rules.some(r=>r.type==='branch_policy'));
  assert.equal(policies.total_count,1); assert.equal(policies.branch_policies.length,1);
  const policy=policies.branch_policies[0]; assert.equal(policy.id,INPUT.branchPolicyId); assert.equal(policy.type,'branch'); assert.equal(policy.name,INPUT.controlledRef.slice(11));
  assert.equal(ruleset.id,INPUT.rulesetId); assert.equal(ruleset.enforcement,'active'); assert.equal(ruleset.target,'branch');
  if(requireBypass || Object.hasOwn(ruleset,'bypass_actors')) assert.deepEqual(ruleset.bypass_actors,[{actor_id:INPUT.approverId,actor_type:'User',bypass_mode:'always'}]);
  assert.deepEqual(ruleset.conditions.ref_name,{include:[INPUT.controlledRef],exclude:[]});
  assert.deepEqual(ruleset.rules.map(r=>r.type).sort(),['creation','update','deletion','non_fast_forward'].sort());
  const updated = Date.parse(ruleset.updated_at); assert(Number.isFinite(updated) && updated>0,'ruleset version timestamp missing');
  assert.equal(ruleset.source_type,'Repository'); assert.equal(ruleset.source,'hara-cli/hara-desktop');
  const publicProjection={environment:{id:environment.id,name:environment.name,can_admins_bypass:environment.can_admins_bypass,
    deployment_branch_policy:environment.deployment_branch_policy,protection_rules:environment.protection_rules.map(r=>({type:r.type,
      ...(r.type==='required_reviewers'?{prevent_self_review:r.prevent_self_review,reviewers:r.reviewers.map(a=>({type:a.type,id:a.reviewer.id}))}:{})})).sort((a,b)=>a.type.localeCompare(b.type))},
    policies:policies.branch_policies.map(p=>({id:p.id,name:p.name,type:p.type})),ruleset:{id:ruleset.id,target:ruleset.target,enforcement:ruleset.enforcement,
      source:ruleset.source,source_type:ruleset.source_type,updated_at:new Date(updated).toISOString(),conditions:ruleset.conditions,rules:ruleset.rules}};
  const publicSha256=digest(publicProjection);
  return { environmentId:environment.id, rulesetId:ruleset.id, policyId:policy.id, updatedAt:new Date(updated).toISOString(), publicSha256, sha256:publicSha256 };
}
// Same fixed read-only GitHub GET capability as Actions api(); only the refusal label differs.
export function admissionGhEnvironment(parentEnv = process.env) {
  return githubReadEnvironment(parentEnv, 'candidate admission');
}
export const policyGet = endpoint => {
  assert(/^(?:environments\/hara-desktop-candidate(?:\/deployment-branch-policies)?|rulesets\/\d+|issues\/1\/comments\?[^\s]+)$/.test(endpoint));
  const scope = candidateEvidence(process.env), env = admissionGhEnvironment(process.env);
  return scope.guardSync(env, () => {
    const result = spawnSync('gh', ['api','--method','GET',`repos/hara-cli/hara-desktop/${endpoint}`],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    assert(result.status === 0 && !result.error && !result.signal,
      `candidate admission GitHub GET failed (${result.status ?? 'unknown'})`);
    try { return JSON.parse(result.stdout); }
    catch { throw Error('candidate admission: invalid GitHub policy response'); }
  });
};
export function readPolicySnapshot(get = policyGet) {
  return {environment:get(`environments/${INPUT.environment}`),policies:get(`environments/${INPUT.environment}/deployment-branch-policies`),ruleset:get(`rulesets/${INPUT.rulesetId}`)};
}
export async function readAdmission({expected = {runId:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),orchestration:process.env.GITHUB_SHA},
  waitForProof=false,get=policyGet,now=()=>Math.floor(Date.now()/1000),wait=ms=>new Promise(r=>setTimeout(r,ms)),anchor=INPUT.adminProof.publicKeySha256} = {}) {
  assert.equal(INPUT.adminProof.pullRequest,1); assert(INPUT.adminProof.ttlSeconds>=60 && INPUT.adminProof.ttlSeconds<=7200);
  assert(INPUT.adminProof.waitSeconds>=0 && INPUT.adminProof.waitSeconds<=240);
  const bound=proofExpectation(expected), deadline=now()+(waitForProof ? INPUT.adminProof.waitSeconds : 0);
  while(true) {
    const snapshot=readPolicySnapshot(get), policy=validateAdmission(snapshot.environment,snapshot.policies,snapshot.ruleset,{requireBypass:false});
    const readComments=lookback=>{
      const comments=[], since=encodeURIComponent(new Date((now()-lookback)*1000).toISOString());
      for(let page=1;page<=10;page++){const rows=get(`issues/${INPUT.adminProof.pullRequest}/comments?since=${since}&per_page=100&page=${page}`);assert(Array.isArray(rows));comments.push(...rows);if(rows.length<100)break;assert(page<10,'proof comment window overflow');}
      return comments;
    };
    const comments=readComments(INPUT.adminProof.ttlSeconds+120);
    let diagnosis;
    try { const proof=proofFromComments(comments,bound,policy,now(),anchor); return {...policy,administratorProof:{commentId:proof.commentId,url:proof.url,proofSha256:proof.proofSha256,
      issuedAt:proof.payload.issuedAt,expiresAt:proof.payload.expiresAt,fullRulesetSha256:proof.payload.policy.fullRulesetSha256}}; }
    catch(error) { diagnosis=error?.diagnosis; }
    if(!(waitForProof && now()<deadline)) {
      const known=diagnosis && (diagnosis.stale.length || diagnosis.policyChanged || diagnosis.otherBinding);
      // An aged-out comment falls outside the authorizing window; re-read wider only to name it.
      if(!known) try { proofFromComments(readComments(PROOF_DIAGNOSTIC_LOOKBACK_SECONDS),bound,policy,now(),anchor); }
        catch(error) { diagnosis=error?.diagnosis ?? diagnosis; }
      assert.fail(proofFailureMessage(diagnosis));
    }
    console.log('Waiting for independently signed administrator proof (no token escalation)'); await wait(15000);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) { assertEvent(process.env); console.log(JSON.stringify(await readAdmission({waitForProof:true}))); }

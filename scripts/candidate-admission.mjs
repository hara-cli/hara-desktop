import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { INPUT, sync, hash, assertEvent } from './candidate-common.mjs';

export function validateAdmission(environment, policies, ruleset) {
  assert.equal(environment.id, INPUT.environmentId); assert.equal(environment.name, INPUT.environment); assert.equal(environment.can_admins_bypass, false);
  assert.deepEqual(environment.deployment_branch_policy, { protected_branches:false, custom_branch_policies:true });
  const reviewers = environment.protection_rules.filter(r => r.type === 'required_reviewers'); assert.equal(reviewers.length,1);
  assert.deepEqual(reviewers[0].reviewers.map(r=>({type:r.type,id:r.reviewer.id})),[{type:'User',id:INPUT.approverId}]);
  assert(environment.protection_rules.some(r=>r.type==='branch_policy'));
  assert.equal(policies.total_count,1); assert.equal(policies.branch_policies.length,1);
  const policy=policies.branch_policies[0]; assert.equal(policy.id,INPUT.branchPolicyId); assert.equal(policy.type,'branch'); assert.equal(policy.name,INPUT.controlledRef.slice(11));
  assert.equal(ruleset.id,INPUT.rulesetId); assert.equal(ruleset.enforcement,'active'); assert.equal(ruleset.target,'branch');
  assert.deepEqual(ruleset.bypass_actors,[{actor_id:INPUT.approverId,actor_type:'User',bypass_mode:'always'}]);
  assert.deepEqual(ruleset.conditions.ref_name,{include:[INPUT.controlledRef],exclude:[]});
  assert.deepEqual(ruleset.rules.map(r=>r.type).sort(),['creation','update','deletion','non_fast_forward'].sort());
  return { environmentId:environment.id, rulesetId:ruleset.id, policyId:policy.id, sha256:hash(JSON.stringify({environment,policies,ruleset})) };
}
export function readAdmission() {
  const get = endpoint => JSON.parse(sync('gh',['api','--method','GET',`repos/hara-cli/hara-desktop/${endpoint}`]));
  return validateAdmission(get(`environments/${INPUT.environment}`), get(`environments/${INPUT.environment}/deployment-branch-policies`), get(`rulesets/${INPUT.rulesetId}`));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) { assertEvent(process.env); console.log(JSON.stringify(readAdmission())); }

// LOCAL ADMINISTRATOR ONLY. Never schedule/import this writer from Actions.
// Reads full rules with the existing local administrator CLI; publishes only a signed observation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { INPUT, sync, save } from './candidate-common.mjs';
import { validateAdmission, readPolicySnapshot } from './candidate-admission.mjs';
import { canonical, digest, encodeProof, proofExpectation, decodeProof, PROOF_MARKER } from './candidate-policy-proof.mjs';
import { assertLocalPreflight, orchestrationHead, LocalPreflightRefusal } from './candidate-local-aarch64-preflight.mjs';

export function assertLocalAdminEnvironment(e) {
  assert(e.GITHUB_ACTIONS!=='true' && !e.ACTIONS_RUNTIME_TOKEN && !e.GITHUB_RUN_ID,'administrator attestation cannot run in Actions');
}
export function privateDirectory(directory) {
  assert(path.isAbsolute(directory) && fs.realpathSync(directory)===directory);
  const st=fs.lstatSync(directory); assert(st.isDirectory() && !st.isSymbolicLink() && st.uid===process.getuid?.() && (st.mode&0o077)===0,'owned0700 private evidence directory required');
}
export function initializeProofKey(directory) {
  assertLocalAdminEnvironment(process.env); privateDirectory(directory);
  const keyPath=path.join(directory,'policy-proof-key.pem'); assert(!fs.existsSync(keyPath),'proof key already exists; never overwrite');
  const keys=generateKeyPairSync('ed25519'), pem=Buffer.from(keys.privateKey.export({format:'pem',type:'pkcs8'}));
  try { fs.writeFileSync(keyPath,pem,{flag:'wx',mode:0o600}); } finally { pem.fill(0); }
  const publicKeySha256=digest(keys.publicKey.export({format:'der',type:'spki'}));
  save(path.join(directory,'public-anchor.json'),{publicKeySha256,kind:'ephemeral-candidate-policy-proof',productionSigningKey:false});
  return {publicKeySha256};
}
export function assertAttestationRun(run, sha) {
  assert.equal(run.head_sha,sha); assert.equal(run.event,'push'); assert.equal(run.head_branch,INPUT.controlledRef.slice(11));
  assert.equal(run.actor.id,INPUT.approverId); assert.equal(run.triggering_actor.id,INPUT.approverId);
  assert.equal(run.repository.full_name,'hara-cli/hara-desktop'); assert.equal(run.head_repository.full_name,'hara-cli/hara-desktop');
  assert.equal(run.path.split('@')[0],'.github/workflows/candidate.yml');
  assert(['queued','in_progress','waiting','pending','requested'].includes(run.status),'do not attest a completed run');
  assert(Number.isSafeInteger(run.id) && run.id>0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt>0);
}
function get(endpoint) {
  assert(endpoint==='user' || /^repos\/hara-cli\/hara-desktop\/(?:environments\/hara-desktop-candidate(?:\/deployment-branch-policies)?|rulesets\/\d+|actions\/runs\/\d+)$/.test(endpoint));
  return JSON.parse(sync('gh',['api','--method','GET',endpoint]));
}
export async function attestRun(runId,directory,{publish=false}={}) {
  assertLocalAdminEnvironment(process.env); privateDirectory(directory); assert(Number.isSafeInteger(runId)&&runId>0);
  // Kick order: a green tip-bound local aarch64 receipt precedes every gh read or proof side effect.
  const local=orchestrationHead(); assertLocalPreflight({root:process.env.CANDIDATE_LOCAL_PREFLIGHT_ROOT,sha:local.sha,tree:local.tree});
  assert.equal(get('user').id,INPUT.approverId,'local administrator identity mismatch');
  const sha=sync('git',['rev-parse','HEAD']); assert.equal(sync('git',['status','--porcelain']),'','attestor must use clean reviewed orchestration checkout');
  assert.equal(sha,local.sha,'orchestration HEAD changed after local preflight check');
  const run=get(`repos/hara-cli/hara-desktop/actions/runs/${runId}`); assertAttestationRun(run,sha);
  const getPolicy=endpoint=>get(`repos/hara-cli/hara-desktop/${endpoint}`);
  const before=readPolicySnapshot(getPolicy), policy=validateAdmission(before.environment,before.policies,before.ruleset);
  const keyPath=path.join(directory,'policy-proof-key.pem'), st=fs.lstatSync(keyPath);
  assert(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.uid===process.getuid?.()&&(st.mode&0o777)===0o600 && st.size<4096,'unsafe proof key file');
  let bytes; let privateKey;
  try { bytes=fs.readFileSync(keyPath); privateKey=createPrivateKey(bytes); } finally { bytes?.fill(0); }
  assert.equal(digest(createPublicKey(privateKey).export({format:'der',type:'spki'})),INPUT.adminProof.publicKeySha256,'proof key differs from reviewed input anchor');
  const bound=proofExpectation({runId,attempt:run.run_attempt,orchestration:sha}), issuedAt=Math.floor(Date.now()/1000);
  const payload={schema:1,kind:'hara-candidate-gate-a',issuerId:INPUT.approverId,repository:'hara-cli/hara-desktop',...bound,controlledRef:INPUT.controlledRef,
    policy:{environmentId:policy.environmentId,rulesetId:policy.rulesetId,policyId:policy.policyId,updatedAt:policy.updatedAt,publicSha256:policy.publicSha256,fullRulesetSha256:digest(before.ruleset)},
    bypassActorsVerified:true,issuedAt,expiresAt:issuedAt+INPUT.adminProof.ttlSeconds,nonce:randomUUID()};
  const envelope=encodeProof(payload,privateKey); decodeProof(envelope,bound,policy,issuedAt);
  const after=readPolicySnapshot(getPolicy); validateAdmission(after.environment,after.policies,after.ruleset);
  assert.equal(canonical(before),canonical(after),'policy changed during independent administrator check');
  assertAttestationRun(get(`repos/hara-cli/hara-desktop/actions/runs/${runId}`),sha);
  const evidence=path.join(directory,`run-${runId}-attempt-${run.run_attempt}-${payload.nonce}`); fs.mkdirSync(evidence,{mode:0o700});
  save(path.join(evidence,'full-private-policy.json'),{before,after,run,payload}); // Never uploaded.
  const body=PROOF_MARKER+canonical(envelope), requestFile=path.join(evidence,'public-comment-request.json'); save(requestFile,{body});
  const result={runId,attempt:run.run_attempt,orchestration:sha,application:INPUT.desktop.commit,core:INPUT.core.commit,policyVersion:policy.updatedAt,proofSha256:digest(body),expiresAt:payload.expiresAt,published:false};
  if(publish) {
    // This is an approved local administrator write, never a candidate GITHUB_TOKEN write.
    const comment=JSON.parse(sync('gh',['api','--method','POST',`repos/hara-cli/hara-desktop/issues/${INPUT.adminProof.pullRequest}/comments`,'--input',requestFile]));
    assert.equal(comment.user.id,INPUT.approverId); assert.equal(comment.body,body);
    result.published=true; result.commentId=comment.id; result.url=comment.html_url;
  }
  save(path.join(evidence,'result.json'),result); return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [operation,first,second]=process.argv.slice(2);
    if(operation==='init') console.log(JSON.stringify(initializeProofKey(path.resolve(first))));
    else if(operation==='publish'||operation==='prepare') console.log(JSON.stringify(await attestRun(Number(first),path.resolve(second),{publish:operation==='publish'})));
    else throw Error('unknown administrator operation');
  } catch(error) {
    if(error instanceof LocalPreflightRefusal) console.error(error.message);
    console.error('Local candidate administrator attestation failed; no credential contents logged. Inspect retained private evidence.'); process.exitCode=1;
  }
}

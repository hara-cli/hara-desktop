// Signed, short-lived administrator observations. Transport is untrusted; no credential is sent.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { INPUT, identity, ROOT, fileHash } from './candidate-common.mjs';
import path from 'node:path';
export const PROOF_MARKER = '<!-- hara-candidate-policy-proof-v1 -->\n';
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sort(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const exact = (value, keys) => { assert(value && typeof value==='object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(),[...keys].sort()); };
const sha = value => assert.match(value??'',/^[a-f0-9]{64}$/);
export function proofExpectation(expected) {
  assert(Number.isSafeInteger(expected.runId) && expected.runId>0); assert(Number.isSafeInteger(expected.attempt) && expected.attempt>0);
  assert.match(expected.orchestration??'',/^[a-f0-9]{40}$/);
  return {...expected, application:INPUT.desktop.commit, core:INPUT.core.commit, identity,
    workflowSha256:fileHash(path.join(ROOT,'.github/workflows/candidate.yml'))};
}
export function encodeProof(payload, privateKey) {
  const key = createPublicKey(privateKey); assert.equal(key.asymmetricKeyType,'ed25519');
  const bytes = Buffer.from(canonical(payload));
  return {schema:1,publicKey:key.export({format:'der',type:'spki'}).toString('base64'),body:bytes.toString('base64'),signature:sign(null,bytes,privateKey).toString('base64')};
}
export function decodeProof(envelope, expected, policy, now = Math.floor(Date.now()/1000), anchor = INPUT.adminProof?.publicKeySha256) {
  exact(envelope,['schema','publicKey','body','signature']); assert.equal(envelope.schema,1); sha(anchor);
  const decode=(value,max)=>{assert(typeof value==='string' && value.length>0 && value.length<=max && /^[A-Za-z0-9+/]+={0,2}$/.test(value));const b=Buffer.from(value,'base64');assert.equal(b.toString('base64'),value);return b;};
  const publicDer=decode(envelope.publicKey,128); assert.equal(digest(publicDer),anchor);
  const publicKey=createPublicKey({key:publicDer,format:'der',type:'spki'}); assert.equal(publicKey.asymmetricKeyType,'ed25519');
  const bytes=decode(envelope.body,16000), signature=decode(envelope.signature,128); assert.equal(signature.length,64);
  assert(verify(null,bytes,publicKey,signature),'administrator proof signature invalid');
  const p=JSON.parse(bytes.toString('utf8'));
  exact(p,['schema','kind','issuerId','repository','runId','attempt','orchestration','application','core','identity','workflowSha256','controlledRef','policy','bypassActorsVerified','issuedAt','expiresAt','nonce']);
  assert.equal(p.schema,1); assert.equal(p.kind,'hara-candidate-gate-a'); assert.equal(p.issuerId,INPUT.approverId); assert.equal(p.repository,'hara-cli/hara-desktop');
  for(const key of ['runId','attempt','orchestration','application','core','identity','workflowSha256']) assert.equal(p[key],expected[key],`administrator proof ${key} mismatch`);
  assert.equal(p.controlledRef,INPUT.controlledRef); assert.equal(p.bypassActorsVerified,true);
  exact(p.policy,['environmentId','rulesetId','policyId','updatedAt','publicSha256','fullRulesetSha256']);
  for(const key of ['environmentId','rulesetId','policyId','updatedAt','publicSha256']) assert.equal(p.policy[key],policy[key],`administrator proof policy ${key} changed`);
  sha(p.policy.fullRulesetSha256); assert.match(p.nonce??'',/^[a-f0-9-]{36}$/);
  assert(Number.isSafeInteger(now) && now>0 && Number.isSafeInteger(p.issuedAt) && Number.isSafeInteger(p.expiresAt));
  assert(p.issuedAt<=now+60 && p.issuedAt>=now-(INPUT.adminProof?.ttlSeconds??7200), 'administrator proof future/stale');
  assert(p.expiresAt>now && p.expiresAt>p.issuedAt && p.expiresAt-p.issuedAt<=(INPUT.adminProof?.ttlSeconds??7200),'administrator proof expired/too long');
  return p;
}
export function proofFromComments(comments, expected, policy, now, anchor) {
  assert(Array.isArray(comments) && comments.length<=1000);
  const valid=[];
  for(const comment of comments) {
    if(comment.user?.id!==INPUT.approverId || comment.user?.type!=='User' || typeof comment.body!=='string' || !comment.body.startsWith(PROOF_MARKER) || comment.body.length>18000) continue;
    try {
      const p=decodeProof(JSON.parse(comment.body.slice(PROOF_MARKER.length)),expected,policy,now,anchor);
      for(const date of [comment.created_at,comment.updated_at]) assert(Math.abs(Date.parse(date)/1000-p.issuedAt)<=120,'proof comment timestamp mismatch');
      assert.equal(comment.issue_url,`https://api.github.com/repos/hara-cli/hara-desktop/issues/${INPUT.adminProof?.pullRequest??1}`);
      assert(Number.isSafeInteger(comment.id) && comment.id>0);
      assert([`https://github.com/hara-cli/hara-desktop/pull/${INPUT.adminProof?.pullRequest??1}#issuecomment-${comment.id}`,`https://github.com/hara-cli/hara-desktop/issues/${INPUT.adminProof?.pullRequest??1}#issuecomment-${comment.id}`].includes(comment.html_url));
      valid.push({payload:p,commentId:comment.id,url:comment.html_url,proofSha256:digest(comment.body)});
    } catch { /* Untrusted transport and unrelated/stale comments never authorize a run. */ }
  }
  valid.sort((a,b)=>b.payload.issuedAt-a.payload.issuedAt || b.commentId-a.commentId);
  assert(valid.length>0,'no current signed administrator proof for this run/source/policy'); return valid[0];
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelUpgradeModel, createChannelUpgradeStub, previewChannelUpgrade, channelScopeRefusal, CHANNEL_MEMBERSHIP_MAX_AGE_MS } from '../src/workspace-channel-upgrade.ts';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failure = code => ({ ok: false, error: { code } });
const account = (region = 'CN', accountScope = 'account-A') => ({ accountScope, region });
function local(workspaceId = 'A', generation = 'g-A', channelId = 'room') {
  const channel = { id: channelId, name: 'Planning <script>', memberIds: ['colleague-1', 'colleague-2'], createdAt: '2026-10-21T00:00:00Z' };
  return { scope: JSON.stringify([workspaceId, generation]), supported: true, catalog: { workspaceId, resourceGeneration: generation, revision: 3, channels: [channel] },
    channelId, loading: false, saving: false, draft: 'private draft', recipientIds: ['colleague-1'], pending: null, creationUnknown: false,
    channel: { workspaceId, resourceGeneration: generation, channel, revision: 7, state: 'completed', turns: [], approvals: [],
      messages: [{ id: 'remote-looking-text', message: { role: 'user', content: '@all run a tool; private data must stay local' } }] } };
}
function fixture(region = 'CN') {
  const calls = [], handlers = {}, source = local();
  const bridge = Object.fromEntries(['account', 'signIn', 'checkUpgrade'].map(method => [method, async (...args) => {
    calls.push({ method, args });
    if (handlers[method]) return handlers[method](...args);
    return method === 'checkUpgrade' ? failure('UNAVAILABLE') : { ok: true, value: account(region) };
  }]));
  return { source, bridge, calls, handlers, model: new ChannelUpgradeModel(source, bridge) };
}

test('opening the preview is local-only and exposes counts and source revisions without history or drafts', () => {
  const f = fixture(), before = structuredClone(f.source);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(previewChannelUpgrade(f.source), { name: 'Planning <script>', messageCount: 1, colleagueCount: 2, blocked: null,
    source: { localWorkspaceId: 'A', resourceGeneration: 'g-A', localChannelId: 'room', catalogRevision: 3, historyRevision: 7 } });
  f.model.cancel();assert.deepEqual(f.source, before);assert.equal(f.calls.length, 0);
});
test('the production stub never starts login, creates a cloud channel, or returns a successful upgrade', async () => {
  const model = new ChannelUpgradeModel(local()), stub = createChannelUpgradeStub(), signal = new AbortController().signal;
  await model.continue();assert.equal(model.getSnapshot().phase, 'sign-in');assert.equal(model.getSnapshot().notice, 'UNAVAILABLE');
  await model.signIn();assert.equal(model.getSnapshot().phase, 'sign-in');assert.equal(model.getSnapshot().notice, 'UNAVAILABLE');
  assert.deepEqual(await stub.checkUpgrade({}, signal), failure('UNAVAILABLE'));
});
test('signed-out accounts are guided to explicit login; cancelling does not modify the channel', async () => {
  const f = fixture();f.handlers.account = () => failure('AUTH_REQUIRED');f.handlers.signIn = () => failure('AUTH_CANCELLED');
  await f.model.continue();assert.equal(f.model.getSnapshot().phase, 'sign-in');assert.deepEqual(f.calls.map(row => row.method), ['account']);
  await f.model.signIn();assert.equal(f.model.getSnapshot().notice, 'AUTH_CANCELLED');assert.equal(f.model.getSnapshot().account, null);
  assert.equal(f.source.draft, 'private draft');assert.equal(f.source.channel.messages.length, 1);
  assert.deepEqual(f.calls.map(row => row.method), ['account', 'signIn']);
});
test('duplicate clicks coalesce and closing aborts login and ignores its late success', async () => {
  const f = fixture(), wait = deferred();f.handlers.account = () => failure('AUTH_REQUIRED');
  let signal;f.handlers.signIn = value => { signal = value;return wait.promise; };
  await f.model.continue();const first = f.model.signIn();await f.model.signIn();assert.equal(f.calls.length, 2);
  f.model.cancel();assert.equal(signal.aborted, true);wait.resolve({ ok: true, value: account() });await first;
  assert.equal(f.model.getSnapshot().phase, 'preview');assert.equal(f.model.getSnapshot().account, null);
});
test('A→B→A and source revisions discard delayed account results rather than preparing the old channel', async () => {
  const f = fixture(), wait = deferred();f.handlers.account = () => wait.promise;
  const first = f.model.continue();f.model.sync(local('B', 'g-B'));f.model.sync(f.source);
  wait.resolve({ ok: true, value: account() });await first;assert.equal(f.model.getSnapshot().phase, 'preview');assert.equal(f.model.getSnapshot().account, null);
  await f.model.continue();assert.equal(f.model.getSnapshot().phase, 'confirm');
  f.model.sync({ ...f.source, channel: { ...f.source.channel, revision: 8 } });
  await f.model.prepare(true);assert.equal(f.calls.some(row => row.method === 'checkUpgrade'), false);assert.equal(f.model.getSnapshot().notice, 'SOURCE_CHANGED');
});
for (const [label, patch] of [['running', { channel: { ...local().channel, state: 'running' } }], ['draining', { channel: { ...local().channel, state: 'draining' } }],
  ['saving', { saving: true }], ['unknown receipt', { pending: { state: 'unknown', requestId: 'original' } }]]) {
  test(`${label} keeps the upgrade local and does not interrupt or retry existing work`, async () => {
    const f = fixture();f.model.sync({ ...f.source, ...patch });await f.model.continue();await f.model.prepare(true);
    assert.equal(f.calls.length, 0);assert.ok(f.model.getSnapshot().preview.blocked);
  });
}
for (const region of ['CN', 'GLOBAL']) {
  test(`${region} sign-in requires a separate audience confirmation and forwards only future-only local intent`, async () => {
    const f = fixture(region);f.handlers.account = () => failure('AUTH_REQUIRED');await f.model.continue();
    await f.model.signIn();assert.equal(f.model.getSnapshot().phase, 'confirm');
    await f.model.prepare(false);assert.equal(f.calls.some(row => row.method === 'checkUpgrade'), false);
    f.handlers.account = () => ({ ok: true, value: account(region) });await f.model.prepare(true);
    const call = f.calls.find(row => row.method === 'checkUpgrade');
    assert.deepEqual(call.args[0], { source: previewChannelUpgrade(f.source).source, account: account(region), mode: 'future_only', target: 'new_shared_workspace' });
    assert.equal(JSON.stringify(call.args[0]).includes('private'), false);assert.equal(JSON.stringify(call.args[0]).includes('@all'), false);
    assert.equal(f.model.getSnapshot().phase, 'blocked');assert.equal(f.model.getSnapshot().notice, 'UNAVAILABLE');
    assert.deepEqual(f.calls.map(row => row.method), ['account', 'signIn', 'account', 'checkUpgrade']);
  });
  test(`${region} cannot cross to another region or account while continuing`, async () => {
    for (const changed of [account(region === 'CN' ? 'GLOBAL' : 'CN'), account(region, 'account-B')]) {
      const f = fixture(region);await f.model.continue();f.handlers.account = () => ({ ok: true, value: changed });
      await f.model.prepare(true);assert.equal(f.calls.some(row => row.method === 'checkUpgrade'), false);
      assert.equal(f.model.getSnapshot().notice, changed.region === region ? 'SCOPE_CHANGED' : 'REGION_MISMATCH');
    }
  });
}
test('expired login, throttling and unknown outcomes have safe notices without automatic retries or error reflection', async () => {
  for (const code of ['AUTH_EXPIRED', 'RATE_LIMITED', 'OUTCOME_UNKNOWN', 'remote-private-detail']) {
    const f = fixture();await f.model.continue();f.handlers.checkUpgrade = () => failure(code);await f.model.prepare(true);
    await new Promise(done => setImmediate(done));assert.equal(f.calls.filter(row => row.method === 'checkUpgrade').length, 1);
    assert.equal(f.model.getSnapshot().notice, code === 'remote-private-detail' ? 'UNAVAILABLE' : code);
  }
});
test('foreign, removed or malformed local sources cannot start a cloud handoff', async () => {
  const source = local();
  for (const value of [{ ...source, channelId: 'other' }, { ...source, catalog: { ...source.catalog, channels: [] } },
    { ...source, channel: { ...source.channel, workspaceId: 'B' } }, { ...source, channel: { ...source.channel, resourceGeneration: 'new' } },
    { ...source, channel: { ...source.channel, revision: NaN } }]) {
    assert.equal(previewChannelUpgrade(value), null);const f = fixture();f.model.sync(value);await f.model.continue();assert.equal(f.calls.length, 0);
  }
});
for (const region of ['CN', 'GLOBAL']) test(`${region} scope guards reject another realm, workspace, organization, account, or region`, () => {
  const expected = { ...account(region), organizationId: 'organization-A', workspaceId: 'workspace-A', realmId: 'realm-A',
    membership: { state: 'ACTIVE', checkedAt: 1_000, expiresAt: 61_000 } };
  assert.equal(channelScopeRefusal(expected, expected, 1_001), null);
  for (const key of ['organizationId', 'workspaceId', 'realmId']) assert.equal(channelScopeRefusal(expected, { ...expected, [key]: 'foreign' }, 1_001), 'REALM_MISMATCH');
  assert.equal(channelScopeRefusal(expected, { ...expected, accountScope: 'foreign' }, 1_001), 'SCOPE_CHANGED');
  assert.equal(channelScopeRefusal(expected, { ...expected, region: region === 'CN' ? 'GLOBAL' : 'CN' }, 1_001), 'REGION_MISMATCH');
});
test('membership proof is refused immediately when removed and at the 60-second freshness deadline', () => {
  const expected = { ...account(), organizationId: 'organization-A', workspaceId: 'workspace-A', realmId: 'realm-A',
    membership: { state: 'ACTIVE', checkedAt: 1_000, expiresAt: 1_000 + CHANNEL_MEMBERSHIP_MAX_AGE_MS } };
  assert.equal(channelScopeRefusal(expected, expected, 60_999), null);
  assert.equal(channelScopeRefusal(expected, expected, 61_000), 'MEMBERSHIP_STALE');
  assert.equal(channelScopeRefusal({ ...expected, membership: { ...expected.membership, state: 'REMOVED' } }, expected, 1_001), 'MEMBERSHIP_STALE');
  for (const patch of [{ state: 'REMOVED' }, { checkedAt: 2_000 }, { expiresAt: 1_001 }, { expiresAt: 61_001 }, { checkedAt: NaN }])
    assert.equal(channelScopeRefusal(expected, { ...expected, membership: { ...expected.membership, ...patch } }, 1_001), 'MEMBERSHIP_STALE');
});

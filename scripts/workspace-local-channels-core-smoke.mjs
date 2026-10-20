// Real local Core RPC + Desktop models. Memory credentials, deterministic Provider, no native App.
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { WorkspaceDevConnectionClient } from "../src/workspace-dev-rpc.ts";
import { WorkspaceLocalChannelsModel } from "../src/workspace-local-channels.ts";

const [core, evidence, expectedCore] = process.argv.slice(2);
assert.equal(core, "/Users/zhujianbo/work/projects/hara/.worktrees/redesign-channels-core-1.1.0");
assert.match(expectedCore ?? "", /^[a-f0-9]{40}$/);
assert.equal(fs.realpathSync(core), core); assert.equal(fs.realpathSync(evidence), evidence);
assert.equal(evidence.startsWith("/private/tmp/hara-redesign-channels-20261020/"), true);
assert.equal(fs.statSync(evidence).mode & 0o777, 0o700); assert.deepEqual(fs.readdirSync(evidence), []);
const git = args => { const result = childProcess.spawnSync("/usr/bin/git", ["-C", core, ...args], { encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } }); assert.equal(result.status, 0); return result.stdout.trim(); };
assert.equal(git(["rev-parse", "HEAD"]), expectedCore); assert.equal(git(["status", "--porcelain", "--untracked-files=no"]), "");
const root = join(evidence, "workspace"), home = join(evidence, "home");
fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(home, { mode: 0o700 });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: home, USERPROFILE: home, PATH: "/usr/bin:/bin", TMPDIR: "/private/tmp", HARA_UPDATE_CHECK: "0", NO_COLOR: "1" });
let forbiddenAttempts = 0;
const deny = () => { forbiddenAttempts++; throw new Error("Channel fixture forbids child processes and external network"); };
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[key] = deny;
const loopback = host => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
net.Socket.prototype.connect = function (...args) { const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === "object" ? normalized[0] : { port: normalized[0], host: typeof normalized[1] === "string" ? normalized[1] : "localhost" };
  if (!options || options.path || !loopback(options.host ?? "localhost") || !Number.isInteger(Number(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) return deny();
  return connect.apply(this, args);
};
globalThis.fetch = (input, options) => { const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || !loopback(url.hostname) || !url.port) return deny(); return fetch(input, options);
};
syncBuiltinESMExports();
const load = file => import(pathToFileURL(join(core, "dist", file)));
const [{ LocalWorkspaceHost }, { WorkspaceResources }, { MemoryCredentialVault }, { SYNTHETIC_CONNECTION }, { startLocalWorkspaceServe }] = await Promise.all([
  load("workspace/local-host.js"), load("workspace/resources.js"), load("workspace/credential-vault.js"), load("workspace/synthetic-provider.js"), load("serve/local-workspace.js"),
]);
const requests = [], vault = new MemoryCredentialVault();
const options = { mode: "workspace", credentialVault: vault, providerFactory(_connection, binding, context) { return { id: "openai", model: binding.model, async turn(args) {
  requests.push({ agentId: context.agent.agentId, body: context.objective, privateMarkerInContext: args.system.includes("PRIVATE_DM_ONLY") || JSON.stringify(args.history).includes("PRIVATE_DM_ONLY") });
  return { text: `${context.agent.identity.displayName}: ${context.objective}`, toolUses: [], stop: "end", usage: { input: 1, output: 1 } };
} }; } };
let setup, handle, client;
const usedPorts = [];
async function open() {
  handle = await startLocalWorkspaceServe({ host: "127.0.0.1", port: 0 }, { ...options, root, version: "1.0.2-local-channels" }); usedPorts.push(handle.port);
  client = new WorkspaceDevConnectionClient({ port: handle.port, token: handle.token, instanceId: randomUUID(), root, syntheticOnly: false, executionMode: "workspace" }, () => {});
  await client.initialize(handle.token); const main = new WorkspaceDevModel(client, undefined, false, "workspace");
  await main.loadDirectory(); await main.selectWorkspace(workspaceId);
  const channels = new WorkspaceLocalChannelsModel(main); await channels.bind(workspaceId, main.getSnapshot().workspace.resourceGeneration);
  return { main, channels };
}
async function close() { client?.close(); if (handle) await handle.close(); client = undefined; handle = undefined; }
async function until(check) { const end = Date.now() + 45000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 35)); } throw new Error("bounded local channel RPC wait"); }
let workspaceId, members, channelId, originalMessages;
try {
  setup = new LocalWorkspaceHost(root, options); await setup.initialize(); const workspace = setup.createWorkspace("Personal local channel fixture", setup.list().revision); workspaceId = workspace.workspaceId;
  setup.configureConnection(workspaceId, { ...SYNTHETIC_CONNECTION }, 0);
  const resources = new WorkspaceResources(setup.home, setup.catalog.resolve(workspaceId).scope); resources.initialize();
  members = Array.from({ length: 13 }, (_, i) => resources.agents.create({ username: `person-${i}`, profile: { displayName: `Colleague ${i + 1}` } }, resources.agents.list().revision).agentId);
  await setup.close(); setup = undefined;
  let { main, channels } = await open(); assert.equal(main.supportsLocalChannels(), true);
  channelId = await channels.create("Local planning", members); assert.ok(channelId); channels.setDraft("hello, everyone"); await channels.send(members);
  await until(async () => { await channels.refresh(); return channels.getSnapshot().channel?.state === "completed"; });
  const first = channels.getSnapshot().channel; assert.equal(first.channel.memberIds.length, 13); assert.equal(first.messages.filter(row => row.message.role === "assistant").length, 13);
  assert.equal(requests.length, 13); assert.equal(requests.some(row => row.privateMarkerInContext), false);
  const firstRequest = first.turns[0].id, base = { workspaceId, expectedGeneration: first.resourceGeneration };
  await client.request("workspace.channels.send", { ...base, channelId, message: "hello, everyone", requestId: firstRequest, recipientIds: members }); assert.equal(requests.length, 13);
  await assert.rejects(client.request("workspace.channels.send", { ...base, channelId, message: "no", requestId: randomUUID(), recipientIds: members, model: "injected" }), /unsupported/);
  await assert.rejects(client.request("workspace.channels.list", { ...base, expectedGeneration: randomUUID() }), /generation/);
  const wrong = await client.request("workspace.create", { label: "Other", expectedRevision: (await client.request("workspace.list", {})).revision });
  await assert.rejects(client.request("workspace.channels.snapshot", { workspaceId: wrong.workspaceId, expectedGeneration: wrong.resourceGeneration, channelId }), /not in this Workspace/);
  await main.selectAgent(members[0]); main.setDraft("PRIVATE_DM_ONLY"); await main.send();
  await until(async () => { await main.refresh(); return main.getSnapshot().workspace.conversation.state === "completed"; });
  assert.equal(requests.length, 14);
  await channels.select(channelId); channels.setDraft("one colleague, one reply"); await channels.send([members[1]]);
  await until(async () => { await channels.refresh(); return channels.getSnapshot().channel?.state === "completed"; });
  assert.equal(requests.length, 15); assert.equal(requests.at(-1).privateMarkerInContext, false);
  await channels.updateMembers("Renamed local planning", [members[1], members[2]]);
  originalMessages = channels.getSnapshot().channel.messages; assert.equal(originalMessages.some(row => JSON.stringify(row).includes("PRIVATE_DM_ONLY")), false);
  const beforeRestartCalls = requests.length; await close(); ({ main, channels } = await open()); await channels.select(channelId);
  assert.deepEqual(channels.getSnapshot().channel.messages, originalMessages); assert.equal(channels.getSnapshot().channel.channel.name, "Renamed local planning"); assert.equal(requests.length, beforeRestartCalls);
  assert.equal(forbiddenAttempts, 0);
  fs.writeFileSync(join(evidence, "local-channels-core.json"), JSON.stringify({ passed: true, coreSource: expectedCore, coreBase: "1.0.2", members: 13,
    realDesktopModelsAndCoreRpc: true, authenticationAndGenerationChecked: true, duplicateDoesNotReplay: true, workspaceAndDmIsolation: true,
    metadataAndHistoryRecoveredAfterServerRestart: true, participantChoice: true, mockModelRequests: requests.length, paidRequests: 0,
    credentialAdapter: "MemoryCredentialVault", osCredentialCalls: 0, childProcesses: 0, forbiddenAttempts, nativeAppAcceptance: false }, null, 2) + "\n", { mode: 0o600 });
} finally {
  await setup?.close(); await close(); const ports = [];
  for (const port of usedPorts) { const server = net.createServer(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); ports.push({ port, rebound: true }); }
  fs.writeFileSync(join(evidence, "cleanup.json"), JSON.stringify({ serversClosed: true, ports, forbiddenAttempts }, null, 2) + "\n", { mode: 0o600 });
}

// Offline Core host acceptance with dependency injection. This is NOT packaged/native acceptance.
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSyntheticTestVault, PINNED_CORE } from "./workspace-native-vault.mjs";
import { finishOwnedFixtureCleanup } from "./workspace-native-cleanup.mjs";
import { validateChannelSmokeScope } from "./local-channel-smoke-scope.mjs";

const [core, evidence] = process.argv.slice(2);
validateChannelSmokeScope(core, evidence, PINNED_CORE);
const git = args => {
  const result = childProcess.spawnSync("/usr/bin/git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", core, ...args], { encoding: "utf8", timeout: 5000,
    env: { PATH: "/usr/bin:/bin", HOME: evidence, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } });
  assert.equal(result.status, 0, "Cannot verify pinned Core source"); return result.stdout.trim();
};
assert.equal(git(["rev-parse", "HEAD"]), PINNED_CORE); assert.equal(git(["status", "--porcelain", "--untracked-files=no"]), "");
const root = join(evidence, "workspace"), home = join(evidence, "home");
for (const directory of [root, home]) fs.mkdirSync(directory, { mode: 0o700 });
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, { HOME: home, USERPROFILE: home, PATH: "/usr/bin:/bin", TMPDIR: "/private/tmp", HARA_UPDATE_CHECK: "0", NO_COLOR: "1" });
let forbiddenAttempts = 0;
const deny = () => { forbiddenAttempts++; throw new Error("Offline adapter fixture forbids child processes and external network connections"); };
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny;
// The governed Pi runtime uses an in-process loopback HTTP bridge even for its synthetic Provider.
const loopback = host => ["127.0.0.1", "::1", "[::1]", "localhost"].includes(host);
const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === "object" ? normalized[0] : { port: normalized[0], host: typeof normalized[1] === "string" ? normalized[1] : "localhost" };
  if (!options || options.path || !loopback(options.host ?? "localhost") || !Number.isInteger(Number(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) return deny();
  return connect.apply(this, args);
};
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || !loopback(url.hostname) || !url.port) return deny();
  return fetch(input, options);
};
syncBuiltinESMExports();
const { LocalWorkspaceHost } = await import(pathToFileURL(join(core, "dist/workspace/local-host.js")));
const { createWorkspaceSyntheticProvider, SYNTHETIC_CONNECTION } = await import(pathToFileURL(join(core, "dist/workspace/synthetic-provider.js")));
const vault = createSyntheticTestVault(), options = { mode: "workspace", credentialVault: vault.adapter, providerFactory: createWorkspaceSyntheticProvider };
const host = new LocalWorkspaceHost(root, options);
const write = (name, value) => fs.writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const until = async check => { const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const value = check(); if (value) return value; await new Promise(done => setTimeout(done, 20)); }
  throw new Error("Offline synthetic host did not settle"); };
let reopened;
try {
  await host.initialize();
  const workspace = host.createWorkspace("Offline synthetic adapter", host.list().revision), id = workspace.workspaceId, main = workspace.selectedAgentId;
  host.configureConnection(id, { ...SYNTHETIC_CONNECTION }, 0); host.select("fixture", id, host.list().revision);
  const hello = host.start("fixture", id, main, "hello", randomUUID()); await host.wait(hello.runId);
  assert.equal(host.snapshot(id).conversation.state, "completed");
  const create = host.start("fixture", id, main, "建立 Pi 同事 Coder", randomUUID());
  const card = await until(() => host.snapshot(id, main, "fixture").approvals[0]);
  host.answerApproval("fixture", id, card.id, true); await host.wait(create.runId);
  const colleague = host.snapshot(id).agents.find(row => row.kind === "colleague"); assert.ok(colleague);
  const delegated = host.start("fixture", id, main, "委派 Coder 生成 hello.md 並驗證", randomUUID()); await host.wait(delegated.runId);
  const before = host.snapshot(id, main, "fixture"); assert.equal(before.conversation.completion.state, "verified");
  const artifact = join(root, "project", id, "hello.md"); assert.equal(fs.readFileSync(artifact, "utf8"), "hello workspace\n");
  await host.close(); reopened = new LocalWorkspaceHost(root, options); await reopened.initialize();
  assert.deepEqual(reopened.snapshot(id, main, "fixture").conversation, before.conversation);
  const dm = reopened.start("fixture", id, colleague.agentId, "hello", randomUUID()); await reopened.wait(dm.runId);
  assert.equal(reopened.snapshot(id, colleague.agentId, "fixture").conversation.state, "completed");
  assert.equal(forbiddenAttempts, 0);
  write("offline-core-adapter.json", { passed: true, core: PINNED_CORE, adapter: vault.receipt,
    credentialFlow: true, humanApproval: true, colleague: true, privateChat: true, delegatedArtifactVerified: true,
    historyRecovered: "in-process host reopen with the same injected memory adapter; not a native cold restart",
    artifactSha256: createHash("sha256").update(fs.readFileSync(artifact)).digest("hex"), forbiddenProcessOrNetworkAttempts: forbiddenAttempts,
    packagedNativeAcceptance: false, paidRequests: 0 });
} finally {
  await finishOwnedFixtureCleanup([
    { name: "offline-host-cleanup", run: async () => { await Promise.all([host.close(), reopened?.close()]); return { hostsClosed: true }; } },
    { name: "synthetic-adapter-cleanup", run: () => vault.cleanup() },
  ], write);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { assertNoOptionalRuntimeFiles, assertPiOnlyConfiguration, assertPiRuntimeManifest } from "../scripts/check-runtime-distribution.mjs";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const directory = { revision: 1, executionMode: "workspace", syntheticOnly: false, activeWorkspaceId: null, workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, label: workspaceId, active: true, role: "owner" })) };
const snapshot = id => ({ workspaceId: id, label: id, selectedAgentId: "main", resourceGeneration: `generation-${id}`, executionMode: "workspace", syntheticOnly: false,
  agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
  connections: { revision: 0, defaultConnectionId: null, connections: [] }, approvals: [],
  conversation: { revision: 0, sessionId: "S", state: "completed", history: [], usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } } });
function fixture() {
  const calls = [], handlers = {};
  const model = new WorkspaceDevModel({ async request(method, params) { calls.push({ method, params }); if (handlers[method]) return handlers[method](params); if (method === "workspace.list") return directory; return snapshot(params.workspaceId); } }, () => "request-id", false, "workspace");
  return { model, calls, handlers };
}
test("formal entry is independent of Vite/DEV flags; legacy is native-selected rollback only", () => {
  const main = read("src/main.tsx"), entry = read("src/WorkspaceEntry.tsx"), native = read("src-tauri/src/lib.rs");
  assert.match(main, /<WorkspaceEntry/); assert.doesNotMatch(main, /VITE_HARA_WORKSPACE_DEV|const workspaceDev/);
  assert.match(entry, /invoke<string>\("workspace_entry_mode"\)/); assert.match(entry, /mode === "legacy"/); assert.match(entry, /lazy\(\(\) => import\("\.\/LegacyDesktopEntry"\)\)/);
  assert.doesNotMatch(main, /Preview|URLSearchParams|location\.|from "\.\/App"/);
  assert.match(read("src/LegacyDesktopEntry.tsx"), /lazy\(\(\) => import\("\.\/App"\)\)/);
  assert.doesNotMatch(entry, /import\.meta\.env|location\.|localStorage|<Legacy[^]*?catch/);
  assert.match(native, /None \| Some\("0"\) => Ok\("workspace"\)/); assert.match(native, /HARA_DESKTOP_LEGACY_ENTRY/);
  assert.match(native, /workspace_connection\(\)/); assert.match(native, /observe_owned_workspace_start\(&mut pending/);
});
test("isolated Core source override cannot enter a release/signing refresh", () => {
  const source = read("scripts/refresh-sidecar.sh");
  assert.match(source, /\[ "\$\{HARA_RELEASE_BUILD:-\}" != "1" \] \|\| \{ echo "error: Core path override is development-only"/);
  assert.ok(source.indexOf("Core path override is development-only") < source.indexOf('CLI="$(cd "$HARA_SIDECAR_CORE_DIR"'));
  assert.match(source, /\[\[ "\$HARA_SIDECAR_CORE_DIR" = \/\* \]\]/);
  assert.doesNotMatch(source, /HARA_SIDECAR_NO_SIGNING|local slice forbids signing/);
  const verify = source.indexOf('/usr/bin/codesign --verify "$binary_path"');
  const repair = source.indexOf('/usr/bin/codesign --force --sign - "$binary_path"');
  assert.ok(verify >= 0 && repair > verify, "retain the original verify-then-ad-hoc-repair path");
});
test("formal connection writes only explicit scope/generation and never puts the fake key in view state", async () => {
  const f = fixture(); await f.model.selectWorkspace("A");
  assert.equal(await f.model.configureConnection({ label: "Local fake", provider: "openai", baseURL: "http://127.0.0.1:1/v1", defaultModel: "fake", apiKey: "not-a-real-key" }), true);
  const call = f.calls.find(row => row.method === "workspace.connection.add"); assert.equal(call.params.workspaceId, "A"); assert.equal(call.params.expectedGeneration, "generation-A");
  assert.equal(JSON.stringify(f.model.getSnapshot()).includes("not-a-real-key"), false);
  assert.equal(f.calls.some(row => /synthetic|approved-key|config.set/.test(row.method)), false);
});
test("runtime approval remains pinned to the original scope and single explicit decision; stale views cannot send", async () => {
  const f = fixture(); await f.model.selectWorkspace("A");
  f.handlers["workspace.runtime.propose"] = () => ({ id: "card-id", runtimeId: "codex", label: "Codex", version: "1.2.3", sha256: "a".repeat(64), origin: "http://127.0.0.1:1234", maxBytes: 128, target: { platform: "darwin", arch: "arm64" } });
  const card = await f.model.proposeRuntime("codex"); assert.equal(f.calls.filter(row => row.method === "workspace.runtime.approve").length, 0);
  await f.model.selectWorkspace("B"); await assert.rejects(f.model.approveRuntime(card, true), { messageKey: "ws.notice.installScopeMismatch" });
  assert.equal(f.calls.filter(row => row.method === "workspace.runtime.approve").length, 0);
  await f.model.selectWorkspace("A"); await assert.rejects(f.model.approveRuntime(card, true), { messageKey: "ws.notice.installScopeMismatch" });
  const fresh = await f.model.proposeRuntime("codex"); await f.model.approveRuntime(fresh, false);
  const call = f.calls.find(row => row.method === "workspace.runtime.approve"); assert.deepEqual(call.params, { workspaceId: "A", expectedGeneration: "generation-A", proposalId: "card-id", approved: false });
  assert.equal(f.calls.filter(row => row.method === "workspace.runtime.approve").length, 1);
});
test("Pi-only package gate rejects obsolete native tools, optional dependency folders and false manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "hara-pi-inventory-"));
  try {
    assertPiOnlyConfiguration(JSON.parse(read("src-tauri/tauri.conf.json"))); assertNoOptionalRuntimeFiles(root);
    for (const name of ["opencode", "codex.exe", "claude", "hara-code-runtime", "opencode-darwin-arm64", "claude-agent-sdk"]) {
      const path = join(root, name); mkdirSync(path); assert.throws(() => assertNoOptionalRuntimeFiles(root), /unexpectedly/); rmSync(path, { recursive: true });
    }
    const manifest = { schemaVersion: 1, preinstalled: ["pi"], piSdkVersion: "1.1.0", optional: ["opencode", "codex", "claude"] }; assertPiRuntimeManifest(JSON.stringify(manifest));
    assert.throws(() => assertPiRuntimeManifest(JSON.stringify({ ...manifest, preinstalled: ["pi", "opencode"] })));
    assert.throws(() => assertPiOnlyConfiguration({ bundle: { externalBin: ["binaries/hara", "binaries/herdr", "binaries/hara-code-runtime"] } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

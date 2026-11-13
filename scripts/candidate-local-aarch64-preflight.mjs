// LOCAL OPERATOR ONLY. Before any controlled-ref kick or Gate A proof, the exact orchestration
// tip must pass the aarch64 native stages on this Mac. The receipt is a local fail-closed operator
// gate, not release or admission authority; hosted candidate.yml still builds every platform.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, INPUT, identity, assertToolchain, sourceDirectories, assertSources, nativeTarget, save,
  redactDiagnosticOutput } from './candidate-common.mjs';
import { provisionCiEvidence, withCiEnvironment } from './ci-evidence.mjs';

export const TARGET = 'aarch64-apple-darwin';
export const STAGES = ['hydrate', 'tests', 'sidecar', 'build'];
export const MAX_AGE_MS = 12 * 3600 * 1000;
const SKEW_MS = 5 * 60 * 1000, KIND = 'hara-local-aarch64-preflight';
const SCRIPT = 'scripts/candidate-local-aarch64-preflight.mjs';
export const receiptDirectory = root => path.join(root, 'tmp', 'local-aarch64-preflight-receipts');

// Refusal messages are operator guidance and never contain environment values.
export class LocalPreflightRefusal extends Error {
  constructor(reason, root) {
    super(`LOCAL AARCH64 PREFLIGHT REFUSED: ${reason}\n  run on an Apple Silicon Mac from the clean reviewed tip: `
      + `node ${SCRIPT} run ${root ?? '/absolute/private/preflight-evidence-root'}`);
    this.name = 'LocalPreflightRefusal';
  }
}
const refuse = (condition, reason, root) => { if (!condition) throw new LocalPreflightRefusal(reason, root); };

export function orchestrationHead(cwd = ROOT) {
  const git = args => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });
    assert(r.status === 0 && !r.error, `git ${args[0]} failed`); return r.stdout.trim();
  };
  return { sha: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), clean: git(['status', '--porcelain']) === '' };
}
export function assertNotActions(env = process.env) {
  refuse(env.GITHUB_ACTIONS !== 'true' && !env.ACTIONS_RUNTIME_TOKEN && !env.GITHUB_RUN_ID, 'local preflight, kick and proof paths cannot run in Actions');
}
export function assertLocalHost(env = process.env, platform = process.platform, arch = process.arch) {
  assertNotActions(env);
  refuse(platform === 'darwin' && arch === 'arm64', `native Apple Silicon host required (got ${platform}/${arch}; Rosetta/x64 refused)`);
}
function privateRoot(root) {
  refuse(typeof root === 'string' && path.isAbsolute(root) && path.normalize(root) === root, 'absolute canonical preflight evidence root required (CANDIDATE_LOCAL_PREFLIGHT_ROOT)', root);
  return root;
}

export function assertLocalPreflight({ root, sha, tree, now = Date.now(), io = fs, uid = process.getuid?.() } = {}) {
  privateRoot(root);
  refuse(/^[a-f0-9]{40}$/.test(sha ?? '') && /^[a-f0-9]{40}$/.test(tree ?? ''), 'exact orchestration HEAD/tree required', root);
  const directory = receiptDirectory(root);
  let st; try { st = io.lstatSync(directory); } catch { st = null; }
  refuse(st, `no local aarch64 receipt directory for HEAD ${sha}`, root);
  refuse(st.isDirectory() && !st.isSymbolicLink() && io.realpathSync(directory) === directory
    && (uid === undefined || st.uid === uid) && (uid === undefined || (st.mode & 0o077) === 0),
    'receipt directory must be an owned 0700 non-link directory', root);
  const stamps = io.readdirSync(directory).map(n => n.match(/^([a-f0-9]{40})-(\d{13})\.json$/)).filter(m => m?.[1] === sha).map(m => m[2]).sort();
  refuse(stamps.length > 0, `no green local aarch64 receipt for HEAD ${sha} (missing or SHA mismatch)`, root);
  const file = path.join(directory, `${sha}-${stamps.at(-1)}.json`), fst = io.lstatSync(file);
  refuse(fst.isFile() && !fst.isSymbolicLink() && fst.nlink === 1 && (uid === undefined || fst.uid === uid)
    && (uid === undefined || (fst.mode & 0o077) === 0) && fst.size < 65536, 'receipt must be an owned 0600 regular file', root);
  let r; try { r = JSON.parse(io.readFileSync(file, 'utf8')); } catch { r = null; }
  refuse(r?.schema === 1 && r.kind === KIND && r.result === 'pass', 'receipt is not a passing local aarch64 preflight', root);
  refuse(r.orchestration === sha && r.tree === tree, `receipt bound to ${r.orchestration}/${r.tree}, not HEAD ${sha}/${tree}`, root);
  refuse(r.identity === identity && r.application === INPUT.desktop.commit && r.core === INPUT.core.commit,
    'receipt candidate inputs (identity/application/core) differ from this checkout', root);
  refuse(r.target === TARGET && r.host?.platform === 'darwin' && r.host?.arch === 'arm64', 'receipt is not from a native aarch64 host', root);
  refuse(Array.isArray(r.stages) && r.stages.map(s => s.name).join() === STAGES.join() && r.stages.every(s => s.status === 'pass'),
    `receipt must record passing stages ${STAGES.join(' → ')}`, root);
  const finished = Date.parse(r.finishedAt);
  refuse(Number.isFinite(finished) && finished <= now + SKEW_MS, 'receipt finish time is invalid or in the future', root);
  refuse(now - finished <= MAX_AGE_MS, `receipt is stale (finished ${r.finishedAt}; max ${MAX_AGE_MS / 3600000}h)`, root);
  return { file, finishedAt: r.finishedAt, orchestration: sha, tree };
}

export async function runPreflight(root, deps = {}) {
  const env = deps.env ?? process.env, head = (deps.head ?? orchestrationHead)();
  assertLocalHost(env, deps.platform, deps.arch); privateRoot(root);
  refuse(head.clean, 'orchestration checkout must be clean (the receipt binds exact HEAD)', root);
  const stages = deps.stages ?? await import('./candidate-native.mjs');
  const startedAt = new Date().toISOString();
  const output = path.join(root, 'tmp', `local-aarch64-preflight-${head.sha.slice(0, 12)}-${Date.now()}`);
  const provisioned = provisionCiEvidence({ evidenceRoot: root, output, env });
  return withCiEnvironment(provisioned, async ctx => {
    const step = (name, operation) => {
      try { return operation(); } catch (error) {
        if (error instanceof LocalPreflightRefusal) throw error;
        const detail = redactDiagnosticOutput(String(error?.message ?? error), env).replace(/\s+/g, ' ').slice(0, 400);
        throw new LocalPreflightRefusal(`${name} check failed before stages: ${detail}`, root);
      }
    };
    step('pinned toolchain (node/bun/rustc per candidate-inputs.json)', () => (deps.assertToolchain ?? assertToolchain)());
    refuse((deps.nativeTarget ?? nativeTarget)() === TARGET, 'toolchain host target must be aarch64-apple-darwin', root);
    const { desktop, core } = step('pinned application/Core sources (CANDIDATE_DESKTOP_DIR/CANDIDATE_CORE_DIR at INPUT commits, clean, locks)', () => {
      const d = (deps.sourceDirectories ?? sourceDirectories)(); (deps.assertSources ?? assertSources)(d.desktop, d.core); return d;
    });
    const c = { desktop, core, base: ctx.base, target: TARGET, env: ctx.env, evidenceRoot: root, cleanup: 'keep', deletionEnabled: false };
    const results = [];
    for (const name of STAGES) {
      const stageStarted = new Date().toISOString();
      console.error(`local aarch64 preflight: ${name} (logs: ${ctx.base})`);
      try { await stages[name](c); }
      catch (error) {
        const detail = redactDiagnosticOutput(String(error?.message ?? error), env).slice(0, 800);
        throw new LocalPreflightRefusal(`stage ${name} failed for HEAD ${head.sha}: ${detail}\n  evidence/logs: ${ctx.base}`, root);
      }
      results.push({ name, status: 'pass', startedAt: stageStarted, finishedAt: new Date().toISOString() });
    }
    const after = (deps.head ?? orchestrationHead)();
    refuse(after.sha === head.sha && after.tree === head.tree && after.clean, 'orchestration HEAD or tree changed during preflight', root);
    const finishedAt = new Date(), directory = receiptDirectory(root);
    const r = { schema: 1, kind: KIND, result: 'pass', orchestration: head.sha, tree: head.tree, identity,
      application: INPUT.desktop.commit, core: INPUT.core.commit, target: TARGET,
      host: { platform: deps.platform ?? process.platform, arch: deps.arch ?? process.arch, node: process.versions.node },
      toolchain: INPUT.toolchain, stages: results, startedAt, finishedAt: finishedAt.toISOString(), output: ctx.base,
      publicationAuthorized: false, admissionAuthority: false };
    const file = path.join(directory, `${head.sha}-${finishedAt.getTime()}.json`); save(file, r);
    return { file, ...r };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation, root] = process.argv.slice(2);
  try {
    if (operation === 'run') console.log(JSON.stringify(await runPreflight(root)));
    else if (operation === 'check') { const head = orchestrationHead(); console.log(JSON.stringify(assertLocalPreflight({ root, sha: head.sha, tree: head.tree }))); }
    else throw new LocalPreflightRefusal(`unknown operation ${JSON.stringify(operation)} (use run|check)`, root);
  } catch (error) {
    console.error(error instanceof LocalPreflightRefusal ? error.message : `LOCAL AARCH64 PREFLIGHT FAILED: ${redactDiagnosticOutput(String(error?.message ?? error), process.env).slice(0, 800)}`);
    process.exitCode = 1;
  }
}

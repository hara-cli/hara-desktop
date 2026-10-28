// LOCAL OPERATOR ONLY. The sole reviewed kick path: fast-forward the controlled candidate ref to
// the clean reviewed HEAD after its local aarch64 preflight is green. Never forces, never pushes tags.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, INPUT } from './candidate-common.mjs';
import { assertNotActions, assertLocalPreflight, orchestrationHead, LocalPreflightRefusal } from './candidate-local-aarch64-preflight.mjs';

const REMOTE = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)hara-cli\/hara-desktop(?:\.git)?$/;
const USAGE = 'usage: candidate-controlled-ref-push.mjs PREFLIGHT_EVIDENCE_ROOT --confirm-kick <HEAD sha> [--remote origin] [--dry-run]';

function defaultGit(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.error ? null : r.status, stdout: (r.stdout ?? '').trim() };
}
export function parseArgs(argv) {
  const o = { remote: 'origin', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--confirm-kick' || a === '--remote') o[a === '--remote' ? 'remote' : 'confirm'] = argv[++i];
    else if (!a.startsWith('-') && o.root === undefined) o.root = a;
    else throw new LocalPreflightRefusal(`unexpected argument ${JSON.stringify(a)}; ${USAGE}`);
  }
  return o;
}
export function pushControlledRef(options, deps = {}) {
  const git = deps.git ?? defaultGit, { root, confirm, remote = 'origin', dryRun = false } = options;
  const ok = (args, reason) => { const r = git(args); if (r.status !== 0) throw new LocalPreflightRefusal(reason, root); return r.stdout; };
  assertNotActions(deps.env ?? process.env);
  const head = (deps.head ?? orchestrationHead)();
  if (!head.clean) throw new LocalPreflightRefusal('orchestration checkout must be clean before a kick', root);
  if (confirm !== head.sha) throw new LocalPreflightRefusal(`--confirm-kick must equal the exact HEAD ${head.sha}; ${USAGE}`, root);
  assertLocalPreflight({ root, sha: head.sha, tree: head.tree, ...(deps.preflight ?? {}) });
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || !REMOTE.test(ok(['remote', 'get-url', '--push', remote], `remote ${remote} missing`)))
    throw new LocalPreflightRefusal(`remote ${remote} must push to hara-cli/hara-desktop`, root);
  const ref = INPUT.controlledRef, listed = ok(['ls-remote', '--refs', remote, ref], 'cannot read the controlled ref');
  const tip = listed.match(/^([a-f0-9]{40})\t(\S+)$/);
  if (!tip || tip[2] !== ref) throw new LocalPreflightRefusal(`controlled ref ${ref} must already exist exactly once on ${remote}`, root);
  if (tip[1] === head.sha) throw new LocalPreflightRefusal(`controlled ref already at ${head.sha}; a same-SHA push cannot kick a new run`, root);
  if (git(['cat-file', '-e', `${tip[1]}^{commit}`]).status !== 0) ok(['fetch', '--no-tags', remote, ref], 'cannot fetch the controlled ref tip');
  if (git(['merge-base', '--is-ancestor', tip[1], head.sha]).status !== 0)
    throw new LocalPreflightRefusal(`HEAD ${head.sha} does not fast-forward controlled tip ${tip[1]}; force is never used`, root);
  const push = ['push', '--porcelain', '--no-follow-tags', remote, `${head.sha}:${ref}`];
  if (dryRun) return { dryRun: true, from: tip[1], to: head.sha, ref, command: ['git', ...push] };
  ok(push, 'fast-forward push of the controlled ref failed');
  return { dryRun: false, from: tip[1], to: head.sha, ref };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(pushControlledRef(parseArgs(process.argv.slice(2))))); }
  catch (error) { console.error(error instanceof LocalPreflightRefusal ? error.message : 'controlled-ref push failed'); process.exitCode = 1; }
}

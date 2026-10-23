// Ordinary hosted CI smoke. No candidate context, production credentials, signing or publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readJson, sync, run, nativeTarget, assertNoRosettaProbe } from './candidate-common.mjs';
import { spawnSync } from 'node:child_process';
import { hydrateCore } from './candidate-native.mjs';
import { provisionCiEvidence, withCiEnvironment } from './ci-evidence.mjs';

export async function corePlatformSmoke({ core, ...options } = {}, dependencies = {}) {
  assert(typeof core === 'string' && path.isAbsolute(core), 'exact absolute Core checkout required');
  const c = provisionCiEvidence(options), target = (dependencies.nativeTarget ?? nativeTarget)();
  return withCiEnvironment(c, async () => {
    const command = dependencies.sync ?? sync, json = dependencies.readJson ?? readJson;
    assert.equal(command('git', ['rev-parse', 'HEAD'], { cwd: core, env: c.env }),
      fs.readFileSync(path.join(ROOT, 'src-tauri/binaries/SIDECAR_COMMIT'), 'utf8').trim());
    assert.equal(json(path.join(core, 'package.json')).version,
      fs.readFileSync(path.join(ROOT, 'src-tauri/binaries/SIDECAR_VERSION'), 'utf8').trim());
    if ((dependencies.platform ?? process.platform) === 'darwin' && (dependencies.arch ?? process.arch) === 'x64')
      assertNoRosettaProbe((dependencies.spawnSync ?? spawnSync)('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], { encoding: 'utf8', env: c.env }));
    await (dependencies.hydrateCore ?? hydrateCore)({ core, target, env: c.env });
    const execute = dependencies.run ?? run;
    await execute('Compile exact Core for native optional-dependency smoke', 'bash', ['-c', 'exec npm run build'], { cwd: core, env: c.env });
    await execute('Exercise exact Core search without a model or network', process.execPath,
      [path.join(ROOT, 'scripts/core-search-smoke.mjs'), core, path.join(c.base, 'search')],
      { env: c.env, capture: true, logFile: path.join(c.base, 'search.log') });
    assert.equal(command('git', ['status', '--porcelain'], { cwd: core, env: c.env }), '');
    return { evidenceRoot: c.evidenceRoot, output: c.base, cleanup: 'keep', deletionEnabled: false };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await corePlatformSmoke({ core: process.argv[2], output: process.argv[3] ?? process.env.CANDIDATE_OUTPUT_DIR });

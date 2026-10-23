// Ordinary CI only: reproduce the original full suite with explicit retained evidence.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, run, assertToolchain } from './candidate-common.mjs';
import { provisionCiEvidence, withCiEnvironment } from './ci-evidence.mjs';

export async function runRegression(options = {}, dependencies = {}) {
  const c = provisionCiEvidence(options);
  return withCiEnvironment(c, async () => {
    (dependencies.assertToolchain ?? assertToolchain)();
    await (dependencies.run ?? run)('Ordinary CI original full suite', 'bash', ['-c', 'exec npm test'],
      { cwd: ROOT, env: c.env, capture: true, logFile: path.join(c.base, 'tests.log') });
    return { evidenceRoot: c.evidenceRoot, output: c.base, cleanup: 'keep', deletionEnabled: false };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await runRegression({ output: process.argv[2] ?? process.env.CANDIDATE_OUTPUT_DIR });

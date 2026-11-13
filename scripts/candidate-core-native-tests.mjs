// Intel Mac candidate Core full suite. Runs as a scrubbed child with cwd = pinned Core; node builtins only.
// Same prelude, files, isolation, concurrency and case deadlines as Core `native-ci-tests.mjs --original-deadlines`.
// Two measured Intel-runner differences (live32, docs/ERROR-LOG.md) are handled without skips or retries:
//  1. Core's own reviewed INTEL_SLOW_FILES keep a bounded 300s FILE deadline (Intel/ARM 1.8-3.1x on durable
//     fsync fixtures); HARA_INTEL_TEST_BUDGET stays unset so every case/product deadline is unchanged.
//  2. The VM's first-ever Chromium launch is primed through Core's own PDF renderer before the suite.
//     The product's 60s PDF budget is unchanged; a failed warm-up is logged, never a pass.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const INTEL_SLOW_FILE_TIMEOUT_MS = 300000;
export const ORIGINAL_FILE_TIMEOUT_MS = 120000;
export const DEADLINES = "intel-slow-file-300s-v1";
const WARM_HTML = "<!doctype html><meta charset=utf-8><title>warm</title><p>Hara candidate browser warm-up</p>";

/** Core's x64 batches with only the named slow files above 120s; anything else is a refused drift. */
export function intelFileBudgetBatches(runner, slowFiles, files) {
  const strict = runner.strictNativeTestBatches(files, "x64"), batches = runner.nativeTestBatches(files, "x64");
  assert.equal(batches.length, strict.length, "Intel batches must match strict batches");
  batches.forEach((batch, index) => {
    const { timeout, ...shape } = batch, { timeout: strictTimeout, ...strictShape } = strict[index];
    assert.deepEqual(shape, strictShape, "Intel batches may differ from strict batches only by file deadline");
    assert.equal(strictTimeout, ORIGINAL_FILE_TIMEOUT_MS);
    if (batch.slow) {
      assert.deepEqual([...batch.files].sort(), files.filter(file => slowFiles.includes(file)).sort(), "slow batch must be Core's named Intel files");
      assert.equal(timeout, INTEL_SLOW_FILE_TIMEOUT_MS, "Intel slow-file budget must stay bounded at 300s");
      assert.equal(batch.concurrency, 1);
    } else assert.equal(timeout, ORIGINAL_FILE_TIMEOUT_MS, "ordinary and isolated files keep the original 120s deadline");
  });
  return batches;
}

/** Bounded, non-fatal first-launch priming. Each attempt is bounded by Core's own render budget. */
export async function warmHeadlessBrowser({ find, render, log = console.log, now = Date.now, attempts = 2 }) {
  if (!find()) { log("Intel browser warm-up: no Chromium-family browser; PDF cases follow Core's own skip rule"); return []; }
  const results = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = now();
    try {
      await render(WARM_HTML, 1);
      results.push({ attempt, ok: true, ms: now() - started });
      log(`Intel browser warm-up attempt ${attempt}: rendered in ${now() - started}ms`);
      break;
    } catch (error) {
      results.push({ attempt, ok: false, ms: now() - started });
      log(`Intel browser warm-up attempt ${attempt}: ${String(error?.message ?? error)} after ${now() - started}ms`);
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.platform === "darwin" && process.arch === "x64", "real Intel Mac candidate runner only");
  assert.equal(process.argv.length, 2, "no test-only overrides");
  const core = process.cwd(), load = file => import(pathToFileURL(join(core, file)).href);
  const runner = await load("scripts/native-ci-tests.mjs"), budget = await load("scripts/intel-ci-test-budget.mjs");
  for (const name of ["nativeTestBatches", "strictNativeTestBatches", "runNativeTestGroups"])
    assert.equal(typeof runner[name], "function", `pinned Core runner must export ${name}`);
  assert(Array.isArray(budget.INTEL_SLOW_FILES), "pinned Core must name its Intel slow files");
  const execute = (args, env = process.env) => {
    const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };
  const run = args => { const code = execute(args); if (code !== 0) process.exit(code); };
  run(["node_modules/typescript/bin/tsc"]);
  run(["scripts/normalize-dist-modes.mjs"]); run(["scripts/check-local-bin-link.mjs"]);
  run(["scripts/evaluate-feedback-traces.mjs"]);
  const [{ renderPresentationPdf }, { findHeadlessBrowser }] = await Promise.all([load("dist/presentations/pdf.js"), load("dist/tools/headless-web.js")]);
  await warmHeadlessBrowser({ find: () => findHeadlessBrowser(), render: renderPresentationPdf });
  const files = readdirSync("test").filter(file => file.endsWith(".test.mjs")).sort();
  const batches = intelFileBudgetBatches(runner, budget.INTEL_SLOW_FILES, files);
  console.log(`Intel candidate deadlines ${DEADLINES}: ${batches.filter(b => b.slow).flatMap(b => b.files).length} named slow files at ${INTEL_SLOW_FILE_TIMEOUT_MS}ms; all other files ${ORIGINAL_FILE_TIMEOUT_MS}ms; case deadlines original`);
  const env = { ...process.env }; delete env.HARA_INTEL_TEST_BUDGET;
  process.exitCode = runner.runNativeTestGroups(batches, "x64", { run: execute, env });
}

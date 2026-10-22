import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const clean = { stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }), exitCode: 0 };
function audit(t, steps, settings = {}) {
  const directory = mkdtempSync(join(tmpdir(), "hara-audit-fixture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = join(directory, "calls.json"), responses = join(directory, "responses.json"), runner = join(directory, "npm-fixture.mjs");
  writeFileSync(responses, JSON.stringify(steps));
  writeFileSync(runner, `import fs from "node:fs";
const file = process.env.HARA_TEST_AUDIT_CALLS;
const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
calls.push(process.argv.slice(2)); fs.writeFileSync(file, JSON.stringify(calls));
const steps = JSON.parse(fs.readFileSync(process.env.HARA_TEST_AUDIT_RESPONSES, "utf8"));
const response = steps[Math.min(calls.length - 1, steps.length - 1)];
process.stdout.write(response.stdout ?? ""); process.stderr.write(response.stderr ?? "");
process.exit(response.exitCode ?? 1);
`);
  const fakeNpm = join(directory, "npm");
  writeFileSync(fakeNpm, '#!/usr/bin/env bash\nexec node "$HARA_TEST_AUDIT_RUNNER" "$@"\n');
  chmodSync(fakeNpm, 0o755);
  const result = spawnSync(process.platform === "win32" ? "bash" : "/bin/bash", [join(root, "scripts/npm-audit-retry.sh")], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, HARA_TEST_AUDIT_CALLS: calls,
      HARA_TEST_AUDIT_RESPONSES: responses, HARA_TEST_AUDIT_RUNNER: runner,
      HARA_NPM_AUDIT_ATTEMPTS: "2", HARA_NPM_AUDIT_RETRY_DELAY_SECONDS: "0", ...settings },
  });
  assert.ifError(result.error);
  return { ...result, calls: existsSync(calls) ? JSON.parse(readFileSync(calls, "utf8")) : [] };
}

test("audit uses npm 11, the official registry, fetch deadlines and unchanged production severity coverage", t => {
  const result = audit(t, [clean]); assert.equal(result.status, 0, result.stderr); assert.equal(result.calls.length, 1);
  const args = result.calls[0], split = args.indexOf("--");
  assert.equal(args[0], "exec"); assert(args.includes("--package=npm@11")); assert(split > 0);
  assert.deepEqual(args.slice(split + 1, split + 3), ["npm", "audit"]);
  for (const command of [args.slice(0, split), args.slice(split + 1)]) {
    assert(command.includes("--fetch-timeout=180000")); assert(command.includes("--fetch-retries=0"));
    assert(command.includes("--registry")); assert(command.includes("https://registry.npmjs.org/"));
  }
  assert(args.slice(0, split).includes("--audit=false"), "CLI installation must not trigger the old implicit audit");
  assert(args.slice(split + 1).includes("--audit=true"), "the production audit must remain explicitly enabled");
  assert.equal(args.slice(split + 1).includes("--audit=false"), false);
  assert(args.includes("--omit=dev")); assert(args.includes("--json"));
  assert.equal(args.some(arg => /audit-level|no-audit|ignore-scripts/.test(arg)), false);
});

for (const code of ["EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "E429"]) {
  test(`audit retries a confirmed ${code} once and then accepts a clean report`, t => {
    const result = audit(t, [{ stdout: JSON.stringify({ error: { code } }) }, clean]);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.calls.length, 2);
  });
}

test("audit retries a structured temporary HTTP service failure", t => {
  const result = audit(t, [{ stdout: JSON.stringify({ error: { statusCode: 503 } }) }, clean]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.calls.length, 2);
});

for (const [label, error] of [
  ["generic endpoint hint", { stderr: "npm error audit endpoint returned an error" }],
  ["retired endpoint", { stderr: "audit endpoint retired; previous ETIMEDOUT" }],
  ["actual quick-endpoint 400", { stderr: "npm warn audit 400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick\nnpm error audit endpoint returned an error" }],
  ["400 takes precedence over network text", { stdout: JSON.stringify({ error: { code: "E400", summary: "ETIMEDOUT" } }) }],
  ["structured 400 takes precedence over 503", { stdout: JSON.stringify({ error: { statusCode: 400, detail: "HTTP 503" } }) }],
  ["configuration error", { stdout: JSON.stringify({ error: { code: "EUSAGE" } }) }],
  ["configuration error takes precedence over timeout text", { stdout: JSON.stringify({ error: { code: "EUSAGE", summary: "ETIMEDOUT" } }) }],
]) {
  test(`audit rejects ${label} on the first attempt`, t => {
    const result = audit(t, [error, clean]);
    assert.equal(result.status, 1, result.stderr); assert.equal(result.calls.length, 1);
    assert.match(result.stderr, /non-transient/);
  });
}

test("permanent HTTP statuses are never retried", t => {
  for (const statusCode of [401, 403, 404, 410, 422, 501]) {
    const result = audit(t, [{ stdout: JSON.stringify({ error: { statusCode, summary: "ECONNRESET" } }) }, clean]);
    assert.equal(result.status, 1); assert.equal(result.calls.length, 1, String(statusCode));
  }
});

test("a low-severity production advisory wins over transient-looking text and is never retried", t => {
  const result = audit(t, [{ stdout: JSON.stringify({ metadata: { vulnerabilities: { low: 1, total: 1 } }, error: { code: "EAI_AGAIN" } }) }, clean]);
  assert.equal(result.status, 1); assert.equal(result.calls.length, 1);
  assert.match(result.stderr, /found production dependency vulnerabilities/);
});

test("a persistent timeout fails after exactly the configured bounded attempts", t => {
  const result = audit(t, [{ stderr: "npm error code ETIMEDOUT" }]);
  assert.equal(result.status, 1); assert.equal(result.calls.length, 2);
  assert.match(result.stderr, /after 2 bounded attempts/);
});

test("exit zero without a valid clean audit report cannot pass the gate", t => {
  for (const response of [{ stdout: "not-json", exitCode: 0 }, { stdout: JSON.stringify({ error: { code: "E400" } }), exitCode: 0 }]) {
    const result = audit(t, [response, clean]); assert.equal(result.status, 1); assert.equal(result.calls.length, 1);
  }
});

test("invalid retry limits fail before invoking npm", t => {
  for (const settings of [{ HARA_NPM_AUDIT_ATTEMPTS: "0" }, { HARA_NPM_AUDIT_ATTEMPTS: "7" }, { HARA_NPM_AUDIT_RETRY_DELAY_SECONDS: "121" }]) {
    const result = audit(t, [clean], settings); assert.equal(result.status, 2); assert.equal(result.calls.length, 0);
  }
});

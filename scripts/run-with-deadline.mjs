#!/usr/bin/env node
// Run one command behind a hard deadline (GitHub release uploads have no client timeout). On expiry
// the child is killed and the message contains "i/o timeout", which github-release-transfer-retry.mjs
// classifies as a retryable transport failure.
//
//   node scripts/run-with-deadline.mjs <seconds> <command> [args...]
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Upload budget: never less than 10 minutes, otherwise the asset size at 100 KiB/s with 50% slack.
export function transferDeadlineSeconds(sizeBytes) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error("transfer size must be a non-negative integer");
  return Math.max(600, Math.ceil((sizeBytes / (100 * 1024)) * 1.5));
}

export function runWithDeadline(seconds, command, args, { execute = spawn } = {}) {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return Promise.reject(new Error("deadline must be a positive integer"));
  const child = execute(command, args, { stdio: "inherit" });
  return new Promise((resolvePromise) => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, seconds * 1_000);
    child.once("error", (error) => { clearTimeout(timer); console.error(`run-with-deadline: ${error.message}`); resolvePromise(127); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) { console.error(`i/o timeout: ${command} exceeded ${seconds} seconds`); resolvePromise(124); return; }
      resolvePromise(code ?? 1);
    });
  });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [secondsText, command, ...args] = process.argv.slice(2);
  if (!/^\d+$/u.test(secondsText ?? "") || !command) {
    console.error("usage: node scripts/run-with-deadline.mjs <seconds> <command> [args...]");
    process.exitCode = 2;
  } else {
    process.exitCode = await runWithDeadline(Number(secondsText), command, args);
  }
}

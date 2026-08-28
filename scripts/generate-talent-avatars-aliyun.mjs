#!/usr/bin/env node

/**
 * Generate packaged Hara Talent portraits through Alibaba Model Studio.
 *
 * Token Plan subscription keys are deliberately unsupported here: Alibaba limits
 * them to interactive coding/Agent tools and forbids automation scripts. This
 * asset utility accepts only a pay-as-you-go key. The selected key is read at
 * runtime, never logged, and never persisted.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = resolve(new URL("..", import.meta.url).pathname);
const queueScript = resolve(root, "scripts/talent-avatar-queue.mjs");
const maxAssetBytes = 128 * 1024;
const negativePrompt = [
  "text", "letters", "numbers", "typography", "watermark", "signature", "logo", "brand mark",
  "badge", "UI", "frame", "checkerboard", "transparency", "pixel art", "chibi", "anime",
  "low-poly 3D", "photorealistic", "Pixar", "Disney", "animation film", "vector clipart",
  "childish cartoon", "multiple people", "duplicate person", "duplicated body parts", "extra limbs",
  "large foreground prop", "object covering torso", "full body", "cropped head", "clutter",
  "busy background", "blurry face", "tiny face",
].join(", ");

function valueAfter(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function parseArgs(args) {
  const all = args.includes("--all");
  const limitValue = Number(valueAfter(args, "--limit", all ? "0" : "1"));
  if (!Number.isInteger(limitValue) || limitValue < 0) throw new Error("--limit must be a non-negative integer");
  const channel = valueAfter(args, "--channel", "payg");
  if (channel !== "payg") throw new Error("Token Plan keys cannot be used by this script; use --channel payg");
  const defaultKeyFile = process.env.HARA_ALIYUN_KEY_FILE;
  const defaultKeyName = "ALIYUN_AI_API_KEY";
  const defaultBaseUrl = process.env.HARA_ALIYUN_BASE_URL;
  const keyFile = valueAfter(args, "--key-file", defaultKeyFile);
  const baseUrl = valueAfter(args, "--base-url", defaultBaseUrl);
  if (!keyFile) throw new Error("payg mode requires --key-file or HARA_ALIYUN_KEY_FILE");
  if (!baseUrl) throw new Error("payg mode requires --base-url or HARA_ALIYUN_BASE_URL");
  return {
    all,
    channel,
    dryRun: args.includes("--dry-run"),
    overwrite: args.includes("--overwrite"),
    username: valueAfter(args, "--username"),
    limit: limitValue,
    model: valueAfter(args, "--model", "qwen-image-3.0-pro"),
    size: valueAfter(args, "--size", "1024*1024"),
    keyFile: resolve(keyFile),
    keyName: valueAfter(args, "--key-name", defaultKeyName),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    outputDir: valueAfter(args, "--output-dir")
      ? resolve(valueAfter(args, "--output-dir"))
      : undefined,
    magick: valueAfter(args, "--magick", "/opt/homebrew/bin/magick"),
    stateFile: resolve(valueAfter(args, "--state-file", "/private/tmp/hara-aliyun-avatar-state.jsonl")),
  };
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadKey({ keyFile, keyName }) {
  const assignment = new RegExp(`^${escapedPattern(keyName)}=`);
  const keyLine = readFileSync(keyFile, "utf8")
    .split(/\r?\n/)
    .find((line) => assignment.test(line.trim()));
  let apiKey = keyLine?.trim().slice(keyName.length + 1).trim() ?? "";
  if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
    apiKey = apiKey.slice(1, -1);
  }
  const valid = apiKey.startsWith("sk-") && !apiKey.startsWith("sk-sp-");
  if (!valid) throw new Error("payg key is missing or has an unexpected format");
  return apiKey;
}

function loadJobs(options) {
  const queueMode = options.username ? "--job" : options.overwrite ? "--all" : "--missing";
  const queueArgs = ["--experimental-strip-types", queueScript, queueMode];
  if (options.username) queueArgs.push(options.username);
  const payload = JSON.parse(execFileSync(process.execPath, queueArgs, { encoding: "utf8" }));
  const jobs = Array.isArray(payload) ? payload : [payload];
  return options.limit ? jobs.slice(0, options.limit) : jobs;
}

function stableSeed(job) {
  return createHash("sha256")
    .update(`${job.id}\0${job.username}`)
    .digest()
    .readUInt32BE(0) & 0x7fffffff;
}

function promptFor(job) {
  return `${job.prompt
    .replace("Input images: the supplied Hara portraits are style references only; never copy their identities\n", "")
    .replace("; match the visual language and finish of the supplied references", "")
    .replace(
      /, holding (.*?); adapt the prop subtly to the (.*?) role without adding text/,
      "; include $1 only as a tiny secondary accessory at the lower edge, adapted subtly to the $2 role without adding text",
    )
    .replace(
      /Composition\/framing:.*\n/,
      "Composition/framing: close head-and-shoulders profile portrait, slight three-quarter pose, face fills roughly half the canvas height, full hair and both shoulders visible, one person only\n",
    )}
Style priority: semi-realistic editorial graphic-novel portrait for mature professionals, natural adult facial proportions, visible hand-painted brush texture and restrained ink hatching; avoid animation-studio styling and cartoon simplification.
Thumbnail priority: face, hairstyle, shoulder shape, clothing silhouette, and clothing color must remain distinct at 32 to 48 pixels. Keep the role prop tiny and secondary at the lower edge. No large foreground object.`;
}

function promptDigest({ channel, model, size, prompt, seed }) {
  return createHash("sha256").update(JSON.stringify({ channel, model, size, prompt, seed })).digest("hex");
}

function targetFor(job, options) {
  return options.outputDir
    ? resolve(options.outputDir, `${job.username}.webp`)
    : resolve(job.outputPath);
}

function loadCompleted(stateFile) {
  const completed = new Map();
  if (!existsSync(stateFile)) return completed;
  for (const line of readFileSync(stateFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.username && entry.digest) completed.set(entry.username, entry);
    } catch {
      // A truncated final state line must not invalidate earlier completed work.
    }
  }
  return completed;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function requestImage({ apiKey, endpoint, model, size, prompt, seed }) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
        parameters: {
          size,
          n: 1,
          prompt_extend: false,
          watermark: false,
          negative_prompt: negativePrompt,
          seed,
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && !payload?.code) {
      const content = payload?.output?.choices?.[0]?.message?.content;
      const imageUrl = Array.isArray(content)
        ? content.find((item) => typeof item?.image === "string")?.image
        : undefined;
      if (!imageUrl) throw new Error("Alibaba image response did not contain an image URL");
      return { imageUrl, usage: payload?.usage ?? {} };
    }
    const code = payload?.code || `HTTP_${response.status}`;
    const message = String(payload?.message || response.statusText || "request failed").slice(0, 500);
    lastError = new Error(`${code}: ${message}`);
    const retryable = response.status === 429 || response.status >= 500 || /Throttling|RateQuota|Internal/i.test(code);
    if (!retryable || attempt === 3) break;
    await sleep(attempt * 3_000);
  }
  throw lastError ?? new Error("Alibaba image request failed");
}

async function downloadImage(imageUrl) {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`image download failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function packageWebp({ magick, pngBytes, target }) {
  mkdirSync(dirname(target), { recursive: true });
  const source = `${target}.aliyun-source.png`;
  const partial = `${target}.partial`;
  writeFileSync(source, pngBytes);
  try {
    for (const quality of [86, 82, 78, 74, 70, 66, 62]) {
      rmSync(partial, { force: true });
      execFileSync(magick, [
        source,
        "-resize", "512x512^",
        "-gravity", "center",
        "-extent", "512x512",
        "-strip",
        "-define", "webp:method=6",
        "-quality", String(quality),
        `webp:${partial}`,
      ]);
      const bytes = statSync(partial).size;
      if (bytes <= maxAssetBytes) {
        renameSync(partial, target);
        return bytes;
      }
    }
    throw new Error(`packaged portrait remains larger than ${maxAssetBytes} bytes`);
  } finally {
    rmSync(source, { force: true });
    rmSync(partial, { force: true });
  }
}

async function generateJob({ apiKey, job, options }) {
  const prompt = promptFor(job);
  const seed = stableSeed(job);
  const digest = promptDigest({ channel: options.channel, model: options.model, size: options.size, prompt, seed });
  const started = performance.now();
  const { imageUrl, usage } = await requestImage({
    apiKey,
    endpoint: `${options.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
    model: options.model,
    size: options.size,
    prompt,
    seed,
  });
  const pngBytes = await downloadImage(imageUrl);
  const target = targetFor(job, options);
  const bytes = packageWebp({ magick: options.magick, pngBytes, target });
  const result = {
    username: job.username,
    digest,
    channel: options.channel,
    model: options.model,
    seed,
    bytes,
    outputPath: target,
    outputTier: usage.output_image_type ?? null,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
  appendFileSync(options.stateFile, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const jobs = loadJobs(options);
  const completed = loadCompleted(options.stateFile);
  const selected = jobs.filter((job) => {
    const prompt = promptFor(job);
    const seed = stableSeed(job);
    const digest = promptDigest({ channel: options.channel, model: options.model, size: options.size, prompt, seed });
    const prior = completed.get(job.username);
    const target = targetFor(job, options);
    return !(prior?.digest === digest && existsSync(target) && statSync(target).size <= maxAssetBytes);
  });
  console.log(JSON.stringify({ event: "selection", selected: selected.length, skipped: jobs.length - selected.length }));
  if (options.dryRun || selected.length === 0) return;

  const apiKey = loadKey(options);
  const failures = [];
  for (let index = 0; index < selected.length; index += 1) {
    const job = selected[index];
    try {
      const result = await generateJob({ apiKey, job, options });
      console.log(JSON.stringify({
        event: "saved",
        position: index + 1,
        total: selected.length,
        ...result,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ username: job.username, message });
      console.error(JSON.stringify({ event: "failed", username: job.username, message }));
    }
  }
  if (failures.length) throw new Error(`${failures.length} Talent portraits failed`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

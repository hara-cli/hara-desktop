import assert from "node:assert/strict";
import test from "node:test";
import { delimiter, dirname, resolve } from "node:path";
import { isolatedEnvironment, parseOptions, LAB_IDENTIFIER } from "../scripts/local-workspace-dev.mjs";
test("native lab requires explicit Core/root and rejects hidden/duplicate options", () => {
  assert.deepEqual(parseOptions(["--core", "/candidate", "--root", "/private/fixture", "--smoke"]), { smoke: true, core: "/candidate", root: "/private/fixture" });
  for (const args of [[], ["--core", "relative", "--root", "/a"], ["--core", "/a", "--root", "/b", "--release"], ["--core", "/a", "--root", "/b", "--root", "/c"]]) assert.throws(() => parseOptions(args));
  assert.notEqual(LAB_IDENTIFIER, "com.nanhara.hara"); assert.notEqual(LAB_IDENTIFIER, "com.nanhara.hara.dev");
  assert.equal(parseOptions(["--core", "/a", "--root", "/b", "--ark-key-file", "/private/source.key"])["ark-key-file"], "/private/source.key");
  assert.throws(() => parseOptions(["--core", "/a", "--root", "/b", "--ark-key-file", "a-key-value"]));
  assert.equal(parseOptions(["--core", "/a", "--root", "/b", "--ark-key-file", "/private/source.key", "--ark-slice", "context-trim-20261017"])["ark-slice"], "context-trim-20261017");
  assert.throws(() => parseOptions(["--core", "/a", "--root", "/b", "--ark-slice", "context-trim-20261017"]));
  assert.throws(() => parseOptions(["--core", "/a", "--root", "/b", "--ark-key-file", "/private/source.key", "--ark-slice", "larger-budget"]));
});
test("child environment never inherits model credentials, proxies, preload or existing discovery", () => {
  const source = { HOME: "/real", PATH: "/approved/bin", OPENAI_API_KEY: "sensitive", ANTHROPIC_API_KEY: "sensitive", NODE_OPTIONS: "--import unsafe",
    HTTP_PROXY: "http://private", HARA_WORKSPACE_DEV_TOKEN: "secret", HARA_HOME: "/real/.hara", TAURI_CONFIG: "release", VITE_HARA_FEEDBACK_APP_SECRET: "secret" };
  const fixtureHome = resolve("/fixture/home");
  const core = isolatedEnvironment(source, fixtureHome); assert.equal(core.HOME, fixtureHome);
  const native = isolatedEnvironment(source, fixtureHome, true); assert.equal(native.HOME, "/real");
  assert.equal(native.HARA_DESKTOP_DEV_HOME, fixtureHome); assert.equal(native.HARA_DESKTOP_WORKSPACE_DEV_ROOT, resolve(fixtureHome, ".."));
  assert.equal(core.PATH, `${dirname(process.execPath)}${delimiter}${source.PATH}`);
  assert.equal(native.PATH, core.PATH);
  assert.equal(native.VITE_HARA_WORKSPACE_DEV, "1"); assert.equal(native.CARGO_NET_OFFLINE, "true");
  for (const env of [core, native]) for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NODE_OPTIONS", "HTTP_PROXY", "HARA_HOME", "HARA_WORKSPACE_DEV_TOKEN", "TAURI_CONFIG", "VITE_HARA_FEEDBACK_APP_SECRET"]) assert.equal(env[name], undefined);
});

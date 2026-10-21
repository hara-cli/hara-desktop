import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/ToggleSwitch.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { ToggleSwitch } = module.exports;
test("switch keeps native button keyboard semantics, an accessible name and controlled checked state", () => {
  for (const checked of [false, true]) {
    const changes = [], button = ToggleSwitch({ checked, label: "Synthetic preference", onCheckedChange: value => changes.push(value) });
    assert.equal(button.type, "button"); assert.equal(button.props.type, "button"); assert.equal(button.props.role, "switch");
    assert.equal(button.props["aria-checked"], checked); assert.equal(button.props["aria-label"], "Synthetic preference");
    assert.equal(button.props.children.props["aria-hidden"], "true");
    button.props.onClick(); assert.deepEqual(changes, [!checked]);
  }
});
test("read-only and future switches retain disabled semantics and support disabled-on state", () => {
  for (const checked of [false, true]) {
    const button = ToggleSwitch({ checked, disabled: true, label: "Unavailable preference" });
    assert.equal(button.props.disabled, true); assert.equal(button.props["aria-checked"], checked);
  }
});

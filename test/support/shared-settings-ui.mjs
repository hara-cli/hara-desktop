import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Standalone controller harnesses transpile a screen without bundling its imports. Load the
// actual shared UI dependencies here; keep their controller mocks and permission assertions.
// Native dialog visibility and focus are exercised by the browser interaction regression.
const modules = new Map();
export function sharedSettingsUi(name) {
  if (!["./SettingsActionDialog", "./SettingsChrome", "./SettingsConnectionModelField"].includes(name)) throw new Error("Unknown shared settings UI module");
  if (!modules.has(name)) {
    const url = new URL(`../../src/${name.slice(2)}.tsx`, import.meta.url);
    const output = buildSync({ entryPoints: [fileURLToPath(url)], bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
    const module = { exports: {} };
    new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(url), module, module.exports);
    modules.set(name, module.exports);
  }
  return modules.get(name);
}

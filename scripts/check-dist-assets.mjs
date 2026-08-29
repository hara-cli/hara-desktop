import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../dist/", import.meta.url);
const rootPath = fileURLToPath(root);

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const target = join(directory, name);
    return statSync(target).isDirectory() ? filesUnder(target) : [target];
  });
}

const documents = filesUnder(rootPath).filter((target) => /\.(?:html|css|js)$/.test(target));
const missing = new Set();
for (const document of documents) {
  const source = readFileSync(document, "utf8");
  for (const match of source.matchAll(/(?:^|["'(])\/(assets\/[A-Za-z0-9_.-]+)/g)) {
    const asset = join(rootPath, match[1]);
    if (!existsSync(asset)) missing.add(`${relative(rootPath, document)} -> ${match[1]}`);
  }
}

const index = readFileSync(join(rootPath, "index.html"), "utf8");
if (!index.includes("__HARA_RENDERER_STATE__") || !index.includes("hara-renderer-ready")) {
  throw new Error("built index.html is missing the renderer startup recovery contract");
}
if (missing.size) {
  throw new Error(`built frontend references missing assets:\n${[...missing].join("\n")}`);
}

console.log(`Renderer assets OK: ${documents.length} built HTML/CSS/JS files checked`);

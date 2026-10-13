import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationHasNativeImages, connectionCanCopyNativeImages, focusedModelConnection } from "../src/model-connection-recovery.ts";

test("only persisted native images constrain a model/connection transfer", () => {
  const image = { kind: "user", text: "synthetic fixture", attachments: [{ kind: "image", name: "synthetic.png", strategy: "native-image" }] };
  assert.equal(conversationHasNativeImages([image]), true);
  assert.equal(conversationHasNativeImages([{ ...image, pendingId: "unsent" }]), false);
  assert.equal(conversationHasNativeImages([{ ...image, attachments: [{ ...image.attachments[0], strategy: "vision-sidecar" }] }]), false);
  assert.equal(conversationHasNativeImages([{ kind: "notice", text: "native-image" }]), false);
  for (const support of ["unsupported", "unknown", undefined]) assert.equal(connectionCanCopyNativeImages(true, support), false);
  assert.equal(connectionCanCopyNativeImages(true, "supported"), true);
  assert.equal(connectionCanCopyNativeImages(false, undefined), true);
});

test("an accepted image without strategy metadata cannot enable a text-only transfer before history reload", () => {
  const live = [{ kind: "user", text: "synthetic", attachments: [{ kind: "image", name: "synthetic.png" }], pendingId: "local" }];
  assert.equal(conversationHasNativeImages(live), false, "unaccepted input remains a draft");
  const accepted = live.map(({ pendingId, ...item }) => item);
  assert.equal(conversationHasNativeImages(accepted), true);
  assert.equal(connectionCanCopyNativeImages(conversationHasNativeImages(accepted), "unsupported"), false);
});

test("repair focuses the pinned saved identity when the new-chat default and same-provider account differ", () => {
  const connections = [
    { id: "personal", provider: "openai", active: true },
    { id: "tokenplan", provider: "token-plan", active: false },
    { id: "tokenplan-other-account", provider: "token-plan", active: false },
  ];
  const frozen = JSON.stringify(connections);
  assert.deepEqual(focusedModelConnection("tokenplan", connections, []), { kind: "personal", connection: connections[1] });
  assert.equal(focusedModelConnection("token-plan", connections, []), undefined, "a provider is not an account identity");
  assert.equal(focusedModelConnection("missing", connections, []), undefined, "a missing identity does not select the default or another account");
  assert.equal(focusedModelConnection(undefined, connections, []), undefined);
  assert.equal(JSON.stringify(connections), frozen, "focusing never activates or alters a saved connection");
  const organization = { id: "company-route" };
  assert.deepEqual(focusedModelConnection("company-route", connections, [organization]), { kind: "organization", connection: organization });
});

const fixture = mkdtempSync(join(tmpdir(), "hara-model-recovery-render-"));
const bundle = await build({ stdin: { contents: `
  import {createElement} from "react";
  import {renderToStaticMarkup} from "react-dom/server";
  import Recovery from "./src/ModelConnectionRecovery.tsx";
  export const render = (options = {}) => renderToStaticMarkup(createElement(Recovery, {
    label:"tokenplan",provider:"token-plan",model:"qwen3.7-plus",locale:"zh",
    failure:"authentication",hasNativeImages:true,onManage(){},...options
  }));
`, resolveDir: new URL("../", import.meta.url).pathname, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false });
writeFileSync(join(fixture, "recovery.cjs"), bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(join(fixture, "recovery.cjs"));
test.after(() => rmSync(fixture, { recursive: true, force: true }));

test("the real recovery card keeps Token Plan visible as the current connection, including with no alternatives", () => {
  for (const locale of ["zh", "en"]) {
    const html = render({ locale });
    assert.match(html, /<strong>tokenplan<\/strong>/);
    assert.match(html, /token-plan · qwen3\.7-plus/);
    assert.match(html, locale === "zh" ? /管理当前连接/ : /Manage current connection/);
    assert.match(html, locale === "zh" ? /历史含原生图片/ : /History contains native images/);
    assert.doesNotMatch(html, /权限模式|Reasoning effort/);
  }
});

test("quota recovery explains allowance rather than suggesting a credential repair", () => {
  for (const locale of ["zh", "en"]) {
    const html = render({ locale, failure: "quota", hasNativeImages: false });
    assert.match(html, locale === "zh" ? /服务商报告此连接额度或余额不足/ : /provider reports insufficient allowance or balance/);
    assert.match(html, locale === "zh" ? /不同套餐.*以服务商为准/ : /plan usage rules vary by provider/);
    assert.doesNotMatch(html, /更换同一连接内的模型不能恢复额度|changing models on this connection does not restore it/);
    assert.doesNotMatch(html, /认证失败|could not authenticate|历史含原生图片|History contains native images/);
  }
});

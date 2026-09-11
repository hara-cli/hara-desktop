import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;

test("Feishu settings use capability-negotiated write-only Engine storage", () => {
  const component = readFileSync(`${root}/src/GatewaySettings.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  for (const method of ["settings.gateways.credentials.save", "settings.gateways.credentials.remove"]) {
    assert.match(client, new RegExp(method.replaceAll(".", "\\.")), `${method} is capability negotiated`);
    assert.match(component, new RegExp(method.replaceAll(".", "\\.")), `${method} gates the UI`);
  }
  assert.match(component, /client\.saveFeishuGatewayCredentials\(\{ appId, appSecret, domain: feishuDomain \}\)/);
  assert.match(component, /setFeishuAppId\(""\);\s*setFeishuAppSecret\(""\);\s*try \{\s*const next = await client\.saveFeishuGatewayCredentials/,
    "renderer inputs are cleared before the asynchronous save result");
  assert.match(component, /type="password"[\s\S]*value=\{feishuAppId\}/, "the App ID entry is masked");
  assert.match(component, /type="password"[\s\S]*value=\{feishuAppSecret\}/, "the App Secret entry is masked");
  assert.match(component, /autoComplete="new-password"/);
  assert.match(component, /status\.credentialSource === "stored"/);
  assert.doesNotMatch(component, /status\.(?:appId|appSecret)|localStorage\.(?:getItem|setItem)/,
    "stored connector identity and secrets are never rendered or persisted by the renderer");
  assert.match(component, /window\.confirm\(copy\.feishuRemoveConfirm\)/,
    "credential deletion requires an explicit destructive confirmation");
  assert.match(component, /Automations use the brokered Feishu channel|自动化只调用受控飞书通道/);
  assert.match(css, /\.gateway-credential-panel/);
  assert.match(css, /\.gateway-credential-fields/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.gateway-credential-fields \{\s*grid-template-columns: 1fr;/,
    "the credential form collapses to one column on compact windows");
});

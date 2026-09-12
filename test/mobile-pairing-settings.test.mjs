import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

test("Desktop exposes the exact Mobile pairing destination requested by Hara Mobile", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const i18n = readFileSync(`${root}/src/i18n.ts`, "utf8");

  assert.match(app, /type SettingsSection =[^;]*\| "mobile"/s);
  assert.match(app, /\["mobile", t\("setMobile"\)\]/);
  assert.match(app, /setSec === "mobile"[\s\S]*id="settings-mobile-title"/);
  assert.match(app, /const MobilePairingSettings = lazy\(loadMobilePairingSettings\)/);
  assert.match(app, /section === "mobile"[\s\S]*warmModule\(loadMobilePairingSettings\(\)\)/);
  assert.match(i18n, /setMobile: "Mobile pairing"/);
  assert.match(i18n, /setMobile: "手机配对"/);
  assert.match(i18n, /mobileSettingsDescription: "通过短时邀请安全配对手机/);
});

test("Mobile pairing stays capability-gated, one-time, and credential-free in the renderer", () => {
  const component = readFileSync(`${root}/src/MobilePairingSettings.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const css = readFileSync(`${root}/src/MobilePairingSettings.css`, "utf8");
  const dtoBlock = client.match(
    /export interface MobileCompanionStatus[\s\S]*?export type OrganizationAccessState/,
  )?.[0] ?? "";

  for (const method of [
    "mobile.status",
    "mobile.pairing.create",
    "mobile.pairing.status",
    "mobile.pairing.decide",
  ]) {
    const methodPattern = new RegExp(method.replaceAll(".", "\\."));
    assert.match(component, methodPattern, `${method} gates the pairing surface`);
    assert.match(client, methodPattern, `${method} is routed through the authenticated Serve client`);
  }

  assert.match(component, /void import\("qrcode"\)/, "QR rendering stays in the lazy pairing chunk");
  assert.match(component, /value\.qrPayload === expectedPayload/);
  assert.match(component, /\^HARA_\[A-Za-z0-9_-\]\{11,123\}\$/);
  assert.match(component, /pairing\?\.mobile && pairing\.state === "claimed" && invitationActive/);
  assert.match(component, /pairing\.state !== "claimed"[\s\S]*invitation\.expiresAt <= Date\.now\(\)/);
  assert.match(component, /pairingClient\.decideMobilePairing\(invitation\.challengeId, approved\)/);
  assert.match(component, /accountRequestRef\.current === requestId/, "a stale account response cannot replace current state");
  assert.match(component, /currentClientRef\.current !== pairingClient/, "a stale Engine cannot complete a pairing action");
  assert.match(
    component,
    /setInvitation\(null\);[\s\S]*await pairingClient\.createMobilePairing\(\)/,
    "creating a new invitation first retires the previous polling identity",
  );
  assert.match(component, /<code className="settings-mono">hara mobile login<\/code>/);
  assert.match(component, /Only separately published Sessions appear when remote service is available/);
  assert.doesNotMatch(component, /The phone can now see/, "pairing alone is not presented as active remote access");
  assert.match(component, /actions=\{\([\s\S]*copy\.refresh/);
  assert.match(component, /window\.setTimeout\(\(\) => void tick\(\), 1_000\)/);
  assert.match(component, /window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(component, /window\.setInterval/, "an expired invitation does not leave a polling interval alive");

  assert.ok(dtoBlock, "mobile DTO block is present");
  assert.doesNotMatch(
    dtoBlock,
    /\b(?:accessToken|refreshToken|credential|privateKey|publicKeySpki)\b/,
    "account tokens, device credentials, private keys, and full phone public keys never enter renderer DTOs",
  );
  assert.match(dtoBlock, /publicKeyThumbprint: string/);
  assert.match(css, /\.mobile-pairing-qr-frame/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

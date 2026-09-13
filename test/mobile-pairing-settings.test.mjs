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
    "mobile.authorization.create",
    "mobile.authorization.status",
    "mobile.pairing.create",
    "mobile.pairing.status",
    "mobile.pairing.decide",
    "mobile.publications.list",
    "mobile.publications.publish",
    "mobile.publications.unpublish",
  ]) {
    const methodPattern = new RegExp(method.replaceAll(".", "\\."));
    assert.match(component, methodPattern, `${method} gates the pairing surface`);
    assert.match(client, methodPattern, `${method} is routed through the authenticated Serve client`);
  }

  assert.match(component, /void import\("qrcode"\)/, "QR rendering stays in the lazy pairing chunk");
  assert.match(component, /supportsFeature\("mobile\.desktop-authorization\.qr\.v1"\)/);
  assert.match(component, /hara:\/\/authorize-desktop\?v=1&region=/);
  assert.match(component, /\^HARA_AUTH_\[A-Za-z0-9_-\]\{22,118\}\$/);
  assert.match(component, /validDesktopAuthorizationSnapshot\(next, authorization\)/);
  assert.match(component, /next\.signedIn\) await refreshAccount\(\)/);
  assert.match(component, /authorizationClient\.createMobileDesktopAuthorization\(\)/);
  assert.match(component, /window\.setTimeout\(\(\) => void tick\(\), 1_000\)/);
  assert.match(component, /使用 Hara Mobile 登录/);
  assert.match(component, /No Sessions are shared until you allow them below/);
  assert.match(component, /你在下方明确开放前，不会共享任何会话/);
  assert.match(component, /value\.qrPayload === expectedPayload/);
  assert.match(component, /\^HARA_\(\?!AUTH_\)\[A-Za-z0-9_-\]\{11,123\}\$/);
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
  assert.match(component, /Nothing is shared by default/);
  assert.match(component, /client\.listExternalSessions\(\{ limit: 100 \}\)/);
  assert.match(component, /publicationClient\.publishMobileSession\(sessionId, capabilities\)/);
  assert.match(component, /publicationClient\.unpublishMobileSession\(sessionId\)/);
  assert.match(
    component,
    /supportsFeature\("mobile\.session-publications\.granular-capabilities\.v2"\)/,
    "an older Engine cannot silently interpret read-only publication as full access",
  );
  assert.match(component, /const READ_ONLY_MOBILE_CAPABILITIES:[\s\S]*read: true[\s\S]*submit: false/);
  assert.match(component, /New access starts read-only/);
  assert.match(component, /新开放的会话默认只读/);
  assert.match(component, /connectionState/);
  assert.match(component, /mobileCompanionStatus\(\)[\s\S]*window\.setTimeout\(\(\) => void tick\(\), 2_000\)/);
  assert.match(component, /After pairing, its encrypted Mobile connection stays online automatically/);
  assert.match(component, /配对后，加密手机连接会自动保持在线/);
  assert.match(component, /relayPresentation\.tone/);
  assert.match(client, /managedByServe: true/);
  assert.match(component, /capability === "terminalControl" && enabled[\s\S]*terminalObserve: true/);
  assert.match(component, /capability === "terminalObserve" && !enabled[\s\S]*terminalControl: false/);
  assert.match(component, /sourceCapabilities\?\.terminalView === true/);
  assert.match(component, /sourceCapabilities\?\.terminalInput === true/);
  assert.match(component, /copy\.accessApprove/);
  assert.match(component, /copy\.accessSend/);
  assert.match(component, /copy\.accessTerminalView/);
  assert.match(component, /copy\.accessTerminalControl/);
  assert.match(component, /aria-pressed=\{published\}/);
  assert.doesNotMatch(component, /The phone can now see/, "pairing alone is not presented as active remote access");
  assert.match(component, /actions=\{\([\s\S]*copy\.refresh/);
  assert.match(component, /window\.setTimeout\(\(\) => void tick\(\), 1_000\)/);
  assert.match(component, /window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(component, /window\.setInterval/, "an expired invitation does not leave a polling interval alive");

  assert.ok(dtoBlock, "mobile DTO block is present");
  assert.doesNotMatch(
    dtoBlock,
    /\b(?:accessToken|refreshToken|credential|privateKey|publicKeySpki|pollSecret)\b/,
    "account tokens, device credentials, private keys, and full phone public keys never enter renderer DTOs",
  );
  assert.match(dtoBlock, /publicKeyThumbprint: string/);
  assert.match(css, /\.mobile-pairing-qr-frame/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

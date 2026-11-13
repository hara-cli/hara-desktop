import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Jeff 2026-11-08 management panel fixes 2, 3 and 5 (fixes 1 and 4 wait for the design pane).
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const form = read("src/ColleagueRuntimeForm.tsx"), css = read("src/desktop-redesign.css");

test("Revert is a centred secondary button beside Apply, not a full-width input-like row", () => {
  const rule = css.match(/\.hs\.hd-redesign\.vg-app \.vg-rf \.vg-rf-foot \.vg-rf-revert\{([^}]*)\}/u)?.[1];
  assert.ok(rule, "a dedicated Revert rule overrides the generic .vg-runtime-access button style");
  for (const declaration of ["width:auto", "min-width:88px", "margin-left:auto", "text-align:center", "background:transparent", "border:1px solid var(--hd-line)"])
    assert.ok(rule.includes(declaration), declaration);
  assert.match(form, /className="vg-rf-revert"/u);
});

test("the engine dropdown lists engine names; only an unselectable engine keeps its reason", () => {
  const option = form.match(/<option key=\{row\.id\}[^\n]*<\/option>/u)?.[0];
  assert.ok(option, "engine option markup");
  assert.match(option, /\{engineName\(row\.id\)\}\{!selectable && row\.id !== agent\.runtime\.id && rowStatus \? ` · \$\{statusText\(rowStatus\)\}` : ""\}/u);
  assert.doesNotMatch(option, /rowStatus\.key !== "ws\.rf\.status\.ready"/u, "selectable engines no longer repeat the status chip");
});

test("panel disclosures share the rotating chevron used by the manage sections", () => {
  assert.match(css, /\.hd-manage-section>summary::before\{content:"›"/u);
  assert.match(css, /:is\(\.vg-rf-details,\.wsd-runtime-details\)>summary\{[^}]*list-style:none/u);
  assert.match(css, /:is\(\.vg-rf-details,\.wsd-runtime-details\)>summary::-webkit-details-marker\{display:none\}/u);
  assert.match(css, /:is\(\.vg-rf-details,\.wsd-runtime-details\)>summary::before\{content:"›"/u);
  assert.match(css, /:is\(\.vg-rf-details,\.wsd-runtime-details\)\[open\]>summary::before\{transform:rotate\(90deg\)\}/u);
});

test("the form's action buttons use the secondary button style; Install stays a link", () => {
  const rule = css.match(/\.hs\.hd-redesign\.vg-app \.vg-rf \.vg-rf-actions button:not\(\.vg-runtime-install\)\{([^}]*)\}/u)?.[1];
  assert.ok(rule, "a rule overrides the generic .vg-runtime-access button style for .vg-rf-actions");
  for (const declaration of ["justify-content:center", "width:auto", "text-align:center", "background:transparent", "border:1px solid var(--hd-line)"])
    assert.ok(rule.includes(declaration), declaration);
  assert.match(form, /<div className="vg-rf-actions">[^\n]*t\("ws\.rf\.piRefreshModels"\)/u);
  assert.match(form, /<button type="button" className="vg-runtime-install"/u);
});

// Jeff 2026-11-08, fixes 1 and 4 for 1.2.0.
test("fix 1: the unsaved state is one unbordered line with a dot that truncates with a tooltip, never wrapping", () => {
  assert.match(css, /\.hs\.hd-redesign\.vg-app \.vg-rf\.vg-runtime-access\{grid-template-columns:minmax\(0,1fr\)\}/u, "the form column cannot grow past the panel");
  assert.match(css, /\.hs\.hd-redesign\.vg-app \.vg-rf \.vg-rf-foot\{min-width:0\}/u);
  const line = css.match(/\.hs\.hd-redesign\.vg-app \.vg-rf \.vg-rf-foot>\.vg-rf-chip,\.hs\.hd-redesign\.vg-app \.vg-rf \.vg-rf-foot>\.vg-rf-footnote\{([^}]*)\}/u)?.[1] ?? "";
  for (const declaration of ["min-width:0", "overflow:hidden", "white-space:nowrap", "text-overflow:ellipsis", "flex:1 1 auto"]) assert.ok(line.includes(declaration), declaration);
  const dirty = css.match(/\.vg-rf-foot>\.vg-rf-chip\.dirty\{([^}]*)\}/u)?.[1] ?? "";
  for (const declaration of ["border:0", "padding:0", "font-size:12px"]) assert.ok(dirty.includes(declaration), declaration);
  assert.match(css, /\.vg-rf-foot>\.vg-rf-chip\.dirty::before\{content:"";display:inline-block;width:6px;height:6px;[^}]*border-radius:50%/u);
  assert.match(form, /className="vg-rf-chip dirty" role="status" title=\{t\("ws\.rf\.unsaved", \{ fields: fieldText \}\)\}/u);
});

test("fix 4: update and first-use states say once, below the engine, to confirm with Apply (en, zh-Hans)", () => {
  const copy = lang => JSON.parse(read(`src/locales/${lang}/ws.json`));
  const en = copy("en"), hans = copy("zh-Hans"), hant = copy("zh-Hant");
  assert.equal(en["ws.rf.formStatus.confirmUpdate"], "Updated to {version}. Click Apply to confirm and use it.");
  assert.equal(hans["ws.rf.formStatus.confirmUpdate"], "已升级到 {version}，点「应用」后确认使用");
  assert.equal(en["ws.rf.formStatus.confirmFirstUse"], "First use. Click Apply to confirm.");
  assert.equal(hans["ws.rf.formStatus.confirmFirstUse"], "首次使用，点「应用」后确认");
  assert.equal(hans["ws.rf.formStatus.confirmUpdateUnknown"], "已升级，点「应用」后确认使用");
  for (const key of ["ws.rf.formStatus.confirmUpdate", "ws.rf.formStatus.confirmUpdateUnknown", "ws.rf.formStatus.confirmFirstUse"]) assert.ok(hant[key], `zh-Hant ${key}`);
  assert.ok(hans["ws.rf.formStatus.confirmUpdate"].includes(hans["ws.rf.apply"]) && en["ws.rf.formStatus.confirmUpdate"].includes(en["ws.rf.apply"]), "the copy names the actual Apply button");
  assert.match(form, /use === "confirm_update" \? currentVersion \? t\("ws\.rf\.formStatus\.confirmUpdate", \{ version: currentVersion \}\) : t\("ws\.rf\.formStatus\.confirmUpdateUnknown"\)/u);
  assert.match(form, /title=\{chipText\}>\{chipText\}<\/span>/u);
  assert.doesNotMatch(form, /confirmNeeded \? <span className="vg-rf-chip warn" role="status">\{statusText\(status\)\}/u, "the footer no longer repeats the status");
});

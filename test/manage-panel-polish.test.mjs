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

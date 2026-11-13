import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {sharedSettingsUi} from "./support/shared-settings-ui.mjs";
const {SettingsActionResult}=sharedSettingsUi("./SettingsActionDialog");
const render=(text,error=false)=>renderToStaticMarkup(createElement(SettingsActionResult,{text,error}));

test("settings results expose empty status and alert regions before an action",()=>{
 const html=render("");
 assert.match(html,/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*><\/p>/);
 assert.match(html,/<p[^>]*role="alert"[^>]*><\/p>/);
 assert.doesNotMatch(html,/hidden|display:\s*none|class="wss-action-result/);
});

test("a settings outcome fills only its matching live region and escapes its text",()=>{
 const success=render("Saved <fixture>"),error=render("Not saved <fixture>",true);
 assert.match(success,/class="wss-action-result"[^>]*role="status"[^>]*>Saved &lt;fixture&gt;<\/p>/);
 assert.match(success,/role="alert"[^>]*><\/p>/);
 assert.match(error,/class="wss-action-result is-error"[^>]*role="alert"[^>]*>Not saved &lt;fixture&gt;<\/p>/);
 assert.match(error,/role="status"[^>]*><\/p>/);
});

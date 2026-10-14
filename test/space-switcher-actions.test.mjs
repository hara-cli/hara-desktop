import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/SpaceSwitcher.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} });
const construct = new Function("require", "module", "exports", outputText);
const directory = () => ({
  activeId: "personal", activeProfileId: "token-plan", activeSource: "default", switchLocked: false,
  spaces: [
    { id: "personal", name: "Personal", kind: "personal", profileId: "token-plan", active: true },
    { id: "org:expired", name: "Expired", kind: "organization", profileId: "expired", accessState: "expired" },
    { id: "org:team", name: "Team", kind: "organization", profileId: "team", authoritative: true },
  ],
});

// Exercise the actual renderer handlers and hook cleanup with synthetic DOM nodes. This is not a
// browser/layout/focus-order certification; actual native/browser QA remains a separate release gate.
function withHarness(run) {
  const previousDocument = globalThis.document;
  const slots = [], effects = [], listeners = new Map(), nodes = new Map(), calls = [];
  let cursor = 0, dirty = false, tree, props = { directory: directory(), locale: "en", onSelect: id => calls.push(id) };
  const doc = {
    activeElement: null,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
  };
  globalThis.document = doc;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!Object.hasOwn(slots, index)) slots[index] = initial;
      return [slots[index], next => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId() { cursor++; return "synthetic-workspace-menu"; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) effects.push({ index, fn, deps });
    },
  };
  const module = { exports: {} };
  construct(name => {
    if (name === "react") return hooks;
    if (name === "./SpaceSwitcher.css") return {};
    if (name === "./icons") return { IconChevronDown: () => null, IconLock: () => null };
    return require(name);
  }, module, module.exports);
  const elements = (element = tree) => !element || typeof element !== "object" ? [] : [element, ...[
    element.props?.children ?? [],
  ].flat(Infinity).flatMap(child => elements(child))];
  const render = (updates = {}) => {
    props = { ...props, ...updates };
    let attempts = 0;
    do {
      assert.ok(attempts++ < 8, "effects must settle");
      cursor = 0; dirty = false; tree = module.exports.default(props);
      for (const element of elements()) {
        if (typeof element.type !== "string") continue;
        const key = element.key ?? element.props.className ?? element.type;
        const node = nodes.get(key) ?? {
          focus() { doc.activeElement = this; },
          getAttribute(name) { return this.props[name] === undefined ? null : String(this.props[name]); },
          contains(target) { return this === target || (this.children ?? []).includes(target); },
          querySelectorAll() { return (this.children ?? []).filter(child => child.type === "button" && !child.props.disabled); },
        };
        node.type = element.type; node.props = element.props;
        nodes.set(key, node);
        if (element.props.ref) element.props.ref.current = node;
      }
      const root = nodes.get("space-switcher"), menu = nodes.get("space-switcher-menu");
      if (root) root.children = elements().map(element => nodes.get(element.key ?? element.props?.className ?? element.type)).filter(Boolean);
      if (menu) menu.children = elements().filter(element => element.props?.role === "menuitemradio").map(element => nodes.get(element.key));
      for (const effect of effects.splice(0)) {
        slots[effect.index]?.cleanup?.();
        slots[effect.index] = { deps: effect.deps, cleanup: effect.fn() };
      }
    } while (dirty);
    return tree;
  };
  const h = {
    render, calls, doc, listeners, elements,
    trigger: () => elements().find(element => element.props?.className === "space-switcher-trigger"),
    option: id => elements().find(element => element.key === id),
    open() { h.trigger().props.onClick(); render(); },
    key(key, trigger = false) {
      const event = { key, prevented: false, preventDefault() { this.prevented = true; }, currentTarget: nodes.get("space-switcher-menu") };
      (trigger ? h.trigger() : elements().find(element => element.props?.role === "menu")).props.onKeyDown(event);
      render(); return event;
    },
    node: key => nodes.get(key),
  };
  try { render(); return run(h); }
  finally {
    for (const slot of slots) slot?.cleanup?.();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
}

test("selection is exact, closes the menu and never dispatches for the current Workspace", () => withHarness(h => {
  h.open();
  assert.equal(h.option("personal").props["aria-checked"], true);
  h.option("personal").props.onClick(); h.render();
  assert.deepEqual(h.calls, []);
  h.open(); h.option("org:team").props.onClick(); h.render();
  assert.deepEqual(h.calls, ["org:team"]);
  assert.equal(h.trigger().props["aria-expanded"], false);
  assert.equal(h.doc.activeElement, h.node("space-switcher-trigger"));
}));

test("keyboard navigation skips unavailable connections, wraps, and supports Home/End", () => withHarness(h => {
  h.key("ArrowDown", true);
  assert.equal(h.doc.activeElement, h.node("personal"));
  assert.equal(h.option("org:expired").props.disabled, true);
  assert.equal(h.key("ArrowDown").prevented, true);
  assert.equal(h.doc.activeElement, h.node("org:team"));
  h.key("ArrowDown"); assert.equal(h.doc.activeElement, h.node("personal"));
  h.key("End"); assert.equal(h.doc.activeElement, h.node("org:team"));
  h.key("Home"); assert.equal(h.doc.activeElement, h.node("personal"));
  h.key("ArrowUp"); assert.equal(h.doc.activeElement, h.node("org:team"));
}));

test("ArrowUp opens at the last enabled item", () => withHarness(h => {
  h.key("ArrowUp", true);
  assert.equal(h.doc.activeElement, h.node("org:team"));
}));

test("Escape restores trigger focus and removes document handlers", () => withHarness(h => {
  h.open(); assert.equal(h.listeners.size, 2);
  let prevented = false;
  h.listeners.get("keydown")({ key: "Escape", preventDefault() { prevented = true; } });
  h.render();
  assert.equal(prevented, true);
  assert.equal(h.trigger().props["aria-expanded"], false);
  assert.equal(h.doc.activeElement, h.node("space-switcher-trigger"));
  assert.equal(h.listeners.size, 0);
}));

test("outside focus/click closes without stealing focus", () => withHarness(h => {
  h.open(); const outside = {}; h.doc.activeElement = outside;
  h.elements().find(element => element.props?.className === "space-switcher").props.onBlur({ currentTarget: h.node("space-switcher"), relatedTarget: outside });
  h.render(); assert.equal(h.trigger().props["aria-expanded"], false); assert.equal(h.doc.activeElement, outside);
  h.open(); h.listeners.get("pointerdown")({ target: outside }); h.render();
  assert.equal(h.trigger().props["aria-expanded"], false);
}));

test("a directory route/lock/membership change invalidates the old open menu", () => withHarness(h => {
  for (const update of [
    { activeProfileId: "another-key" }, { switchLocked: true },
    { spaces: directory().spaces.slice(0, 1) },
    { spaces: directory().spaces.map(space => ({ ...space, agentProfilePermission: "view" })) },
    { spaces: directory().spaces.map(space => space.id === "org:team" ? { ...space, accessState: "invalid" } : space) },
  ]) {
    h.render({ directory: directory() }); h.open();
    h.render({ directory: { ...directory(), ...update } });
    assert.equal(h.trigger().props["aria-expanded"], false);
    h.render({ directory: directory() });
    assert.equal(h.trigger().props["aria-expanded"], false, "returning must not resurrect an old menu");
  }
  assert.deepEqual(h.calls, []);
}));

test("a pinned Workspace stays readable but cannot select another audience", () => withHarness(h => {
  h.render({ directory: { ...directory(), switchLocked: true } }); h.open();
  assert.equal(h.option("personal").props.disabled, false);
  assert.equal(h.option("org:team").props.disabled, true);
  h.key("End"); assert.equal(h.doc.activeElement, h.node("personal"));
}));

test("switch-in-flight disables the trigger and closes the old menu", () => withHarness(h => {
  h.open(); h.render({ switching: true });
  assert.equal(h.trigger().props.disabled, true);
  assert.equal(h.trigger().props["aria-expanded"], false);
  h.render({ switching: false }); assert.equal(h.trigger().props["aria-expanded"], false);
}));

test("an incomplete directory never labels the first member as active", () => withHarness(h => {
  assert.equal(h.render({ directory: { ...directory(), activeId: "missing" } }), null);
  assert.equal(h.render({ directory: null }), null);
}));

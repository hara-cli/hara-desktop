import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, UNKNOWN_SYSTEM_VISUALS, parseAppearance, parseSystemVisuals, resolveAppearance } from "../src/violet-appearance.ts";
import { watchSystemVisualPreferences } from "../src/system-visual-preferences.ts";
const known = { reduceTransparency: false, increaseContrast: false, reduceMotion: false, lowPowerMode: false };
const tick = () => new Promise(done => setImmediate(done));
function environment() {
  const media = new Map(), events = new Map(), pageEvents = new Map(), timers = new Map();let id = 0;
  const listen = map => ({ addEventListener(key, callback) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(callback); }, removeEventListener(key, callback) { map.get(key)?.delete(callback); } });
  const surface = { ...listen(events), matchMedia(query) { if (!media.has(query)) { const changes = new Set(); media.set(query, { matches: false, changes, addEventListener(_, callback) { changes.add(callback); }, removeEventListener(_, callback) { changes.delete(callback); } }); } return media.get(query); }, setInterval(callback) { timers.set(++id, callback); return id; }, clearInterval(timer) { timers.delete(timer); } };
  const page = { ...listen(pageEvents), visibilityState: "visible", focused: true, hasFocus() { return this.focused; } };
  return { surface, page, media, events, pageEvents, timers, fire(map, key) { for (const callback of map.get(key) ?? []) callback(); } };
}
test("new visual defaults follow the system while saved explicit choices stay intact", () => {
  assert.deepEqual(DEFAULT_APPEARANCE, { darkTheme: "violet-glass", transparency: "system", motion: "system" });
  assert.deepEqual(parseAppearance({ transparency: "standard", motion: "standard" }), { darkTheme: "violet-glass", transparency: "standard", motion: "standard" });
  assert.equal(parseAppearance({ transparency: { toString: () => "off" }, motion: ["reduced"] }).transparency, "system");
  assert.equal(parseAppearance({ transparency: "url(private)", motion: ["reduced"] }).motion, "system");
  assert.equal(resolveAppearance(DEFAULT_APPEARANCE, UNKNOWN_SYSTEM_VISUALS).transparency, "off");
  assert.equal(resolveAppearance(DEFAULT_APPEARANCE, known).transparency, "standard");
});
test("OS accessibility wins over enhanced glass without changing the saved preference", () => {
  const preference = { ...DEFAULT_APPEARANCE, transparency: "enhanced", motion: "standard" }, before = structuredClone(preference);
  for (const flag of ["reduceTransparency", "increaseContrast"]) assert.equal(resolveAppearance(preference, { ...known, [flag]: true }).transparency, "off");
  assert.equal(resolveAppearance(preference, { ...known, reduceMotion: true }).motion, "reduced");
  assert.equal(resolveAppearance({ ...preference, motion: "off" }, { ...known, reduceMotion: true }).motion, "off");
  assert.equal(resolveAppearance(preference, { ...known, lowPowerMode: true }).lowPower, "true");
  assert.deepEqual(preference, before);
  assert.deepEqual(parseSystemVisuals({ reduceTransparency: "true", lowPowerMode: 1, path: "/private", reduceMotion: false }), { ...UNKNOWN_SYSTEM_VISUALS, reduceMotion: false });
});
test("system watcher bounds reads to a focused visible window and cleans up every subscription", async () => {
  const env = environment(), values = [];let reads = 0, finish;
  const stop = watchSystemVisualPreferences(value => values.push(value), () => { reads++; return new Promise(done => { finish = done; }); }, env.surface, env.page);
  assert.equal(reads, 1);for (const timer of env.timers.values()) timer();assert.equal(reads, 1, "Pending reads are coalesced");
  finish({ ...known, reduceTransparency: true });await tick();assert.equal(values.at(-1).reduceTransparency, true);
  env.fire(env.events, "blur");for (const timer of env.timers.values()) timer();assert.equal(reads, 1);
  env.page.visibilityState = "hidden";env.fire(env.pageEvents, "visibilitychange");env.fire(env.events, "focus");assert.equal(reads, 1);
  env.page.visibilityState = "visible";env.fire(env.pageEvents, "visibilitychange");assert.equal(reads, 2);
  const before = values.length;stop();finish(known);await tick();assert.equal(values.length, before, "Late results do not update an unmounted view");
  assert.equal(env.timers.size, 0);for (const set of [...env.events.values(), ...env.pageEvents.values()]) assert.equal(set.size, 0);for (const media of env.media.values()) assert.equal(media.changes.size, 0);
});
test("media changes update motion immediately and failed native reads retain observed protections", async () => {
  const env = environment(), values = [];let fail = false;
  const stop = watchSystemVisualPreferences(value => values.push(value), async () => { if (fail) throw new Error("Unavailable"); return { ...known, reduceTransparency: true }; }, env.surface, env.page);
  await tick();fail = true;env.fire(env.events, "focus");await tick();assert.equal(values.at(-1).reduceTransparency, true);
  const motion = env.media.get("(prefers-reduced-motion: reduce)");motion.matches = true;for (const change of motion.changes) change();assert.equal(values.at(-1).reduceMotion, true);
  motion.matches = false;for (const change of motion.changes) change();assert.equal(values.at(-1).reduceMotion, false);
  stop();
});

test("a failed read degrades an observed false to unknown rather than claiming protection is off", async () => {
  const env = environment(), values = [];let fail = false;
  const stop = watchSystemVisualPreferences(value => values.push(value), async () => { if (fail) throw new Error("Unavailable"); return known; }, env.surface, env.page);
  await tick();assert.equal(values.at(-1).reduceTransparency, false);fail = true;env.fire(env.events, "focus");await tick();
  assert.equal(values.at(-1).reduceTransparency, null);assert.equal(resolveAppearance(DEFAULT_APPEARANCE, values.at(-1)).transparency, "off");stop();
});

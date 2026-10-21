import test from "node:test";
import assert from "node:assert/strict";
import { channelHistoryPage, CHANNEL_HISTORY_PAGE_SIZE } from "../src/workspace-channel-history.ts";
const rows = count => Array.from({ length: count }, (_, index) => ({ id: `record-${index}`, value: index }));
test("large local histories mount one bounded latest page without dropping stored records", () => {
  const history = rows(50001), page = channelHistoryPage(history);
  assert.equal(page.rows.length, CHANNEL_HISTORY_PAGE_SIZE); assert.equal(page.end, history.length);
  assert.equal(page.start, 49901); assert.equal(page.hasOlder, true); assert.equal(page.hasNewer, false);
  assert.equal(history.length, 50001);
});
test("both directions reach every record, including a partial oldest page, without an arbitrary history limit", () => {
  const history = rows(1003), visited = new Set(); let anchor = null, page;
  do { page = channelHistoryPage(history, anchor); page.rows.forEach(row => visited.add(row.id)); anchor = page.older; } while (page.hasOlder);
  assert.equal(visited.size, history.length); assert.equal(page.rows[0].id, history[0].id);
  while (page.hasNewer) { page = channelHistoryPage(history, page.newer); assert.ok(page.rows.length <= CHANNEL_HISTORY_PAGE_SIZE); }
  assert.equal(page.rows.at(-1).id, history.at(-1).id);
});
test("a reading anchor stays on the same page while live replies append or update", () => {
  const history = rows(250), initial = channelHistoryPage(history), reading = channelHistoryPage(history, initial.rows.at(-1).id);
  const live = [...history.map(row => ({ ...row, value: `updated-${row.value}` })), ...rows(20).map(row => ({ ...row, id: `new-${row.id}` }))];
  const updated = channelHistoryPage(live, reading.anchor);
  assert.equal(updated.start, reading.start); assert.equal(updated.end, reading.end);
  assert.equal(updated.rows.at(-1).id, reading.rows.at(-1).id); assert.equal(updated.hasNewer, true);
  assert.equal(updated.rows[0].value, "updated-150");
  assert.equal(channelHistoryPage(live).rows.at(-1).id, "new-record-19");
});
test("empty, missing and unusual identities have explicit safe page boundaries", () => {
  const empty = channelHistoryPage([], "gone"); assert.deepEqual(empty.rows, []); assert.equal(empty.hasOlder, false); assert.equal(empty.hasNewer, false);
  assert.equal(channelHistoryPage(rows(5), "removed").anchor, null);
  const identity = JSON.stringify(["turn", "message", "unicode-同事:0"]), unusual = [{ id: identity }];
  assert.equal(channelHistoryPage(unusual, identity).anchor, identity);
  for (const size of [0, -1, 1.5, Infinity]) assert.throws(() => channelHistoryPage([], null, size));
});

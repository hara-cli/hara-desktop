import test from "node:test";
import assert from "node:assert/strict";
import { workScopeDirectoryName } from "../src/work-scope-labels.ts";

test("C5 directory names keep full paths out of the default display across host platforms", () => {
  const cases = [
    ["Accounts", "/Users/synthetic/private/Accounts", "Accounts"],
    ["  财务资料  ", "/Volumes/private/ag_123", "财务资料"],
    ["Finance / invoices", "/private/invoices", "Finance / invoices"],
    [null, "/Users/synthetic/private/Accounts/", "Accounts"],
    ["", "D:\\private\\Accounts\\", "Accounts"],
    [null, "\\\\server\\private\\财务", "财务"],
    ["/Users/synthetic/private/Accounts", "/actual/registered/Reports", "Reports"],
    ["D:\\private\\Accounts", null, "Accounts"],
    [null, null, null],
    ["", "/", null],
    ["D:\\", "D:\\", null],
    ["~/Documents/Accounts", "/Users/synthetic/Documents/Accounts", "Accounts"],
    ["  ~/Documents/Accounts  ", "/registered/Reports", "Reports"],
    ["~/Documents/Accounts", null, "Accounts"],
    ["~\\Documents\\Accounts", null, "Accounts"],
    ["~", null, null],
    ["~/", null, null],
    ["~finance", "/registered/Reports", "~finance"],
  ];
  for (const [label, path, expected] of cases) assert.equal(workScopeDirectoryName(label, path), expected);
});

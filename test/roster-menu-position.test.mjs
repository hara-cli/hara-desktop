import test from "node:test";
import assert from "node:assert/strict";
import { rosterMenuPosition } from "../src/roster-menu-position.ts";
test("measured menu opens below or flips above, independent of guessed menu heights",()=>{
 assert.equal(rosterMenuPosition(40,40,250,370,900,800).top,40);
 assert.equal(rosterMenuPosition(40,700,250,370,900,800).top,330);
 assert.equal(rosterMenuPosition(40,730,250,500,900,800).top,230);
});
test("short viewports clamp both axes and constrain scrollable height",()=>{
 assert.deepEqual(rosterMenuPosition(400,180,250,500,480,240),{left:222,top:8,maxHeight:224});
 const result=rosterMenuPosition(-10,-10,250,50,200,100);assert.equal(result.left,8);assert.equal(result.top,8);assert.equal(result.maxHeight,84);
});

import test from "node:test";
import assert from "node:assert/strict";
import {AvatarImageError,avatarImageMime,squareAvatarCrop,prepareAgentAvatar} from "../src/agent-avatar-image.ts";
import {MAX_AGENT_AVATAR_BYTES} from "../src/agent-visual.ts";
test("avatar input accepts actual PNG/JPEG signatures rather than filename or claimed MIME",()=>{
 assert.equal(avatarImageMime(Uint8Array.from([137,80,78,71,13,10,26,10])),"image/png");assert.equal(avatarImageMime(Uint8Array.from([255,216,255,0])),"image/jpeg");
 for(const text of ["GIF89a","<svg>","not an image",""])assert.equal(avatarImageMime(new TextEncoder().encode(text)),null);
});
test("square cropping keeps the centre without stretching and bounds decode dimensions",()=>{
 assert.deepEqual(squareAvatarCrop(400,200),{x:100,y:0,side:200,output:200});assert.deepEqual(squareAvatarCrop(200,400),{x:0,y:100,side:200,output:200});assert.deepEqual(squareAvatarCrop(512,512),{x:0,y:0,side:512,output:256});
 for(const pair of [[0,1],[1,0],[9000,1],[8192,8192],[2.5,10]])assert.throws(()=>squareAvatarCrop(...pair),error=>error instanceof AvatarImageError&&error.code==='dimensions');
});
test("oversized, malformed and cancelled selections never reach a browser decoder",async()=>{
 let reads=0;await assert.rejects(prepareAgentAvatar({size:MAX_AGENT_AVATAR_BYTES+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0)}}),error=>error.code==='tooLarge');assert.equal(reads,0);
 await assert.rejects(prepareAgentAvatar({size:4,arrayBuffer:async()=>new TextEncoder().encode('nope').buffer}),error=>error.code==='format');
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(prepareAgentAvatar({size:1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(1)}},cancelled.signal),error=>error.name==='AbortError');assert.equal(reads,0);
 let release;const delayed=new AbortController(),pending=prepareAgentAvatar({size:8,arrayBuffer:()=>new Promise(resolve=>release=resolve)},delayed.signal);delayed.abort();release(Uint8Array.from([137,80,78,71,13,10,26,10]).buffer);await assert.rejects(pending,error=>error.name==='AbortError');
});

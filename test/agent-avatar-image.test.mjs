import test from "node:test";
import assert from "node:assert/strict";
import {AvatarImageError,avatarImageMime,avatarImageDimensions,squareAvatarCrop,prepareAgentAvatar} from "../src/agent-avatar-image.ts";
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

function pngHeader(width, height) {
 const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);view.setUint32(8,13);bytes.set([73,72,68,82],12);view.setUint32(16,width);view.setUint32(20,height);return bytes;
}
function jpegHeader(marker=0xc0,width=400,height=200) {
 const bytes=Uint8Array.from([0xff,0xd8,0xff,marker,0,17,8,0,0,0,0,3,1,0x11,0,2,0x11,0,3,0x11,0]);const view=new DataView(bytes.buffer);view.setUint16(7,height);view.setUint16(9,width);return bytes;
}
test("avatar preflight reads PNG and baseline/progressive JPEG dimensions across bounded APP segments",()=>{
 assert.deepEqual(avatarImageDimensions(pngHeader(400,200)),{width:400,height:200});
 assert.deepEqual(avatarImageDimensions(jpegHeader()),{width:400,height:200});
 const progressive=jpegHeader(0xc2,64,96), withMetadata=Uint8Array.from([0xff,0xd8,0xff,0xe1,0,6,69,120,105,102,...progressive.subarray(2)]);
 assert.deepEqual(avatarImageDimensions(withMetadata),{width:64,height:96});
 for(const bytes of [pngHeader(8192,4096),pngHeader(0,40),jpegHeader(0xc0,9000,9000)])assert.throws(()=>avatarImageDimensions(bytes),error=>error.code==='dimensions');
});
test("oversized declared dimensions are rejected before constructing Image, even below the byte limit",async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'Image');let decoders=0;
 Object.defineProperty(globalThis,'Image',{configurable:true,value:class{constructor(){decoders++;throw new Error('Decoder must not receive oversized input')}}});
 try {
  for(const bytes of [pngHeader(9000,9000),jpegHeader(0xc2,9000,9000)]){assert.ok(bytes.length<MAX_AGENT_AVATAR_BYTES);
   await assert.rejects(prepareAgentAvatar({size:bytes.length,arrayBuffer:async()=>bytes.buffer}),error=>error instanceof AvatarImageError&&error.code==='dimensions');
  }
  assert.equal(decoders,0);
 } finally {if(prior)Object.defineProperty(globalThis,'Image',prior);else delete globalThis.Image;}
});
test("truncated PNG/JPEG frame headers and invalid segment lengths fail with typed errors",()=>{
 for(const original of [pngHeader(64,64),jpegHeader()])for(let length=0;length<original.length;length++)assert.throws(()=>avatarImageDimensions(original.subarray(0,length)),error=>error instanceof AvatarImageError);
 const badPng=pngHeader(64,64);badPng[12]=0;assert.throws(()=>avatarImageDimensions(badPng),error=>error.code==='decode');
 for(const bytes of [Uint8Array.from([255,216,255,225,0,1]),Uint8Array.from([255,216,255,225,0,20,0]),Uint8Array.from([255,216,255,218,0,2]),Uint8Array.from([255,216,255,192,0,8,8,0,64,0,64,3])])assert.throws(()=>avatarImageDimensions(bytes),error=>error.code==='decode');
});

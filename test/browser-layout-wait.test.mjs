import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { layoutSampleExpression, waitForLayout } from '../scripts/browser-layout-wait.mjs';

function clock() {
  let time = 0;
  return {now: () => time, pause: async ms => { time += ms; }, deadlineMs: 100, pollMs: 10};
}

test('headless layout sampling does not depend on animation-frame or finished callbacks', async () => {
  const sample = vm.runInNewContext(layoutSampleExpression, {
    innerWidth: 1280, innerHeight: 800,
    requestAnimationFrame() { throw new Error('Frames are suspended'); },
    document: {
      readyState: 'complete', visibilityState: 'hidden',
      querySelectorAll: () => [{getBoundingClientRect: () => ({x:0,y:0,width:1280,height:800})}],
      getAnimations: () => [{playState:'running', effect:{getComputedTiming: () => ({endTime:Infinity})}, get finished() { throw new Error('Never await a running spinner'); }}],
    },
  });
  assert.equal(sample.animations, 0);
  assert.equal((await waitForLayout(async () => sample, clock())).geometry, '[1280,800,[0,0,1280,800]]');
});

test('changing geometry and finite transitions must both settle before screenshots', async () => {
  const samples = [
    {ready:false,animations:0,geometry:'a'},
    {ready:true,animations:0,geometry:'a'},
    {ready:true,animations:0,geometry:'b'},
    {ready:true,animations:1,geometry:'b'},
    ...Array.from({length:3}, () => ({ready:true,animations:0,geometry:'c'})),
  ];
  let reads = 0;
  const result = await waitForLayout(async () => {reads++; return samples.shift();}, clock());
  assert.equal(reads, 7);
  assert.equal(result.geometry, 'c');
});

test('a layout that never settles fails within the deadline with its stage and last observation', async () => {
  const timer = clock();
  await assert.rejects(waitForLayout(async () => ({ready:true,animations:1,geometry:'moving'}), {...timer,label:'dark/en channel members'}), /dark\/en channel members: layout did not settle within 100ms.*moving/);
  assert.equal(timer.now(), 100);
});

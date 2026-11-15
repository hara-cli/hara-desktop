import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WorkspaceUpdater, updateDefaults } from "../src/workspace-updater-state.ts";
import { createEngineFreeUpdater } from "../src/workspace-update-offline.ts";

async function fixture(run) {
  const counts = { requests:0, downloads:0, installs:0, restarts:0, prepares:0 };
  const server = createServer((_,response)=>{counts.requests++;response.end("fixture");});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const deps = { check:async()=>{await fetch(endpoint);return { version:"999.0.0",close:async()=>{},
      download:async()=>{counts.downloads++;await fetch(endpoint);},install:async()=>{counts.installs++;}};},
    load:async()=>updateDefaults(),save:async()=>{},activity:async()=>({running:0}),
    prepare:async()=>{counts.prepares++;return {id:"fixture"};},release:async()=>{},
    restart:async()=>{counts.restarts++;},error:()=>"fixture failure",now:()=>Infinity };
  try { await run({counts,deps}); }finally{await new Promise(resolve=>server.close(resolve));}
}
for(const entry of ["settings","engine-offline recovery"])test(`Dev ${entry}: automatic/manual/download/install paths all have zero side effects`,async()=>{
  await fixture(async({counts,deps})=>{
    const allowed=()=>false;
    const controller=entry==="settings" ? new WorkspaceUpdater({...deps,publicUpdatesAllowed:allowed})
      : createEngineFreeUpdater({...deps,storage:null,engineStopped:async()=>true,publicUpdatesAllowed:allowed});
    try{await controller.start();await controller.wake();await controller.check(true);await controller.check(false);
      await controller.download();await controller.restart();
      assert.deepEqual(counts,{requests:0,downloads:0,installs:0,restarts:0,prepares:0});
    }finally{controller.dispose();}
  });
});
test("Dev gate also refuses a previously acquired update handle",async()=>{
  await fixture(async({counts,deps})=>{
    let allowed=true;const controller=new WorkspaceUpdater({...deps,publicUpdatesAllowed:()=>allowed});
    try{await controller.check(true);await controller.download();const before={...counts};allowed=false;
      await controller.download();await controller.restart();assert.deepEqual(counts,before);
      assert.equal(counts.installs,0);assert.equal(counts.restarts,0);
    }finally{controller.dispose();}
  });
});
for(const explicit of [undefined,()=>true])test(`formal updater retains check/download/lease/install/restart (${explicit?"allowed":"default"})`,async()=>{
  await fixture(async({counts,deps})=>{
    const controller=new WorkspaceUpdater({...deps,publicUpdatesAllowed:explicit});
    try{await controller.check(true);assert.equal(counts.requests,1);assert.equal(counts.downloads,0);
      await controller.download();assert.equal(counts.requests,2);assert.equal(counts.installs,0);
      await controller.restart();assert.deepEqual(counts,{requests:2,downloads:1,installs:1,restarts:1,prepares:1});
    }finally{controller.dispose();}
  });
});

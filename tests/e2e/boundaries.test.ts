import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSpec, candidateDiff, cropPng } from "../../src/pipeline.js";
import type { Snapshot } from "../../src/protocol.js";

for(const size of [16,64] as const)for(const colorMode of ["indexed","rgb"] as const)test(`${size}x${size} ${colorMode} preserves boundaries`,async()=>{
  const fixture=JSON.parse(await readFile(new URL(`../fixtures/${size}-${colorMode}.json`,import.meta.url),"utf8")); assert.equal(fixture.width,size);
  const mask={bounds:{x:size-1,y:size-1,width:1,height:1},bits:"AQ=="};
  const snapshot={token:`${size}-${colorMode}`,spriteId:1,width:size,height:size,colorMode,frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:0x000000ff},{index:1,rgba:0xffffffff}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0]}} satisfies Snapshot;
  assert.ok(cropPng(snapshot).length>0);
  assert.deepEqual(candidateDiff({snapshotToken:snapshot.token,bounds:mask.bounds,paletteRefs:[1]},snapshot,buildSpec(snapshot,"edge")).changes,[{x:size-1,y:size-1,paletteRef:1}]);
});

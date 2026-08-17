import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec, candidateDiff, Pipeline } from "../../src/pipeline.js";
import { FakeProvider } from "../../src/provider.js";
import type { Snapshot } from "../../src/protocol.js";

const mask={bounds:{x:20,y:10,width:2,height:3},bits:"Pw=="};
const snapshot={token:"arm",spriteId:1,width:32,height:32,colorMode:"indexed",frame:1,activeLayerUuid:"arm-layer",layers:[{uuid:"arm-layer",imageId:1,imageVersion:1,editable:true},{uuid:"body",imageId:2,imageVersion:1,editable:true}],palette:[{index:0,rgba:255},{index:1,rgba:0xffffffff},{index:2,rgba:0xff0000ff}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0,0,0,0,0,0]}} satisfies Snapshot;

test("Indexed 32x32 arm replacement changes only the authorized mask",async()=>{
  const before=new Array(32*32).fill(0),body=[1,2,3],otherFrame=[4,5];
  const candidate={snapshotToken:"arm",bounds:mask.bounds,paletteRefs:[1,1,1,2,2,-1]};
  const result=await new Pipeline(new FakeProvider([candidate])).generate(snapshot,buildSpec(snapshot,"replace arm",{semanticRequirements:["shoulder connection","preserve torso"]}));
  const after=[...before]; for(const p of result.diff.changes)after[p.y*32+p.x]=p.paletteRef;
  for(let i=0;i<after.length;i++)if(i%32<20||i%32>21||Math.floor(i/32)<10||Math.floor(i/32)>12)assert.equal(after[i],before[i]);
  assert.deepEqual(body,[1,2,3]); assert.deepEqual(otherFrame,[4,5]); assert.equal(result.confirmationRequired,true);
});

test("invalid generation fails atomically after three attempts",async()=>{
  const document=new Array(6).fill(0),bad={snapshotToken:"arm",bounds:mask.bounds,paletteRefs:[99,0,0,0,0,0]};
  await assert.rejects(new Pipeline(new FakeProvider([bad,bad,bad])).generate(snapshot,buildSpec(snapshot,"arm")),/attempts_exhausted/);
  assert.deepEqual(document,new Array(6).fill(0));
});

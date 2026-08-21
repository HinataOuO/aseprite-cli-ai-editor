import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec,candidateDiff,hashCandidate } from "../src/pipeline.js";
import type { Snapshot } from "../src/protocol.js";

const mask={bounds:{x:0,y:0,width:2,height:2},bits:"Dw=="};
const snapshot:Snapshot={token:"t",spriteId:1,width:32,height:32,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true},{uuid:"b",imageId:2,imageVersion:1,editable:true}],palette:[{index:0,rgba:255}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0,0,0,0]}};

test("spec authorization is immutable and selection wins",()=>{
  const spec=buildSpec(snapshot,"arm",{proposedMask:{bounds:{x:0,y:0,width:1,height:1},bits:"AQ=="}});
  assert.deepEqual(spec.mask,mask); assert.throws(()=>{(spec.layerUuids as string[]).push("b")}); assert.throws(()=>{spec.mask.bounds.width=9});
});

test("multi-layer requires explicit confirmation",()=>{
  assert.throws(()=>buildSpec(snapshot,"arm",{layerUuids:["a","b"]}),/confirmation_required/);
  assert.deepEqual(buildSpec(snapshot,"arm",{layerUuids:["a","b"],confirmed:true}).layerUuids,["a","b"]);
  assert.throws(()=>buildSpec(snapshot,"arm",{layerUuids:["a","missing"],confirmed:true}),/unauthorized_change/);
});

test("candidate conversion cannot alter pixels outside mask",()=>{
  const sparse={...snapshot,palette:[...snapshot.palette,{index:1,rgba:0xff0000ff}],selection:{...mask,bits:"BQ=="},crop:{bounds:mask.bounds,paletteRefs:[0,0,0,0]}};
  const candidate={snapshotToken:"t",bounds:mask.bounds,paletteRefs:[1,0,1,0]};
  const diff=candidateDiff(candidate,sparse,buildSpec(sparse,"paint"));
  assert.deepEqual(diff.changes.map(({x,y})=>[x,y]),[[0,0],[0,1]]);
});

test("candidate palette participates in hash and diff",()=>{
  const spec=buildSpec(snapshot,"palette");
  const first={snapshotToken:snapshot.token,bounds:spec.mask.bounds,paletteRefs:[1,1,1,1],palette:[{index:0,rgba:0},{index:1,rgba:0xff0000ff}]};
  const second={...first,palette:[{index:0,rgba:0},{index:1,rgba:0x00ff00ff}]};
  assert.notEqual(hashCandidate(first),hashCandidate(second));assert.deepEqual(candidateDiff(first,snapshot,spec).palette,first.palette);
});

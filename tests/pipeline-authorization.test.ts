import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec } from "../src/pipeline.js";
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


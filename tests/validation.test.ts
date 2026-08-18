import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec, candidateDiff } from "../src/pipeline.js";
import { validatePixelDiff, type Snapshot } from "../src/protocol.js";

const mask={bounds:{x:2,y:3,width:2,height:2},bits:"BQ=="}; // pixels 0 and 2 only
const snapshot={token:"t",spriteId:1,width:16,height:16,colorMode:"indexed",frame:2,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255},{index:1,rgba:0xffffffff}],transparentIndex:0,selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0,0,0,0]}} satisfies Snapshot;
const spec=buildSpec(snapshot,"edit");
const candidate=(overrides:Record<string,unknown>={})=>({snapshotToken:"t",bounds:mask.bounds,paletteRefs:[1,0,-1,0],...overrides});

test("valid candidate yields minimal canvas-coordinate diff",()=>assert.deepEqual(candidateDiff(candidate(),snapshot,spec).changes,[{x:2,y:3,paletteRef:1},{x:2,y:4,paletteRef:-1}]));

test("compact spans coexist with legacy changes within the expanded pixel limit",()=>{
  const diff=validatePixelDiff({snapshotToken:"t",spriteId:1,frame:2,layerUuid:"a",changes:[{x:0,y:0,paletteRef:1}],spans:[{x:1,y:0,length:4095,paletteRef:-1}]});
  assert.equal(diff.changes.length,1); assert.equal(diff.spans?.[0]?.length,4095);
  assert.deepEqual(validatePixelDiff({...diff,changes:undefined}).changes,[]);
  assert.throws(()=>validatePixelDiff({...diff,spans:[{x:0,y:0,length:4096,paletteRef:1}]}),/4096/);
  assert.throws(()=>validatePixelDiff({...diff,spans:[{x:0,y:0,length:0,paletteRef:1}]}),/integer/);
});
for(const [name,value,pattern] of [
  ["snapshot",candidate({snapshotToken:"old"}),/stale_snapshot/],
  ["dimensions",candidate({bounds:{...mask.bounds,width:1}}),/candidate paletteRefs|stale_snapshot/],
  ["palette",candidate({paletteRefs:[9,0,0,0]}),/palette/],
  ["mask",candidate({paletteRefs:[0,1,0,0]}),/mask/],
  ["transparency",candidate({paletteRefs:[-2,0,0,0]}),/paletteRefs/]
] as const)test(`rejects ${name}`,()=>assert.throws(()=>candidateDiff(value,snapshot,spec),pattern));

test("frame and layer cannot be amplified",()=>{
  assert.equal(candidateDiff(candidate(),snapshot,spec).frame,2);
  assert.throws(()=>candidateDiff(candidate(),snapshot,{...spec,layerUuids:["missing"]}),/stale_snapshot|unknown|layer/);
});

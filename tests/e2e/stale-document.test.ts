import assert from "node:assert/strict";
import test from "node:test";
import { assertFresh, buildSpec, Pipeline } from "../../src/pipeline.js";
import { FakeProvider } from "../../src/provider.js";
import type { Snapshot } from "../../src/protocol.js";

test("document mutation during Vision invalidates snapshot",()=>{
  const before={token:"before",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255}]} satisfies Snapshot;
  const duringVision={...before,token:"after",layers:[{...before.layers[0]!,imageVersion:2}]};
  assert.throws(()=>assertFresh(before,duringVision),/stale_snapshot/);
});

test("pipeline aborts when image version changes while provider runs",async()=>{
  const mask={bounds:{x:0,y:0,width:1,height:1},bits:"AQ=="};
  const before={token:"before",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0]}} satisfies Snapshot;
  const changed={...before,token:"changed",layers:[{...before.layers[0]!,imageVersion:2}]};
  const provider=new FakeProvider([{snapshotToken:"before",bounds:mask.bounds,paletteRefs:[0]}]);
  await assert.rejects(new Pipeline(provider,{getCurrentSnapshot:async()=>changed}).generate(before,buildSpec(before,"arm")),/stale_snapshot/);
  assert.equal(provider.requests.length,1);
});

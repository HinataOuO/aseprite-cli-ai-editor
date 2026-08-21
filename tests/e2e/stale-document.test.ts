import assert from "node:assert/strict";
import test from "node:test";
import { assertFresh } from "../../src/pipeline.js";
import type { Snapshot } from "../../src/protocol.js";

test("document mutation during Vision invalidates snapshot",()=>{
  const before={token:"before",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255}]} satisfies Snapshot;
  const duringVision={...before,token:"after",layers:[{...before.layers[0]!,imageVersion:2}]};
  assert.throws(()=>assertFresh(before,duringVision),/stale_snapshot/);
});

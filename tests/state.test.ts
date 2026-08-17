import assert from "node:assert/strict";
import test from "node:test";
import { hashSnapshot } from "../src/pipeline.js";
import type { Snapshot } from "../src/protocol.js";

const snapshot={spriteId:1,width:32,height:32,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255}],crop:{bounds:{x:0,y:0,width:1,height:1},paletteRefs:[0]}} satisfies Omit<Snapshot,"token">;

test("snapshot hash is stable and changes on authorizing state",()=>{
  const hash=hashSnapshot(snapshot); assert.equal(hashSnapshot(structuredClone(snapshot)),hash);
  for(const changed of [
    {...snapshot,frame:2},
    {...snapshot,layers:[{...snapshot.layers[0]!,imageVersion:2}]},
    {...snapshot,palette:[{index:0,rgba:0}]},
    {...snapshot,crop:{...snapshot.crop,paletteRefs:[-1]}}
  ]) assert.notEqual(hashSnapshot(changed as typeof snapshot),hash);
});

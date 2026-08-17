import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec, candidateDiff } from "../src/pipeline.js";
import type { Snapshot } from "../src/protocol.js";

test("snapshot mismatch rejects before document mutation",()=>{
  const mask={bounds:{x:0,y:0,width:1,height:1},bits:"AQ=="};
  const snapshot={token:"new",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:2,editable:true}],palette:[{index:0,rgba:255}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0]}} satisfies Snapshot;
  const document=[0];
  assert.throws(()=>{const diff=candidateDiff({snapshotToken:"old",bounds:mask.bounds,paletteRefs:[-1]},snapshot,buildSpec(snapshot,"x")); for(const change of diff.changes)document[change.x]=change.paletteRef},/stale_snapshot/);
  assert.deepEqual(document,[0]);
});

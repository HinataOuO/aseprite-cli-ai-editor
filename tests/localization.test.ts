import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec, localizationAction, Pipeline } from "../src/pipeline.js";
import { FakeProvider } from "../src/provider.js";
import type { Snapshot } from "../src/protocol.js";

test("localization boundaries and bootstrap",()=>{
  assert.equal(localizationAction(69.9,true,30),"retry");
  assert.equal(localizationAction(70,true,30),"confirm");
  assert.equal(localizationAction(90,true,30),"confirm");
  assert.equal(localizationAction(90.1,true,30),"auto");
  assert.equal(localizationAction(99,true,29),"confirm");
  assert.equal(localizationAction(99,false,99),"confirm");
});

test("corrected mask becomes sole authorization",()=>{
  const corrected={bounds:{x:1,y:1,width:1,height:1},bits:"AQ=="};
  const snapshot={token:"t",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:null,imageVersion:null,editable:true}],palette:[{index:0,rgba:255}],crop:{bounds:corrected.bounds,paletteRefs:[0]}} satisfies Snapshot;
  assert.deepEqual(buildSpec(snapshot,"x",{proposedMask:corrected,confirmed:true}).mask,corrected);
});

test("provider unavailable stops without retries",async()=>{
  const mask={bounds:{x:0,y:0,width:1,height:1},bits:"AQ=="};
  const snapshot={token:"t",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:null,imageVersion:null,editable:true}],palette:[{index:0,rgba:255}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0]}} satisfies Snapshot;
  const provider=new FakeProvider([new Error("provider_unavailable")]);
  await assert.rejects(new Pipeline(provider).generate(snapshot,buildSpec(snapshot,"x")),/provider_unavailable/);
  assert.equal(provider.requests.length,1);
});

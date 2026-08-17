import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec, Pipeline } from "../src/pipeline.js";
import { FakeProvider } from "../src/provider.js";
import type { Snapshot } from "../src/protocol.js";

const mask={bounds:{x:0,y:0,width:1,height:1},bits:"AQ=="};
const snapshot={token:"t",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255},{index:1,rgba:0xffffffff}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[0]}} satisfies Snapshot;
const bad={snapshotToken:"t",bounds:mask.bounds,paletteRefs:[9]}, good={snapshotToken:"t",bounds:mask.bounds,paletteRefs:[1]};

test("retries at most three times without resending document or authorization",async()=>{
  const provider=new FakeProvider([bad,bad,good]); const result=await new Pipeline(provider).generate(snapshot,buildSpec(snapshot,"arm"));
  assert.equal(result.attempts,3); assert.ok(provider.requests[0]!.cropPngBase64); assert.equal(provider.requests[1]!.cropPngBase64,undefined);
  assert.equal(provider.requests[1]!.mask,undefined); assert.equal(provider.requests[2]!.intent,undefined);
});

test("semantic retry carries only prior diff and errors",async()=>{
  const provider=new FakeProvider([good,good]); let scores=0;
  const result=await new Pipeline(provider,{semanticApproved:true,evaluateSemantic:()=>++scores===1?49:80}).generate(snapshot,buildSpec(snapshot,"arm"));
  assert.equal(result.attempts,2); assert.ok(provider.requests[1]!.previousDiff); assert.match(provider.requests[1]!.errors![0]!,/semantic_score/); assert.equal(result.confirmationRequired,false);
});

test("stops after third invalid candidate",async()=>{
  const provider=new FakeProvider([bad,bad,bad,good]);
  await assert.rejects(new Pipeline(provider).generate(snapshot,buildSpec(snapshot,"arm")),/attempts_exhausted/);
  assert.equal(provider.requests.length,3);
});

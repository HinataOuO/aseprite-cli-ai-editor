import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { EditOrchestrator } from "../src/editor.js";
import { FakeProvider } from "../src/provider.js";
import type { Snapshot } from "../src/protocol.js";

const mask={bounds:{x:2,y:3,width:2,height:1},bits:"Aw=="};
const snapshot:Snapshot={token:"fresh",spriteId:7,width:16,height:16,colorMode:"indexed",activeCelColorMode:"indexed",frame:1,activeLayerUuid:"layer",layers:[{uuid:"layer",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255},{index:1,rgba:0xff0000ff},{index:2,rgba:0x00ff00ff}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[1,1]}};
const candidate={snapshotToken:"fresh",bounds:mask.bounds,paletteRefs:[1,2]};

class FakeBridge {
  requests:{type:string;payload:unknown}[]=[];
  current:Snapshot=structuredClone(snapshot);
  async request<T>(type:string,payload:unknown):Promise<T>{
    this.requests.push({type,payload});
    if(type==="read_snapshot"){
      const includeCrop=(payload as {includeCrop:boolean}).includeCrop;
      const value=structuredClone(this.current); if(!includeCrop)delete value.crop;
      return value as T;
    }
    if(type==="apply_diff")return {applied:1,token:"after",verified:true,layerUuid:"layer"} as T;
    throw new Error("unexpected request");
  }
}

test("prepare stores dense candidate and commit consumes its verified diff",async()=>{
  const bridge=new FakeBridge(),provider=new FakeProvider([candidate]);
  const editor=new EditOrchestrator(bridge,provider);
  const prepared=await editor.prepare("replace pixel","edit_current");
  assert.equal(prepared.changedPixels,1);
  assert.deepEqual(PNG.sync.read(Buffer.from(prepared.previewPngBase64,"base64")).data.length,8);
  assert.deepEqual(bridge.requests.map(request=>request.type),["read_snapshot"]);
  assert.match(provider.requests[0]!.artisticPrompt,/ART BRIEF/);assert.equal(provider.requests[0]!.candidateSchema.paletteRefs.length,2);
  const committed=await editor.commit(prepared.candidateId);
  assert.equal(committed.candidateHash,prepared.candidateHash);
  assert.deepEqual(bridge.requests.map(request=>request.type),["read_snapshot","read_snapshot","apply_diff"]);
  const diff=(bridge.requests[2]!.payload as {diff:{changes:unknown[]}}).diff;
  assert.equal(diff.changes.length,1);
  await assert.rejects(editor.commit(prepared.candidateId),/consumed candidate/);
});

test("new-layer generation compares against transparency",async()=>{
  const bridge=new FakeBridge();
  const editor=new EditOrchestrator(bridge,new FakeProvider([{...candidate,paletteRefs:[-1,2]}]));
  const prepared=await editor.prepare("redraw","generate_new_layer");
  assert.equal(prepared.changedPixels,1);
  await editor.commit(prepared.candidateId);
  const diff=(bridge.requests.at(-1)!.payload as {diff:{createLayer?:boolean;changes:unknown[]}}).diff;
  assert.equal(diff.createLayer,true); assert.equal(diff.changes.length,1);
});

test("stale commit consumes candidate without writing",async()=>{
  const bridge=new FakeBridge();
  const editor=new EditOrchestrator(bridge,new FakeProvider([candidate]));
  const prepared=await editor.prepare("edit","edit_current");
  bridge.current={...bridge.current,token:"changed"};
  await assert.rejects(editor.commit(prepared.candidateId),/stale_snapshot/);
  assert.equal(bridge.requests.some(request=>request.type==="apply_diff"),false);
  await assert.rejects(editor.commit(prepared.candidateId),/consumed candidate/);
});

test("new preparation invalidates the previous candidate for the sprite",async()=>{
  const bridge=new FakeBridge();
  const editor=new EditOrchestrator(bridge,new FakeProvider([candidate,candidate]));
  const first=await editor.prepare("first","edit_current");
  const second=await editor.prepare("second","edit_current");
  await assert.rejects(editor.commit(first.candidateId),/consumed candidate/);
  await editor.commit(second.candidateId);
});

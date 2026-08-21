import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { PNG } from "pngjs";
import { EditOrchestrator } from "../src/editor.js";
import { MAX_PNG_BYTES } from "../src/pixel-art-fixer.js";
import type { Snapshot } from "../src/protocol.js";
import { pngResult } from "./png.js";

const mask={bounds:{x:2,y:3,width:2,height:1},bits:"AQ=="};
const snapshot:Snapshot={token:"fresh",spriteId:7,width:128,height:128,colorMode:"indexed",frame:1,activeLayerUuid:"layer",layers:[{uuid:"layer",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255},{index:1,rgba:0xff0000ff},{index:2,rgba:0x00ff00ff}],selection:mask,crop:{bounds:mask.bounds,paletteRefs:[1,1]}};

class Bridge {
  current=structuredClone(snapshot);applied:unknown;
  async request<T>(type:string,payload:unknown):Promise<T>{
    if(type==="read_snapshot"){const value=structuredClone(this.current);if(!(payload as {includeCrop:boolean}).includeCrop)delete value.crop;return value as T}
    if(type==="apply_diff"){this.applied=payload;return {applied:1,token:"after",verified:true,layerUuid:"layer"} as T}
    throw new Error(`unexpected ${type}`);
  }
}

async function setup(t:TestContext,ttl=300_000){
  const root=await mkdtemp(path.join(os.tmpdir(),"aseprite-agent-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const bridge=new Bridge(),editor=new EditOrchestrator(bridge,ttl,root);
  return {root,bridge,editor};
}

const exists=async(value:string)=>stat(value).then(()=>true,()=>false);

test("host PNG flow freezes authorization, restores outside-mask pixels, cleans source, and commits",async t=>{
  const {root,bridge,editor}=await setup(t);
  const brief=await editor.beginAgent("paint green","edit_current");
  assert.equal(brief.outputPath,path.join(root,brief.sessionId,"generated.png"));assert.equal(brief.logicalSize.width,2);assert.match(brief.artBrief,/ART BRIEF/);assert.equal(brief.maxSubmissions,3);
  await writeFile(brief.outputPath,Buffer.from(pngResult([2,2],2,1,snapshot.palette).pngBase64,"base64"));
  const prepared=await editor.submitAgentPng(brief.sessionId);
  assert.equal(prepared.changedPixels,1);assert.equal(await exists(path.dirname(brief.outputPath)),false);
  await editor.commit(prepared.candidateId);
  const diff=(bridge.applied as {diff:{changes:{x:number;y:number;paletteRef:number}[]}}).diff;
  assert.deepEqual(diff.changes,[{x:2,y:3,paletteRef:2}]);
});

test("invalid PNG can be rewritten twice, then third failure expires and cleans the session",async t=>{
  const {editor}=await setup(t);const brief=await editor.beginAgent("paint","edit_current");
  for(const remaining of [2,1]){await writeFile(brief.outputPath,"not png");await assert.rejects(editor.submitAgentPng(brief.sessionId),new RegExp(`submissions_remaining=${remaining}`));assert.equal(await exists(brief.outputPath),false)}
  await writeFile(brief.outputPath,"still not png");await assert.rejects(editor.submitAgentPng(brief.sessionId),/attempts_exhausted/);assert.equal(await exists(path.dirname(brief.outputPath)),false);
});

test("rejects huge files, file symlinks, replaced session directories, stale snapshots, and expiry",async t=>{
  const {editor,bridge}=await setup(t);
  let brief=await editor.beginAgent("paint","edit_current");await writeFile(brief.outputPath,Buffer.alloc(MAX_PNG_BYTES+1));await assert.rejects(editor.submitAgentPng(brief.sessionId),/size/);
  const target=path.join(path.dirname(path.dirname(brief.outputPath)),"outside.png");await writeFile(target,Buffer.from(pngResult([2,2],2,1,snapshot.palette).pngBase64,"base64"));await symlink(target,brief.outputPath);await assert.rejects(editor.submitAgentPng(brief.sessionId),/non-symlink/);assert.equal(await exists(target),true);
  brief=await editor.beginAgent("paint","edit_current");const outside=await mkdtemp(path.join(os.tmpdir(),"aseprite-outside-"));t.after(()=>rm(outside,{recursive:true,force:true}));await rm(path.dirname(brief.outputPath),{recursive:true});await symlink(outside,path.dirname(brief.outputPath));await assert.rejects(editor.submitAgentPng(brief.sessionId),/unsafe agent image directory/);
  brief=await editor.beginAgent("paint","edit_current");bridge.current.token="changed";await writeFile(brief.outputPath,await readFile(target));await assert.rejects(editor.submitAgentPng(brief.sessionId),/stale_snapshot/);bridge.current.token="fresh";
  const expiring=await setup(t,20),expired=await expiring.editor.beginAgent("paint","edit_current");await new Promise(resolve=>setTimeout(resolve,40));await assert.rejects(expiring.editor.submitAgentPng(expired.sessionId),/expired|unknown/);assert.equal(await exists(path.dirname(expired.outputPath)),false);
});

test("accepts a full 128x128 host image at the expanded diff limit",async t=>{
  const {editor,bridge}=await setup(t),size=128,refs=Array(size*size).fill(1);
  bridge.current={...bridge.current,selection:{bounds:{x:0,y:0,width:size,height:size},bits:Buffer.alloc(size*size/8,255).toString("base64")},crop:{bounds:{x:0,y:0,width:size,height:size},paletteRefs:refs}};
  const brief=await editor.beginAgent("recolor","edit_current");await writeFile(brief.outputPath,Buffer.from(pngResult(Array(size*size).fill(2),size,size,snapshot.palette).pngBase64,"base64"));
  const prepared=await editor.submitAgentPng(brief.sessionId);assert.equal(prepared.changedPixels,size*size);
});

test("stale session directories are removed before host generation",async t=>{
  const {root,editor}=await setup(t,50);
  const stale=path.join(root,"00000000-0000-0000-0000-000000000000");await mkdir(stale);await utimes(stale,new Date(0),new Date(0));
  const brief=await editor.beginAgent("paint","edit_current");assert.equal(await exists(stale),false);
  await writeFile(brief.outputPath,Buffer.from(pngResult([2,1],2,1,snapshot.palette).pngBase64,"base64"));
  await editor.submitAgentPng(brief.sessionId);
});

test("new layers contain source while current edits keep cover alignment",async t=>{
  const {editor,bridge}=await setup(t),size=4;
  bridge.current={...bridge.current,selection:{bounds:{x:0,y:0,width:size,height:size},bits:Buffer.from([255,255]).toString("base64")},crop:{bounds:{x:0,y:0,width:size,height:size},paletteRefs:Array(size*size).fill(1)}};
  const source=pngResult([...Array(4).fill(1),...Array(4).fill(2),...Array(4).fill(3)],12,1,[...snapshot.palette,{index:3,rgba:0x0000ffff}],4).pngBase64;
  bridge.current.palette=[...snapshot.palette,{index:3,rgba:0x0000ffff}];
  const generated=await editor.beginAgent("restyle","generate_new_layer");await writeFile(generated.outputPath,Buffer.from(source,"base64"));
  const contained=PNG.sync.read(Buffer.from((await editor.submitAgentPng(generated.sessionId)).previewPngBase64,"base64"));
  assert.ok([...Array(size).keys()].every(x=>contained.data[x*4+3]===0&&contained.data[((size-1)*size+x)*4+3]===0));
  const current=await editor.beginAgent("recolor","edit_current");await writeFile(current.outputPath,Buffer.from(source,"base64"));
  const covered=PNG.sync.read(Buffer.from((await editor.submitAgentPng(current.sessionId)).previewPngBase64,"base64"));
  assert.ok([...covered.data].every((value,index)=>value===[0,255,0,255][index%4]));
});

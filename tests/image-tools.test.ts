import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { EditOrchestrator } from "../src/editor.js";
import type { PixelDiff, Snapshot } from "../src/protocol.js";

const bounds={x:2,y:3,width:4,height:4},palette=[{index:1,rgba:0xff0000ff},{index:2,rgba:0x00ff00ff},{index:3,rgba:0x0000ffff}];
const snapshot:Snapshot={token:"fresh",spriteId:9,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"base",layers:[{uuid:"base",imageId:1,imageVersion:1,editable:true}],palette,documentEmpty:true,selection:{bounds,bits:"//8="},crop:{bounds,paletteRefs:Array(16).fill(-1)}};
const source=()=>{const png=new PNG({width:12,height:4});for(let y=0;y<4;y++)for(let x=0;x<12;x++){const rgba=x<4?[255,0,0,255]:x<8?[0,255,0,255]:[0,0,255,255],i=(y*12+x)*4;png.data.set(rgba,i)}return PNG.sync.write(png)};

class Bridge{
  applied:PixelDiff|undefined;reads=0;empty=true;usedRgba:number[]=[];
  async request<T>(type:string,payload:unknown):Promise<T>{
    if(type==="read_snapshot"){this.reads++;const value=structuredClone(snapshot);value.documentEmpty=this.empty;value.usedRgba=[...this.usedRgba];if(!(payload as {includeCrop:boolean}).includeCrop)delete value.crop;return value as T}
    if(type==="apply_diff"){this.applied=(payload as {diff:PixelDiff}).diff;return {applied:16,token:"after",verified:true,layerUuid:"ai"} as T}
    throw new Error(`unexpected ${type}`);
  }
}

test("image import prepares contain/cover previews without mutation, then commits same candidate to a new layer",async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aseprite-import-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const imagePath=path.join(root,"bands.png");await writeFile(imagePath,source());
  const bridge=new Bridge(),editor=new EditOrchestrator(bridge,300_000,undefined,{imageInputRoot:root});
  const contained=await editor.prepareImageImport(imagePath,"contain");assert.equal(bridge.applied,undefined);assert.equal(contained.changedPixels,3);
  const containPng=PNG.sync.read(Buffer.from(contained.previewPngBase64,"base64"));
  assert.deepEqual([...Array(4).keys()].map(y=>[...Array(4).keys()].filter(x=>containPng.data[(y*4+x)*4+3]!>0).length),[0,3,0,0]);
  const covered=await editor.prepareImageImport(imagePath,"cover");assert.equal(bridge.applied,undefined);assert.equal(covered.changedPixels,16);
  const coverPng=PNG.sync.read(Buffer.from(covered.previewPngBase64,"base64"));assert.ok([...Array(16).keys()].every(i=>coverPng.data[i*4]===0&&coverPng.data[i*4+1]===255&&coverPng.data[i*4+2]===0&&coverPng.data[i*4+3]===255));
  await assert.rejects(editor.commit(contained.candidateId),/unknown or consumed/);
  const committed=await editor.commit(covered.candidateId),applied=bridge.applied as PixelDiff|undefined;assert.equal(committed.layerUuid,"ai");assert.equal(applied?.createLayer,true);
  assert.equal((applied?.spans??[]).reduce((sum,span)=>sum+span.length,0),16);
});

test("prompt generation uses provider preview and leaves Aseprite untouched before commit",async()=>{
  const bridge=new Bridge();let requests=0;
  const fetchMock=(async()=>{requests++;return new Response(JSON.stringify({data:[{b64_json:source().toString("base64")}]}))}) as typeof fetch;
  const editor=new EditOrchestrator(bridge,300_000,undefined,{imageProvider:{apiKey:"test",fetch:fetchMock}});
  const prepared=await editor.preparePromptGeneration("green slime 32x32","cover");
  assert.equal(requests,1);assert.equal(bridge.applied,undefined);assert.equal(prepared.changedPixels,16);assert.match(prepared.instructions,/approval.*commit_edit/);
});

test("extract import returns exact preview palette and commits it",async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aseprite-extract-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const imagePath=path.join(root,"bands.png");await writeFile(imagePath,source());
  const bridge=new Bridge(),editor=new EditOrchestrator(bridge,300_000,undefined,{imageInputRoot:root});
  const prepared=await editor.prepareImageImport(imagePath,"cover",undefined,"extract",3);
  assert.deepEqual(prepared.palette?.map(entry=>entry.index),prepared.palette?.map((_,index)=>index));assert.ok((prepared.palette?.length??0)<=3);assert.equal(prepared.palette?.[0]?.rgba,0);
  const preview=PNG.sync.read(Buffer.from(prepared.previewPngBase64,"base64")),shown=new Set<number>();
  for(let i=0;i<preview.width*preview.height;i++)shown.add((((preview.data[i*4]!<<24)|(preview.data[i*4+1]!<<16)|(preview.data[i*4+2]!<<8)|preview.data[i*4+3]!)>>>0));
  assert.deepEqual(shown,new Set(prepared.palette?.slice(1).map(entry=>entry.rgba)));
  await editor.commit(prepared.candidateId);assert.deepEqual(bridge.applied?.palette,prepared.palette);assert.equal(bridge.applied?.createLayer,true);
});

test("extract rejects nonempty document during preparation and commit",async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aseprite-extract-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const imagePath=path.join(root,"bands.png");await writeFile(imagePath,source());
  const bridge=new Bridge(),editor=new EditOrchestrator(bridge,300_000,undefined,{imageInputRoot:root});
  bridge.empty=false;bridge.usedRgba=[0x123456ff];await assert.rejects(editor.prepareImageImport(imagePath,"cover",undefined,"extract",24),/unsupported_document/);
  bridge.empty=true;bridge.usedRgba=[];const prepared=await editor.prepareImageImport(imagePath,"cover",undefined,"extract",24);
  bridge.empty=false;bridge.usedRgba=[0x123456ff];await assert.rejects(editor.commit(prepared.candidateId),/unsupported_document/);assert.equal(bridge.applied,undefined);
});

test("auto replaces compatible palette and falls back to current palette when incompatible",async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aseprite-auto-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const imagePath=path.join(root,"bands.png");await writeFile(imagePath,source());
  const bridge=new Bridge(),editor=new EditOrchestrator(bridge,300_000,undefined,{imageInputRoot:root});
  const empty=await editor.prepareImageImport(imagePath,"cover");assert.ok(empty.palette);
  bridge.empty=false;bridge.usedRgba=[0x00ff00ff];
  const compatible=await editor.prepareImageImport(imagePath,"cover");assert.ok(compatible.palette?.some(entry=>entry.rgba===0x00ff00ff));
  bridge.usedRgba=[0x123456ff];
  const incompatible=await editor.prepareImageImport(imagePath,"cover");assert.equal(incompatible.palette,undefined);
  await assert.rejects(editor.prepareImageImport(imagePath,"cover",undefined,"extract"),/unsupported_document/);
});

test("extract prompt sends requested limit without current palette",async()=>{
  const bridge=new Bridge();let body="";
  const fetchMock=(async(_url,init)=>{body=String(init?.body);return new Response(JSON.stringify({data:[{b64_json:source().toString("base64")}]}))}) as typeof fetch;
  const editor=new EditOrchestrator(bridge,300_000,undefined,{imageProvider:{apiKey:"test",fetch:fetchMock}});
  const prepared=await editor.preparePromptGeneration("new sprite","cover","extract",5);
  assert.ok((prepared.palette?.length??999)<=5);assert.match(body,/at most 5 colors including transparency/i);assert.doesNotMatch(body,/Allowed Aseprite palette|Aseprite palette \(index: RGBA\)|ff0000ff/i);
});

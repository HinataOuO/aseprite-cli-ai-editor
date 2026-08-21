import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { generateImagePng, readLocalPng } from "../src/image-input.js";

const png=(width=2,height=2)=>{const image=new PNG({width,height});image.data.fill(255);return PNG.sync.write(image)};

test("local PNG input stays inside root and rejects unsafe or invalid files",async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aseprite-input-")),outside=await mkdtemp(path.join(os.tmpdir(),"aseprite-outside-"));
  t.after(()=>Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})]));
  const valid=path.join(root,"valid.png");await writeFile(valid,png());assert.equal(Buffer.from(await readLocalPng(valid,root),"base64").equals(png()),true);
  const external=path.join(outside,"external.png");await writeFile(external,png());await assert.rejects(readLocalPng(external,root),/outside/);
  const link=path.join(root,"link.png");await symlink(external,link);await assert.rejects(readLocalPng(link,root),/non-symlink/);
  const wrong=path.join(root,"image.jpg");await writeFile(wrong,png());await assert.rejects(readLocalPng(wrong,root),/PNG file/);
  const corrupt=path.join(root,"corrupt.png");await writeFile(corrupt,"not a png");await assert.rejects(readLocalPng(corrupt,root),/size|header/);
  const huge=path.join(root,"huge.png");await writeFile(huge,Buffer.alloc(8*1024*1024+1));await assert.rejects(readLocalPng(huge,root),/8 MiB/);
  const wide=path.join(root,"wide.png");await writeFile(wide,png(1536,1));assert.ok(await readLocalPng(wide,root));
  const tooWide=path.join(root,"too-wide.png");await writeFile(tooWide,png(2049,1));await assert.rejects(readLocalPng(tooWide,root),/2048x2048/);
});

test("OpenAI generation sends enriched PNG request and returns base64",async()=>{
  let seen:{url:string;init:RequestInit}|undefined;
  const fetchMock=async(input:string|URL|Request,init?:RequestInit)=>{seen={url:String(input),init:init!};return new Response(JSON.stringify({data:[{b64_json:png().toString("base64")}]}),{status:200,headers:{"content-type":"application/json"}})};
  const result=await generateImagePng("green slime",{bounds:{x:0,y:0,width:32,height:32},palette:[{index:3,rgba:0x00ff00ff}],artBrief:"ART BRIEF"},{apiKey:"secret",fetch:fetchMock as typeof fetch});
  assert.equal(result,png().toString("base64"));assert.equal(seen?.url,"https://api.openai.com/v1/images/generations");
  const body=JSON.parse(String(seen?.init.body));assert.equal(body.model,"gpt-image-2");assert.equal(body.n,1);assert.equal(body.output_format,"png");assert.match(body.prompt,/32x32/);assert.match(body.prompt,/3:#00ff00ff/);assert.match(body.prompt,/ART BRIEF/);
  assert.equal((seen?.init.headers as Record<string,string>).authorization,"Bearer secret");
});

test("OpenAI generation maps missing key, HTTP, timeout, and missing image",async()=>{
  const context={bounds:{x:0,y:0,width:1,height:1},palette:[{index:0,rgba:255}],artBrief:"brief"};
  await assert.rejects(generateImagePng("x",context,{apiKey:""}),/validation_failed.*OPENAI_API_KEY/);
  await assert.rejects(generateImagePng("x",context,{apiKey:"k",fetch:(async()=>new Response("no",{status:503})) as typeof fetch}),/provider_unavailable.*503/);
  await assert.rejects(generateImagePng("x",context,{apiKey:"k",fetch:(async()=>new Response(JSON.stringify({data:[]}))) as typeof fetch}),/validation_failed.*no PNG/);
  const hanging=((_input:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"}))))) as typeof fetch;
  await assert.rejects(generateImagePng("x",context,{apiKey:"k",fetch:hanging,timeoutMs:5}),/provider_unavailable.*timeout/);
});

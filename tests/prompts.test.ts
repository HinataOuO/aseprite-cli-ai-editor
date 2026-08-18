import assert from "node:assert/strict";
import test from "node:test";
import { analyzeArtDirection } from "../src/art-direction.js";
import { buildSpec } from "../src/pipeline.js";
import { candidateSchema, compileArtPrompt } from "../src/prompts.js";
import type { Snapshot } from "../src/protocol.js";

const bounds={x:4,y:5,width:3,height:3},mask={bounds,bits:"/wE="};
const snapshot:Snapshot={token:"snap",spriteId:1,width:32,height:32,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:2,rgba:0x07152fff},{index:5,rgba:0x173b69ff},{index:8,rgba:0x4f8fcfff}],selection:mask,crop:{bounds,paletteRefs:[2,2,2,2,8,2,2,2,2]}};

test("compiles a filled art brief and exact row-major Candidate contract",()=>{
  const spec=buildSpec(snapshot,"blue-haired fighter in an extended pose");const profile=analyzeArtDirection(snapshot,spec.intent);const prompt=compileArtPrompt(profile,spec,snapshot.palette);
  for(const section of ["[NATIVE SPRITE]","[PIXEL STYLE]","[RENDERING]","[PALETTE ROLES — exact indices]","[CHARACTER / POSE / ACTION]","[PRESERVE]","[NEGATIVE CONSTRAINTS]","[MANDATORY JSON OUTPUT]","silhouette → proportions → pixel clusters → palette roles → details"])assert.match(prompt,new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(prompt,/outline: \[2\]/);assert.match(prompt,/"length":9/);assert.match(prompt,/"allowedValues":\[-1,2,5,8\]/);assert.doesNotMatch(prompt,/Lua code|raster image/);
});

test("selective outline prompt removes continuous-outline contradiction",()=>{
  const spec=buildSpec(snapshot,"use selective outline");const prompt=compileArtPrompt(analyzeArtDirection(snapshot,spec.intent),spec,snapshot.palette);
  assert.match(prompt,/no continuous outline/);assert.doesNotMatch(prompt,/no selective broken-outline instruction/);
});

test("candidate schema keeps token, bounds, palette indices and transparency",()=>assert.deepEqual(candidateSchema("snap",bounds,snapshot.palette),{snapshotToken:"snap",bounds,paletteRefs:{order:"row-major",length:9,allowedValues:[-1,2,5,8]}}));

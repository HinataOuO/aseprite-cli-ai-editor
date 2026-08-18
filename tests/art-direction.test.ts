import assert from "node:assert/strict";
import test from "node:test";
import { analyzeArtDirection, artDirectionErrors } from "../src/art-direction.js";
import { buildSpec } from "../src/pipeline.js";
import type { Snapshot } from "../src/protocol.js";

const palette=[{index:0,rgba:0x000000ff},{index:2,rgba:0x07152fff},{index:5,rgba:0x173b69ff},{index:8,rgba:0x4f8fcfff},{index:9,rgba:0xa9d8ffff}];
function sprite(refs:number[],width:number,height:number,intent="character"):Snapshot{
  return {token:"t",spriteId:1,width:32,height:32,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette,selection:{bounds:{x:0,y:0,width,height},bits:Buffer.from(Array(Math.ceil(width*height/8)).fill(255).map((v,i,a)=>i===a.length-1&&width*height%8?(1<<(width*height%8))-1:v)).toString("base64")},crop:{bounds:{x:0,y:0,width,height},paletteRefs:refs}};
}

const cases:[string,number[],string][]=[
  ["black-continuous",[0,0,0,0,8,0,0,0,0],"black-continuous"],
  ["colored-continuous",[5,5,5,5,9,5,5,5,5],"colored-continuous"],
  ["selective",[2,9,9,9,9,9,9,9,9],"selective"],
  ["none",[8,8,8,8,8,8,8,8,8],"none"]
];
for(const [name,refs,expected] of cases)test(`detects ${name} outline`,()=>assert.equal(analyzeArtDirection(sprite(refs,3,3),"character").pixelStyle.outline.value,expected));

test("explicit outline intent overrides observed style and maps real palette indices",()=>{
  const profile=analyzeArtDirection(sprite([2,2,2,2,8,2,2,2,2],3,3),"character with selective outline");
  assert.equal(profile.pixelStyle.outline.value,"selective");assert.deepEqual(profile.paletteRoles.outline,[2]);assert.equal(profile.pixelStyle.outline.source,"explicit");
});

test("detects anti-aliasing only from repeated intermediate edge transitions",()=>{
  const profile=analyzeArtDirection(sprite([2,5,8,8,2,5,8,8,2,5,8,8],4,3),"character");
  assert.equal(profile.pixelStyle.antiAliasing.value,true);assert.equal(profile.negativeConstraints.value.includes("no soft anti-aliasing"),false);
});

test("resolution rules recognize a 48px internal figure on 64px canvas",()=>{
  const refs=Array(48*48).fill(8);const snapshot={...sprite(refs,48,48),width:64 as const,height:64 as const};
  assert.equal(analyzeArtDirection(snapshot,"blue-haired character, extended pose").nativeSprite.nominalSize.value,48);
});

test("deterministic checks flag excessive tones",()=>{
  const snapshot=sprite([8,8,8,8],2,2);const spec=buildSpec(snapshot,"character");const profile=analyzeArtDirection(snapshot,"character");profile.rendering.maxColors.value=2;
  assert.match(artDirectionErrors({snapshotToken:"t",bounds:spec.mask.bounds,paletteRefs:[2,5,8,9]},snapshot,spec,profile).join(","),/too_many_colors/);
});

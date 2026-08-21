import assert from "node:assert/strict";
import test from "node:test";
import { loadArtContext } from "../src/art-context.js";
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

test("empty crop infers luminance roles and full color budget for simple palettes",()=>{
  const colors=[0x101010ff,0x303030ff,0x707070ff,0xf0f0f0ff];
  const expected=[
    {outline:[],shadow:[],base:[10],highlight:[]},
    {outline:[10],shadow:[],base:[11],highlight:[]},
    {outline:[10],shadow:[],base:[11],highlight:[12]},
    {outline:[10],shadow:[11],base:[12],highlight:[13]}
  ];
  for(let count=1;count<=4;count++){
    const empty={...sprite(Array(4).fill(-1),2,2),palette:colors.slice(0,count).map((rgba,index)=>({index:index+10,rgba}))};
    const profile=analyzeArtDirection(empty,"character");
    assert.deepEqual(profile.paletteRoles,expected[count-1]);assert.equal(profile.rendering.maxColors.value,count);
  }
});

test("four-color hard edges skip ambiguous AA heuristic; larger palettes keep it",()=>{
  const refs=[0,2,5,5,0,2,5,5,0,2,5,5];
  const simple={...sprite(Array(12).fill(5),4,3),palette:palette.slice(0,4)};
  const simpleProfile=analyzeArtDirection(simple,"character");simpleProfile.pixelStyle.antiAliasing.value=false;
  assert.equal(artDirectionErrors({snapshotToken:"t",bounds:simple.selection!.bounds,paletteRefs:refs},simple,buildSpec(simple,"character"),simpleProfile).includes("artistic_soft_antialiasing_detected"),false);
  const large=sprite(Array(12).fill(5),4,3),largeProfile=analyzeArtDirection(large,"character");largeProfile.pixelStyle.antiAliasing.value=false;
  assert.equal(artDirectionErrors({snapshotToken:"t",bounds:large.selection!.bounds,paletteRefs:refs},large,buildSpec(large,"character"),largeProfile).includes("artistic_soft_antialiasing_detected"),true);
});

test("manifest supplies empty-canvas scale, palette, shading, and detail fallbacks",async()=>{
  const context=await loadArtContext("tests/fixtures/art-context.json");
  const snapshot={...sprite(Array(64*64).fill(-1),64,64),width:64 as const,height:64 as const};
  const profile=analyzeArtDirection(snapshot,"maid standing",context);
  assert.deepEqual(profile.nativeSprite.nativeHeight.value,{min:32,max:48});
  assert.deepEqual(profile.paletteRoles,context.manifest.paletteRoles);
  assert.deepEqual(profile.rendering.shadesPerMaterial.value,{min:3,max:4});
  assert.equal(profile.rendering.lightDirection.value,"top-front");
  assert.equal(profile.pixelStyle.antiAliasing.value,false);
});

test("locked context rule beats explicit intent; unlocked context yields to it",async()=>{
  const context=await loadArtContext("tests/fixtures/art-context.json"),snapshot=sprite([2,2,2,2,8,2,2,2,2],3,3);
  assert.equal(analyzeArtDirection(snapshot,"continuous outline",context).pixelStyle.outline.value,"selective");
  const unlocked=structuredClone(context);unlocked.manifest.locked=unlocked.manifest.locked.filter(field=>field!=="outline.mode");
  const profile=analyzeArtDirection(snapshot,"continuous outline",unlocked);
  assert.equal(profile.pixelStyle.outline.value,"colored-continuous");assert.equal(profile.pixelStyle.outline.source,"explicit");
});

test("existing sprite without manifest keeps observed behavior",()=>{
  const snapshot=sprite([2,9,9,9,9,9,9,9,9],3,3),profile=analyzeArtDirection(snapshot,"character");
  assert.equal(profile.artContext,undefined);assert.equal(profile.pixelStyle.outline.value,"selective");assert.deepEqual(profile.paletteRoles.outline,[2]);
});

test("128 target gets selective articulated-detail budget",()=>{
  const snapshot={...sprite(Array(128*128).fill(2),128,128),width:128 as const,height:128 as const};
  const budget=analyzeArtDirection(snapshot,"character").nativeSprite.detailBudget.value;
  assert.match(budget,/cluster hierarchy/);assert.match(budget,/selective detail/);assert.match(budget,/do not scale up 64px/);
});

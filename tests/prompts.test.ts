import assert from "node:assert/strict";
import test from "node:test";
import { loadArtContext } from "../src/art-context.js";
import { analyzeArtDirection } from "../src/art-direction.js";
import { buildSpec } from "../src/pipeline.js";
import { compileArtPrompt } from "../src/prompts.js";
import type { Snapshot } from "../src/protocol.js";

const bounds={x:4,y:5,width:3,height:3},mask={bounds,bits:"/wE="};
const snapshot:Snapshot={token:"snap",spriteId:1,width:32,height:32,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:2,rgba:0x07152fff},{index:5,rgba:0x173b69ff},{index:8,rgba:0x4f8fcfff}],selection:mask,crop:{bounds,paletteRefs:[2,2,2,2,8,2,2,2,2]}};

test("compiles a visual PNG brief with logical target and palette",()=>{
  const spec=buildSpec(snapshot,"blue-haired fighter in an extended pose");const profile=analyzeArtDirection(snapshot,spec.intent);const prompt=compileArtPrompt(profile,spec,snapshot.palette);
  for(const section of ["[OUTPUT]","[PALETTE-CONSTRAINED RESTYLE]","[ART CONTEXT]","[STYLE LOCK]","[REFERENCE USAGE]","[NATIVE SPRITE]","[PIXEL STYLE]","[RENDERING]","[CHARACTER]","[POSE / ACTION]","[PRESERVE]","[NEGATIVE CONSTRAINTS]","silhouette → proportions → pixel clusters → palette roles → details"])assert.match(prompt,new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(prompt,/logical pixel-art target 3x3/);assert.match(prompt,/2: #07152fff/);assert.match(prompt,/safe margin/);assert.match(prompt,/No gradients/);assert.match(prompt,/return one PNG preview/);assert.doesNotMatch(prompt,/paletteRefs|Candidate object|JSON output/i);
  assert.match(prompt,/Preserve pose, full silhouette, hair mass, and outfit separation/);assert.match(prompt,/silhouette → hair and outfit → contrast → face/);assert.match(prompt,/background transparent/);
});

test("selective outline prompt removes continuous-outline contradiction",()=>{
  const spec=buildSpec(snapshot,"use selective outline");const prompt=compileArtPrompt(analyzeArtDirection(snapshot,spec.intent),spec,snapshot.palette);
  assert.match(prompt,/no continuous outline/);assert.doesNotMatch(prompt,/no selective broken-outline instruction/);
});

test("context prompt keeps locks complete and character/pose separate from reference use",async()=>{
  const context=await loadArtContext("tests/fixtures/art-context.json");
  const contextual:Snapshot={...snapshot,width:64,height:64,palette:[{index:0,rgba:0x000000ff},...snapshot.palette,{index:9,rgba:0xffffffff}]};
  const spec=buildSpec(contextual,"mage casting upward in a blue robe");
  const prompt=compileArtPrompt(analyzeArtDirection(contextual,spec.intent,context),spec,contextual.palette);
  for(const lock of context.manifest.locked)assert.match(prompt,new RegExp(`${lock.replace(".","\\.")}: locked`));
  assert.match(prompt,/Use references only for scale, density, proportions, pixel clusters, outline, and shading/);
  assert.match(prompt,/Do not copy identity, character, pose, costume/);
  assert.match(prompt,/\[CHARACTER\][\s\S]*mage casting upward in a blue robe[\s\S]*\[POSE \/ ACTION\]/);
  assert.match(prompt,/3-4 values per material with hard-edged blocks and top-front light/);
  assert.match(prompt,/colored selective outline/);assert.doesNotMatch(prompt,/continuous outline[\s\S]*no continuous outline/);
});

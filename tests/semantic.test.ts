import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scoreSemantic, semanticAction, type SemanticDefinition } from "../src/semantic.js";

const definition=JSON.parse(await readFile(new URL("semantic/arm-32.json",import.meta.url),"utf8")) as SemanticDefinition;
test("observational score tracks human judgments",()=>{
  const good=scoreSemantic(definition,{shoulder_connection:true,position:true,length:.9,silhouette:.8,preserve:true});
  const bad=scoreSemantic(definition,{shoulder_connection:false,position:.5,length:.2,silhouette:.1,preserve:true});
  assert.ok(good.score>70); assert.ok(bad.score<good.score); assert.equal(good.reasons.length,definition.requirements.length);
});
test("semantic automation remains gated",()=>{
  assert.equal(semanticAction(100,false),"confirm"); assert.equal(semanticAction(49,true),"retry");
  assert.equal(semanticAction(50,true),"confirm"); assert.equal(semanticAction(70,true),"confirm"); assert.equal(semanticAction(71,true),"apply");
});

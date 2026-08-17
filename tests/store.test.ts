import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calibrationMetric, LocalStore, type CacheKey } from "../src/store.js";

const key=(overrides:Partial<CacheKey>={}):CacheKey=>({contentHash:"content",request:"arm",authorizationHash:"mask",provider:"openai",model:"m",version:"1",...overrides});
test("cache isolates every key component and writes samples atomically",async()=>{
  const root=await mkdtemp(join(tmpdir(),"ai-editor-")); const store=new LocalStore(root);
  await store.set(key(),{candidate:[1]}); assert.deepEqual(await store.get(key()),{candidate:[1]});
  for(const changed of [key({model:"other"}),key({version:"2"}),key({contentHash:"changed"}),key({authorizationHash:"changed"})]) assert.equal(await store.get(changed),undefined);
  await store.saveSample({contentHash:"x",proposedMask:"AQ==",confirmedMask:"AQ=="});
  assert.match(await readFile(join(root,"calibration.jsonl"),"utf8"),/contentHash/);
  assert.equal((await stat(join(root,"calibration.jsonl"))).mode&0o777,0o600);
  await assert.rejects(store.saveSample({fullImage:"secret"}),/sensitive/); await store.clear();
});
test("calibration metric weights precision twice",()=>assert.equal(calibrationMetric(.6,.3),.5));

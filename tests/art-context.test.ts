import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadArtContext } from "../src/art-context.js";

const fixture=path.resolve("tests/fixtures/art-context.json");
const valid=async()=>JSON.parse(await readFile(fixture,"utf8")) as Record<string,unknown>;
const tempManifest=async(value:unknown,files:Record<string,Buffer|string>={})=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"art-context-"));
  for(const [name,data] of Object.entries(files))await writeFile(path.join(dir,name),data);
  const manifest=path.join(dir,"context.json");await writeFile(manifest,JSON.stringify(value));return {dir,manifest};
};

test("loads a strict v1 manifest and ordered PNG references",async()=>{
  const loaded=await loadArtContext(fixture);
  assert.equal(loaded.manifest.name,"test-roster");
  assert.deepEqual(loaded.references.map(reference=>[reference.path,reference.width,reference.height]),[["maid.png",2,2],["fighter.png",2,2]]);
  assert.ok(loaded.references.every(reference=>reference.pngBase64.length>0));
});

test("rejects unknown versions and properties",async()=>{
  const version=await valid();version.version=2;
  await assert.rejects(loadArtContext((await tempManifest(version)).manifest),/art_context_invalid/);
  const property=await valid();property.unknown=true;
  await assert.rejects(loadArtContext((await tempManifest(property)).manifest),/Unrecognized key|art_context_invalid/);
});

test("rejects traversal and symlinks escaping the manifest directory",async()=>{
  const value=await valid();value.references=[{path:"../outside.png",purpose:"style"}];
  await assert.rejects(loadArtContext((await tempManifest(value)).manifest),/escapes manifest directory/);
  const png=await readFile("tests/fixtures/maid.png"),setup=await tempManifest({...await valid(),references:[{path:"linked.png",purpose:"style"}]});
  const outside=path.join(path.dirname(setup.dir),`${path.basename(setup.dir)}-outside.png`);await writeFile(outside,png);await symlink(outside,path.join(setup.dir,"linked.png"));
  await assert.rejects(loadArtContext(setup.manifest),/escapes manifest directory/);
});

test("rejects missing, non-PNG, and more than three references",async()=>{
  const missing={...await valid(),references:[{path:"missing.png",purpose:"style"}]};
  await assert.rejects(loadArtContext((await tempManifest(missing)).manifest),/unreadable/);
  const nonPng={...await valid(),references:[{path:"fake.png",purpose:"style"}]};
  await assert.rejects(loadArtContext((await tempManifest(nonPng,{"fake.png":"not png"})).manifest),/not PNG/);
  const excessive={...await valid(),references:Array.from({length:4},(_,i)=>({path:`${i}.png`,purpose:"style"}))};
  await assert.rejects(loadArtContext((await tempManifest(excessive)).manifest),/art_context_invalid/);
});

test("rejects duplicate palette indices and invalid locks",async()=>{
  const duplicate=await valid();duplicate.paletteRoles={outline:[0],shadow:[0],base:[5],highlight:[9]};duplicate.references=[];
  await assert.rejects(loadArtContext((await tempManifest(duplicate)).manifest),/palette indices must be unique/);
  const lock=await valid();lock.locked=["outline.unknown"];lock.references=[];
  await assert.rejects(loadArtContext((await tempManifest(lock)).manifest),/art_context_invalid/);
  const loaded=await loadArtContext(fixture);assert.ok(loaded.manifest.locked.includes("outline.mode"));
});

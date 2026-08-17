import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CacheKey { contentHash:string; request:string; authorizationHash:string; provider:string; model:string; version:string }
const stable=(value:unknown):string=>value&&typeof value==="object"?(Array.isArray(value)?`[${value.map(stable).join(",")}]`:`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`):JSON.stringify(value);
const digest=(value:unknown)=>createHash("sha256").update(stable(value)).digest("hex");
const safe=(value:unknown):void=>{
  if (!value||typeof value!=="object") return;
  for (const [key,child] of Object.entries(value)) { if (/^(fullImage|document|documentPng|credentials|apiKey)$/i.test(key)) throw new Error(`refusing sensitive field: ${key}`); safe(child); }
};

export const calibrationMetric=(precision:number,recall:number):number=>{
  if (![precision,recall].every(x=>Number.isFinite(x)&&x>=0&&x<=1)) throw new Error("precision and recall must be between 0 and 1");
  return (2*precision+recall)/3;
};

export class LocalStore {
  constructor(private readonly root:string,private readonly retentionDays=30) {}
  private get cacheDir(){return join(this.root,"cache")}
  private get samplesFile(){return join(this.root,"calibration.jsonl")}
  async saveSample(sample:unknown):Promise<void>{
    safe(sample); await mkdir(this.root,{recursive:true});
    let current=""; try{current=await readFile(this.samplesFile,"utf8")}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
    const tmp=`${this.samplesFile}.${process.pid}.tmp`; await writeFile(tmp,current+JSON.stringify(sample)+"\n",{mode:0o600}); await rename(tmp,this.samplesFile);
  }
  key(value:CacheKey):string{return digest(value)}
  async set(key:CacheKey,value:unknown):Promise<string>{safe(value);await mkdir(this.cacheDir,{recursive:true});const id=this.key(key),tmp=join(this.cacheDir,`${id}.${process.pid}.tmp`),path=join(this.cacheDir,`${id}.json`);await writeFile(tmp,JSON.stringify({key,value,createdAt:new Date().toISOString()}),{mode:0o600});await rename(tmp,path);return id}
  async get<T>(key:CacheKey):Promise<T|undefined>{try{const entry=JSON.parse(await readFile(join(this.cacheDir,`${this.key(key)}.json`),"utf8")) as {key:CacheKey,value:T};return stable(entry.key)===stable(key)?entry.value:undefined}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error}}
  async enforceRetention(now=Date.now()):Promise<void>{
    let files:string[];try{files=await readdir(this.cacheDir)}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")files=[];else throw error}
    const cutoff=now-this.retentionDays*86_400_000;await Promise.all(files.filter(file=>file.endsWith(".json")).map(async file=>{const path=join(this.cacheDir,file);if((await stat(path)).mtimeMs<cutoff)await rm(path)}));
    try{if((await stat(this.samplesFile)).mtimeMs<cutoff)await rm(this.samplesFile)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
  }
  async clear():Promise<void>{await rm(this.root,{recursive:true,force:true})}
}

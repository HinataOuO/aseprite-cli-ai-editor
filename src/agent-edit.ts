import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadArtContext } from "./art-context.js";
import { analyzeArtDirection, type ArtDirectionProfile } from "./art-direction.js";
import type { BridgeClient } from "./index.js";
import { assertFresh, buildSpec, candidateFromPng, cropPng } from "./pipeline.js";
import { MAX_PNG_BYTES, MAX_PNG_DIMENSION } from "./pixel-art-fixer.js";
import { compileArtPrompt } from "./prompts.js";
import { TRANSPARENT, type Candidate, type EditSpec, type PixelDiff, type Snapshot, validateSnapshot } from "./protocol.js";
import type { EditMode } from "./editor.js";

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const inside=(root:string,target:string)=>target===root||target.startsWith(root+path.sep);

interface AgentSession {
  id:string;
  dir:string;
  outputPath:string;
  snapshot:Snapshot;
  generationSnapshot:Snapshot;
  spec:EditSpec;
  profile:ArtDirectionProfile;
  mode:EditMode;
  attempts:number;
  expiresAt:number;
  timer:NodeJS.Timeout;
}

export interface AgentEditBrief {
  sessionId:string;
  outputPath:string;
  cropPngBase64:string;
  referencePngBase64:string[];
  referenceMetadata:{path:string;purpose:string;width:number;height:number}[];
  artBrief:string;
  bounds:EditSpec["mask"]["bounds"];
  aspectRatio:string;
  logicalSize:{width:number;height:number};
  palette:Snapshot["palette"];
  mask:EditSpec["mask"];
  expiresAt:string;
  maxSubmissions:3;
  instructions:string;
}

export interface AgentSubmission {candidate:Candidate;diff:PixelDiff;snapshot:Snapshot}

export class AgentEditManager {
  private readonly sessions=new Map<string,AgentSession>();
  private readonly sessionBySprite=new Map<number,string>();
  private root:string|undefined;

  constructor(private readonly bridge:BridgeClient,private readonly configuredRoot=process.env.AI_EDITOR_AGENT_IMAGE_DIR??path.join(process.cwd(),".aseprite-ai-tmp"),private readonly ttlMs=5*60_000,private readonly onBegin?:(spriteId:number)=>void) {}

  private async trustedRoot():Promise<string>{
    if(this.root)return this.root;
    await mkdir(path.resolve(this.configuredRoot),{recursive:true,mode:0o700});
    this.root=await realpath(path.resolve(this.configuredRoot));
    return this.root;
  }

  private async cleanupStale(root:string):Promise<void>{
    const now=Date.now();
    for(const entry of await readdir(root,{withFileTypes:true})){
      if(!entry.isDirectory()||!/^[-0-9a-f]{36}$/i.test(entry.name))continue;
      const target=path.join(root,entry.name);
      try{if(now-(await stat(target)).mtimeMs>=this.ttlMs)await rm(target,{recursive:true,force:true})}catch{}
    }
  }

  async begin(intent:string,mode:EditMode,artContextPath?:string):Promise<AgentEditBrief>{
    const [root,artContext]=await Promise.all([this.trustedRoot(),artContextPath===undefined?undefined:loadArtContext(artContextPath)]);
    await this.cleanupStale(root);
    const snapshot=validateSnapshot(await this.bridge.request("read_snapshot",{includeCrop:true}));
    if(!snapshot.selection)throw new Error("confirmation_required: select the authorized edit area");
    const prior=this.sessionBySprite.get(snapshot.spriteId);if(prior)await this.invalidate(prior);this.onBegin?.(snapshot.spriteId);
    const generationSnapshot=mode==="generate_new_layer"?{...snapshot,crop:{bounds:snapshot.selection.bounds,paletteRefs:Array(snapshot.selection.bounds.width*snapshot.selection.bounds.height).fill(TRANSPARENT),pngBase64:cropPng(snapshot)}}:snapshot;
    const spec=buildSpec(generationSnapshot,intent),profile=analyzeArtDirection(generationSnapshot,intent,artContext);
    if(artContext){
      const palette=new Set(snapshot.palette.map(entry=>entry.index)),missing=Object.values(artContext.manifest.paletteRoles).flat().filter(index=>!palette.has(index));
      if(missing.length)throw new Error(`art_context_invalid: palette indices unavailable in sprite: ${[...new Set(missing)].join(",")}`);
      if(artContext.manifest.nativeHeight.min>spec.mask.bounds.height)throw new Error(`art_context_invalid: native height ${artContext.manifest.nativeHeight.min}-${artContext.manifest.nativeHeight.max} cannot fit authorized bounds`);
    }
    const id=randomUUID(),dir=path.join(root,id),outputPath=path.join(dir,"generated.png"),expiresAt=Date.now()+this.ttlMs;
    await mkdir(dir,{mode:0o700});
    const timer=setTimeout(()=>void this.invalidate(id),this.ttlMs);timer.unref();
    this.sessions.set(id,{id,dir,outputPath,snapshot,generationSnapshot,spec,profile,mode,attempts:0,expiresAt,timer});this.sessionBySprite.set(snapshot.spriteId,id);
    return {sessionId:id,outputPath,cropPngBase64:cropPng(snapshot),referencePngBase64:artContext?.references.map(reference=>reference.pngBase64)??[],referenceMetadata:artContext?.references.map(({path,purpose,width,height})=>({path,purpose,width,height}))??[],artBrief:compileArtPrompt(profile,spec,snapshot.palette),bounds:spec.mask.bounds,aspectRatio:`${spec.mask.bounds.width}:${spec.mask.bounds.height}`,logicalSize:{width:spec.mask.bounds.width,height:spec.mask.bounds.height},palette:snapshot.palette,mask:spec.mask,expiresAt:new Date(expiresAt).toISOString(),maxSubmissions:3,instructions:`Write exactly one real PNG to ${outputPath}. Do not write JSON, text, another format, or any other path; then call submit_agent_png with this sessionId.`};
  }

  async submitPng(sessionId:string):Promise<AgentSubmission>{
    const session=this.require(sessionId);this.useAttempt(session);
    try{
      await this.assertCurrent(session);
      const png=await this.readPng(session);
      const result=candidateFromPng(png.toString("base64"),session.generationSnapshot,session.spec,session.profile,session.mode==="generate_new_layer"?"contain":"cover");
      if(session.mode==="generate_new_layer")result.diff.createLayer=true;
      await this.invalidate(sessionId);
      return {...result,snapshot:session.snapshot};
    }catch(error){return this.failed(session,error)}
  }

  private require(id:string):AgentSession{
    const session=this.sessions.get(id);if(!session)throw new Error("stale_snapshot: unknown or expired agent session");
    if(Date.now()>session.expiresAt){void this.invalidate(id);throw new Error("stale_snapshot: agent session expired")}
    return session;
  }

  private useAttempt(session:AgentSession):void{if(session.attempts>=3)throw new Error("attempts_exhausted");session.attempts++}
  private async assertCurrent(session:AgentSession):Promise<void>{assertFresh(session.snapshot,validateSnapshot(await this.bridge.request("read_snapshot",{includeCrop:false})))}

  private async readPng(session:AgentSession):Promise<Buffer>{
    const root=await this.trustedRoot(),actualDir=await realpath(session.dir).catch(()=>"");
    if(!inside(root,session.dir)||actualDir!==session.dir)throw new Error("validation_failed: unsafe agent image directory");
    const info=await lstat(session.outputPath).catch(()=>undefined);
    if(!info)throw new Error("validation_failed: generated PNG missing");
    if(info.isSymbolicLink()||!info.isFile())throw new Error("validation_failed: generated PNG must be a regular non-symlink file");
    const handle=await open(session.outputPath,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const opened=await handle.stat();if(!opened.isFile()||opened.size<24||opened.size>MAX_PNG_BYTES)throw new Error("validation_failed: generated PNG size");
      const bytes=await handle.readFile();
      if(!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(8)!==13||bytes.toString("ascii",12,16)!=="IHDR")throw new Error("validation_failed: generated PNG header");
      const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>MAX_PNG_DIMENSION||height>MAX_PNG_DIMENSION)throw new Error("validation_failed: generated PNG dimensions");
      return bytes;
    }finally{await handle.close()}
  }

  private async failed(session:AgentSession,error:unknown):Promise<never>{
    if(await realpath(session.dir).catch(()=>"")===session.dir)await rm(session.outputPath,{force:true});
    const message=error instanceof Error?error.message:String(error),remaining=3-session.attempts;
    if(!remaining){await this.invalidate(session.id);throw new Error(`attempts_exhausted: ${message}`)}
    throw new Error(`${message}; submissions_remaining=${remaining}`);
  }

  private async invalidate(id:string):Promise<void>{
    const session=this.sessions.get(id);if(!session)return;
    clearTimeout(session.timer);this.sessions.delete(id);if(this.sessionBySprite.get(session.snapshot.spriteId)===id)this.sessionBySprite.delete(session.snapshot.spriteId);
    await rm(session.dir,{recursive:true,force:true});
  }
}

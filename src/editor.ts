import { randomUUID } from "node:crypto";
import { AgentEditManager, type AgentEditBrief } from "./agent-edit.js";
import { generateImagePng, readLocalPng, type ImageProviderOptions } from "./image-input.js";
import { analyzeArtDirection } from "./art-direction.js";
import type { BridgeClient } from "./index.js";
import { assertFresh, buildSpec, candidateFromPng, candidatePng, hashCandidate } from "./pipeline.js";
import { compileArtPrompt } from "./prompts.js";
import { TRANSPARENT, countDiffPixels, type Candidate, type PixelDiff, type Rect, type Snapshot, validateSnapshot } from "./protocol.js";
import type { PaletteMode } from "./pixel-art-fixer.js";

export type EditMode = "edit_current" | "generate_new_layer";

interface PendingEdit {
  candidate: Candidate;
  diff: PixelDiff;
  snapshot: Snapshot;
  hash: string;
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  prepareDurationMs: number;
}

export interface PreparedEdit {
  candidateId: string;
  previewPngBase64: string;
  bounds: Rect;
  changedPixels: number;
  candidateHash: string;
  expiresAt: string;
  instructions: string;
  palette?: Snapshot["palette"];
}

export interface EditorOptions {imageInputRoot?:string;imageProvider?:ImageProviderOptions}

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export class EditOrchestrator {
  private readonly pending = new Map<string, PendingEdit>();
  private readonly candidateBySprite = new Map<number, string>();
  private readonly agent:AgentEditManager;

  constructor(private readonly bridge: BridgeClient,private readonly ttlMs=5*60_000,agentRoot?:string,private readonly options:EditorOptions={}) {
    this.agent=new AgentEditManager(bridge,agentRoot,ttlMs,spriteId=>{const candidate=this.candidateBySprite.get(spriteId);if(candidate)this.invalidate(candidate)});
  }

  private metric(operation:string,phase:string,started:number,bytes:number):void {
    this.metricDuration(operation,phase,performance.now()-started,bytes);
  }

  private metricDuration(operation:string,phase:string,durationMs:number,bytes:number):void {
    console.error(JSON.stringify({component:"edit",operation,phase,durationMs:Math.round(durationMs*100)/100,bytes}));
  }

  beginAgent(intent:string,mode:EditMode,artContextPath?:string):Promise<AgentEditBrief>{return this.agent.begin(intent,mode,artContextPath)}
  async submitAgentPng(sessionId:string):Promise<PreparedEdit>{const result=await this.agent.submitPng(sessionId);return this.saveCandidate(result.candidate,result.diff,result.snapshot,0)}

  async inspect(includeCrop=false):Promise<Snapshot>{
    const snapshot=validateSnapshot(await this.bridge.request("read_snapshot",{includeCrop}));
    if(!snapshot.selection)throw new Error("confirmation_required: select the authorized edit area");
    return snapshot;
  }

  async prepareImageImport(imagePath:string,fit:"contain"|"cover"="contain",intent="Import the provided PNG into a new layer",paletteMode:PaletteMode="auto",maxColors?:number):Promise<PreparedEdit>{
    const started=performance.now(),snapshot=await this.inspect(true);
    const png=await readLocalPng(imagePath,this.options.imageInputRoot);
    return this.prepareNewLayer(png,snapshot,intent,fit,performance.now()-started,paletteMode,maxColors);
  }

  async preparePromptGeneration(prompt:string,fit:"contain"|"cover"="contain",paletteMode:PaletteMode="auto",maxColors?:number):Promise<PreparedEdit>{
    const started=performance.now(),snapshot=await this.inspect(true),context=this.newLayerContext(snapshot,prompt);
    const extracting=paletteMode!=="current",budget=maxColors??(Math.max(context.spec.mask.bounds.width,context.spec.mask.bounds.height)<=16?4:Math.max(context.spec.mask.bounds.width,context.spec.mask.bounds.height)<=64?8:16);
    const png=await generateImagePng(prompt,{bounds:context.spec.mask.bounds,...(extracting?{maxColors:budget}:{palette:snapshot.palette}),artBrief:compileArtPrompt(context.profile,context.spec,snapshot.palette,extracting?budget:undefined)},this.options.imageProvider);
    return this.prepareNewLayer(png,snapshot,prompt,fit,performance.now()-started,paletteMode,maxColors);
  }

  private newLayerContext(snapshot:Snapshot,intent:string){
    const bounds=snapshot.selection!.bounds,generationSnapshot={...snapshot,crop:{bounds,paletteRefs:Array(bounds.width*bounds.height).fill(TRANSPARENT)}};
    return {generationSnapshot,spec:buildSpec(generationSnapshot,intent),profile:analyzeArtDirection(generationSnapshot,intent)};
  }

  private prepareNewLayer(png:string,snapshot:Snapshot,intent:string,fit:"contain"|"cover",prepareDurationMs:number,paletteMode:PaletteMode,maxColors?:number):PreparedEdit{
    const {generationSnapshot,spec,profile}=this.newLayerContext(snapshot,intent);
    let result=candidateFromPng(png,generationSnapshot,spec,profile,fit,false,paletteMode,maxColors);
    if(result.candidate.palette&&!this.paletteCompatible(snapshot,result.candidate.palette)){
      if(paletteMode==="extract")throw new Error("unsupported_document: source palette does not contain every existing color");
      result=candidateFromPng(png,generationSnapshot,spec,profile,fit,false,"current",maxColors);
    }
    result.diff.createLayer=true;
    return this.saveCandidate(result.candidate,result.diff,snapshot,prepareDurationMs);
  }

  private saveCandidate(candidate:Candidate,diff:PixelDiff,snapshot:Snapshot,prepareDurationMs:number,previewPngBase64=candidatePng(candidate,snapshot.palette)):PreparedEdit{
    const hash=hashCandidate(candidate),candidateId=randomUUID(),expiresAt=Date.now()+this.ttlMs;
    const existing=this.candidateBySprite.get(snapshot.spriteId);if(existing)this.invalidate(existing);
    const expiryTimer=setTimeout(()=>this.invalidate(candidateId),this.ttlMs);expiryTimer.unref();
    this.pending.set(candidateId,{candidate,diff,snapshot,hash,expiresAt,expiryTimer,prepareDurationMs});this.candidateBySprite.set(snapshot.spriteId,candidateId);
    return {candidateId,previewPngBase64,bounds:candidate.bounds,changedPixels:countDiffPixels(diff),candidateHash:hash,expiresAt:new Date(expiresAt).toISOString(),instructions:"Show this preview to the user and ask for explicit approval before calling commit_edit with candidateId.",...(candidate.palette?{palette:candidate.palette}:{})};
  }

  async commit(candidateId:string):Promise<{applied:number;token:string;candidateHash:string;layerUuid:string}> {
    const operation=randomUUID(),totalStarted=performance.now();
    const edit=this.pending.get(candidateId);
    if(!edit)throw new Error("stale_snapshot: unknown or consumed candidate");
    this.invalidate(candidateId);
    if(Date.now()>edit.expiresAt)throw new Error("stale_snapshot: candidate expired");

    const snapshotStarted=performance.now();
    const current=validateSnapshot(await this.bridge.request("read_snapshot",{includeCrop:false}));
    this.metric(operation,"snapshot",snapshotStarted,byteLength(current));
    assertFresh(edit.snapshot,current);
    if(edit.diff.palette&&!this.paletteCompatible(current,edit.diff.palette))throw new Error("unsupported_document: source palette does not contain every existing color");
    if(hashCandidate(edit.candidate)!==edit.hash)throw new Error("validation_failed: candidate hash mismatch");

    const commitStarted=performance.now();
    const result=await this.bridge.request<{applied:number;token:string;verified?:boolean;layerUuid?:string}>("apply_diff",{diff:edit.diff});
    this.metric(operation,"commit",commitStarted,byteLength(edit.diff)+byteLength(result));
    if(result.verified!==true)throw new Error("apply_failed: plugin did not verify applied pixels");
    this.metricDuration(operation,"total",edit.prepareDurationMs+performance.now()-totalStarted,byteLength(result));
    return {applied:result.applied,token:result.token,candidateHash:edit.hash,layerUuid:result.layerUuid ?? edit.diff.layerUuid};
  }

  private paletteCompatible(snapshot:Snapshot,palette:Snapshot["palette"]):boolean{if(!snapshot.documentEmpty&&!snapshot.usedRgba)return false;const colors=new Set(palette.filter(entry=>(entry.rgba&255)>0).map(entry=>entry.rgba));return (snapshot.usedRgba??[]).every(color=>colors.has(color))}

  private invalidate(candidateId:string):void {
    const edit=this.pending.get(candidateId);
    if(edit){
      clearTimeout(edit.expiryTimer);
      if(this.candidateBySprite.get(edit.snapshot.spriteId)===candidateId)this.candidateBySprite.delete(edit.snapshot.spriteId);
    }
    this.pending.delete(candidateId);
  }
}

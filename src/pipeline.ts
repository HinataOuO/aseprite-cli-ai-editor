import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { analyzeArtDirection, artDirectionErrors } from "./art-direction.js";
import { candidateSchema, compileArtPrompt } from "./prompts.js";
import type { Provider, ProviderRequest } from "./provider.js";
import { TRANSPARENT, type Candidate, type EditSpec, type Mask, type PixelDiff, type Rect, type Snapshot, validateCandidate } from "./protocol.js";
import { semanticAction } from "./semantic.js";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
};
export const hashSnapshot = (snapshot: Omit<Snapshot,"token">): string => createHash("sha256").update(canonical(snapshot)).digest("hex");
export const hashCandidate = (candidate: Candidate): string => createHash("sha256").update(canonical(candidate)).digest("hex");

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
};
const sameRect = (a: Rect,b: Rect) => a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const enabled = (mask: Mask,index: number) => ((Buffer.from(mask.bits,"base64")[index>>3] ?? 0) & (1 << (index&7))) !== 0;

export function buildSpec(snapshot: Snapshot, intent: string, options: { proposedMask?: Mask; layerUuids?: string[]; confirmed?: boolean; semanticRequirements?: string[] } = {}): EditSpec {
  const mask=snapshot.selection ?? options.proposedMask;
  if (!mask) throw new Error("confirmation_required: localization mask missing");
  const layerUuids=options.layerUuids ?? [snapshot.activeLayerUuid];
  if (new Set(layerUuids).size!==layerUuids.length || layerUuids.some(uuid=>!snapshot.layers.some(layer=>layer.uuid===uuid))) throw new Error("unauthorized_change: unknown layer");
  if (layerUuids.length>1 && !options.confirmed) throw new Error("confirmation_required: multi-layer edit");
  return deepFreeze({intent,snapshotToken:snapshot.token,frame:snapshot.frame,layerUuids:[...layerUuids],mask:structuredClone(mask),semanticRequirements:[...(options.semanticRequirements ?? [])],confirmationRequired:true});
}

export function assertFresh(expected: Snapshot,current: Snapshot): void {
  if (expected.token!==current.token || expected.spriteId!==current.spriteId || expected.frame!==current.frame || expected.activeLayerUuid!==current.activeLayerUuid || canonical(expected.layers)!==canonical(current.layers) || canonical(expected.palette)!==canonical(current.palette)) throw new Error("stale_snapshot");
}

export type LocalizationAction="retry"|"confirm"|"auto";
export function localizationAction(confidence: number, calibrated=false, bootstrapSamples=0): LocalizationAction {
  if (!Number.isFinite(confidence) || confidence<0 || confidence>100) throw new Error("validation_failed: confidence");
  if (confidence<70) return "retry";
  if (bootstrapSamples<30 || confidence<=90 || !calibrated) return "confirm";
  return "auto";
}

function refsPng(bounds: Rect,paletteRefs: number[],palette: Snapshot["palette"]): string {
  if (paletteRefs.length!==bounds.width*bounds.height) throw new Error("validation_failed: crop size");
  const colors=new Map(palette.map(entry=>[entry.index,entry.rgba]));
  const png=new PNG({width:bounds.width,height:bounds.height});
  paletteRefs.forEach((ref,i)=>{
    const rgba=ref===TRANSPARENT ? 0 : colors.get(ref);
    if (rgba===undefined) throw new Error("validation_failed: crop palette reference");
    png.data[i*4]=(rgba>>>24)&255; png.data[i*4+1]=(rgba>>>16)&255; png.data[i*4+2]=(rgba>>>8)&255; png.data[i*4+3]=rgba&255;
  });
  return PNG.sync.write(png).toString("base64");
}

export function cropPng(snapshot: Snapshot): string {
  const crop=snapshot.crop;
  if (!crop) throw new Error("validation_failed: crop missing");
  if (crop.pngBase64) return crop.pngBase64;
  if (!crop.paletteRefs) throw new Error("validation_failed: crop size");
  return refsPng(crop.bounds,crop.paletteRefs,snapshot.palette);
}

export const candidatePng = (candidate: Candidate,palette: Snapshot["palette"]): string => refsPng(candidate.bounds,candidate.paletteRefs,palette);

export function candidateDiff(candidateValue: unknown,snapshot: Snapshot,spec: EditSpec,layerUuid=spec.layerUuids[0]): PixelDiff {
  const candidate=validateCandidate(candidateValue);
  if (!layerUuid || candidate.snapshotToken!==snapshot.token || spec.snapshotToken!==snapshot.token || spec.frame!==snapshot.frame || !spec.layerUuids.includes(layerUuid) || !snapshot.layers.some(layer=>layer.uuid===layerUuid) || !sameRect(candidate.bounds,spec.mask.bounds)) throw new Error("stale_snapshot");
  const original=snapshot.crop;
  if (!original || !sameRect(original.bounds,candidate.bounds) || !original.paletteRefs) throw new Error("validation_failed: comparable crop missing");
  const allowed=new Set(snapshot.palette.map(entry=>entry.index));
  const changes=[];
  for (let i=0;i<candidate.paletteRefs.length;i++) {
    const ref=candidate.paletteRefs[i]!;
    if (ref!==TRANSPARENT&&!allowed.has(ref)) throw new Error("validation_failed: palette");
    if (!enabled(spec.mask,i) && ref!==original.paletteRefs[i]) throw new Error("unauthorized_change: mask");
    if (ref!==original.paletteRefs[i]) changes.push({x:candidate.bounds.x+i%candidate.bounds.width,y:candidate.bounds.y+Math.floor(i/candidate.bounds.width),paletteRef:ref});
  }
  return {snapshotToken:snapshot.token,spriteId:snapshot.spriteId,frame:spec.frame,layerUuid,changes};
}

export const GENERATION_BUDGET_MS=110_000;
export interface PipelineMetric { phase: "crop"|"provider"|"validation"; durationMs: number; bytes: number }
export interface PipelineOptions { semanticApproved?: boolean; evaluateSemantic?: (candidate:Candidate,diff:PixelDiff)=>number; getCurrentSnapshot?:()=>Promise<Snapshot>; onMetric?:(metric:PipelineMetric)=>void; generationTimeoutMs?:number }
export class Pipeline {
  constructor(private readonly provider: Provider,private readonly options:PipelineOptions={}) {}
  async generate(snapshot: Snapshot,spec: EditSpec): Promise<{candidate: Candidate;diff: PixelDiff;attempts: number;confirmationRequired: boolean;semanticScore?:number}> {
    const timeoutMs=this.options.generationTimeoutMs ?? GENERATION_BUDGET_MS;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs); timer.unref();
    const timeoutError=()=>new Error(`timeout: provider generation exceeded ${timeoutMs} ms`);
    const profile=analyzeArtDirection(snapshot,spec.intent);
    const artisticPrompt=compileArtPrompt(profile,spec,snapshot.palette);
    const schema=candidateSchema(snapshot.token,spec.mask.bounds,snapshot.palette);
    const candidateShape={snapshotToken:snapshot.token,bounds:spec.mask.bounds};
    const artistic={candidateShape,artisticPrompt,artDirectionProfile:profile,candidateSchema:schema};
    const errors:string[]=[]; let previousDiff:PixelDiff|undefined;
    try {
      for (let attempt=1;attempt<=3;attempt++) {
        if(controller.signal.aborted)throw timeoutError();
        const cropStarted=performance.now();
        const request:ProviderRequest=attempt===1
          ? {...artistic,intent:spec.intent,cropPngBase64:cropPng(snapshot),mask:spec.mask,palette:snapshot.palette}
          : {...artistic,errors:[...errors],previousDiff};
        if(attempt===1)this.options.onMetric?.({phase:"crop",durationMs:performance.now()-cropStarted,bytes:Buffer.byteLength(request.cropPngBase64 ?? "","base64")});
        try {
          const providerStarted=performance.now(); let raw:unknown;
          try { raw=await this.provider.generate(request,controller.signal) }
          finally { this.options.onMetric?.({phase:"provider",durationMs:performance.now()-providerStarted,bytes:Buffer.byteLength(JSON.stringify(request))+(raw===undefined?0:Buffer.byteLength(JSON.stringify(raw)))}) }
          if(controller.signal.aborted)throw timeoutError();
          if(this.options.getCurrentSnapshot)assertFresh(snapshot,await this.options.getCurrentSnapshot());
          const validationStarted=performance.now(); let candidate!:Candidate,diff!:PixelDiff;
          try { candidate=validateCandidate(raw); diff=candidateDiff(candidate,snapshot,spec) }
          finally { this.options.onMetric?.({phase:"validation",durationMs:performance.now()-validationStarted,bytes:raw===undefined?0:Buffer.byteLength(JSON.stringify(raw))}) }
          const artisticErrors=artDirectionErrors(candidate,snapshot,spec,profile);
          if(artisticErrors.length){errors.push(...artisticErrors);previousDiff=diff;continue}
          const semanticScore=this.options.evaluateSemantic?.(candidate,diff);
          const action=semanticScore===undefined?"confirm":semanticAction(semanticScore,this.options.semanticApproved);
          if(action==="retry"){errors.push(`semantic_score:${semanticScore}`);previousDiff=diff;continue}
          return {candidate,diff,attempts:attempt,confirmationRequired:action!=="apply",...(semanticScore===undefined?{}:{semanticScore})};
        } catch (error) {
          if(controller.signal.aborted)throw timeoutError();
          const message=error instanceof Error?error.message:String(error); errors.push(message);
          if (message.startsWith("timeout")||message.startsWith("provider_unavailable")||message.startsWith("stale_snapshot")) throw error;
          previousDiff=undefined;
        }
      }
      throw new Error("attempts_exhausted");
    } finally { clearTimeout(timer); }
  }
}

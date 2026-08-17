import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { Provider, ProviderRequest } from "./provider.js";
import { TRANSPARENT, type Candidate, type EditSpec, type Mask, type PixelDiff, type Rect, type Snapshot, validateCandidate } from "./protocol.js";
import { semanticAction } from "./semantic.js";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
};
export const hashSnapshot = (snapshot: Omit<Snapshot,"token">): string => createHash("sha256").update(canonical(snapshot)).digest("hex");

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

export function cropPng(snapshot: Snapshot): string {
  const crop=snapshot.crop;
  if (!crop) throw new Error("validation_failed: crop missing");
  if (crop.pngBase64) return crop.pngBase64;
  if (!crop.paletteRefs || crop.paletteRefs.length!==crop.bounds.width*crop.bounds.height) throw new Error("validation_failed: crop size");
  const colors=new Map(snapshot.palette.map(entry=>[entry.index,entry.rgba]));
  const png=new PNG({width:crop.bounds.width,height:crop.bounds.height});
  crop.paletteRefs.forEach((ref,i)=>{
    const rgba=ref===TRANSPARENT ? 0 : colors.get(ref);
    if (rgba===undefined) throw new Error("validation_failed: crop palette reference");
    png.data[i*4]=(rgba>>>24)&255; png.data[i*4+1]=(rgba>>>16)&255; png.data[i*4+2]=(rgba>>>8)&255; png.data[i*4+3]=rgba&255;
  });
  return PNG.sync.write(png).toString("base64");
}

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

export interface PipelineOptions { semanticApproved?: boolean; evaluateSemantic?: (candidate:Candidate,diff:PixelDiff)=>number; getCurrentSnapshot?:()=>Promise<Snapshot> }
export class Pipeline {
  constructor(private readonly provider: Provider,private readonly options:PipelineOptions={}) {}
  async generate(snapshot: Snapshot,spec: EditSpec): Promise<{candidate: Candidate;diff: PixelDiff;attempts: number;confirmationRequired: boolean;semanticScore?:number}> {
    const errors:string[]=[]; let previousDiff:PixelDiff|undefined;
    for (let attempt=1;attempt<=3;attempt++) {
      const request:ProviderRequest=attempt===1
        ? {intent:spec.intent,cropPngBase64:cropPng(snapshot),mask:spec.mask,palette:snapshot.palette}
        : {errors:[...errors],previousDiff};
      try {
        const raw=await this.provider.generate(request);
        if(this.options.getCurrentSnapshot)assertFresh(snapshot,await this.options.getCurrentSnapshot());
        const candidate=validateCandidate(raw);
        const diff=candidateDiff(candidate,snapshot,spec);
        const semanticScore=this.options.evaluateSemantic?.(candidate,diff);
        const action=semanticScore===undefined?"confirm":semanticAction(semanticScore,this.options.semanticApproved);
        if(action==="retry"){errors.push(`semantic_score:${semanticScore}`);previousDiff=diff;continue}
        return {candidate,diff,attempts:attempt,confirmationRequired:action!=="apply",...(semanticScore===undefined?{}:{semanticScore})};
      } catch (error) {
        const message=error instanceof Error?error.message:String(error); errors.push(message);
        if (message.startsWith("provider_unavailable")||message.startsWith("stale_snapshot")) throw error;
        previousDiff=undefined;
      }
    }
    throw new Error("attempts_exhausted");
  }
}

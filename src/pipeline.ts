import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { analyzeArtDirection, artDirectionErrors } from "./art-direction.js";
import { fixPixelArt } from "./pixel-art-fixer.js";
import type { PaletteMode } from "./pixel-art-fixer.js";
import { TRANSPARENT, type Candidate, type EditSpec, type Mask, type PixelChange, type PixelDiff, type PixelSpan, type Rect, type Snapshot, validateCandidate } from "./protocol.js";

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
export const maskEnabled = (mask: Mask,index: number) => ((Buffer.from(mask.bits,"base64")[index>>3] ?? 0) & (1 << (index&7))) !== 0;

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

export const candidatePng = (candidate: Candidate,palette: Snapshot["palette"]): string => refsPng(candidate.bounds,candidate.paletteRefs,candidate.palette??palette);

export function candidateDiff(candidateValue: unknown,snapshot: Snapshot,spec: EditSpec,layerUuid=spec.layerUuids[0]): PixelDiff {
  const candidate=validateCandidate(candidateValue);
  if (!layerUuid || candidate.snapshotToken!==snapshot.token || spec.snapshotToken!==snapshot.token || spec.frame!==snapshot.frame || !spec.layerUuids.includes(layerUuid) || !snapshot.layers.some(layer=>layer.uuid===layerUuid) || !sameRect(candidate.bounds,spec.mask.bounds)) throw new Error("stale_snapshot");
  const original=snapshot.crop;
  if (!original || !sameRect(original.bounds,candidate.bounds) || !original.paletteRefs) throw new Error("validation_failed: comparable crop missing");
  const allowed=new Set((candidate.palette??snapshot.palette).map(entry=>entry.index));
  const changes:PixelChange[]=[],spans:PixelSpan[]=[];
  for(let y=0;y<candidate.bounds.height;y++)for(let x=0;x<candidate.bounds.width;){
    const i=y*candidate.bounds.width+x,ref=candidate.paletteRefs[i]!;
    if(ref!==TRANSPARENT&&!allowed.has(ref))throw new Error("validation_failed: palette");
    if(!maskEnabled(spec.mask,i)&&ref!==original.paletteRefs[i])throw new Error("unauthorized_change: mask");
    if(ref===original.paletteRefs[i]){x++;continue}
    let length=1;
    while(x+length<candidate.bounds.width){const next=i+length,nextRef=candidate.paletteRefs[next]!;if(nextRef!==ref||nextRef===original.paletteRefs[next])break;if(!maskEnabled(spec.mask,next)&&nextRef!==original.paletteRefs[next])throw new Error("unauthorized_change: mask");length++}
    const change={x:candidate.bounds.x+x,y:candidate.bounds.y+y,paletteRef:ref};if(length===1)changes.push(change);else spans.push({...change,length});x+=length;
  }
  return {snapshotToken:snapshot.token,spriteId:snapshot.spriteId,frame:spec.frame,layerUuid,changes,...(spans.length?{spans}:{}),...(candidate.palette?{palette:candidate.palette}:{})};
}

export function candidateFromPng(pngBase64:string,snapshot:Snapshot,spec:EditSpec,profile:ReturnType<typeof analyzeArtDirection>,fit:"contain"|"cover"="cover",validateArt=true,paletteMode:PaletteMode="current",maxColors?:number):{candidate:Candidate;diff:PixelDiff}{
  const fixed=fixPixelArt(pngBase64,{width:spec.mask.bounds.width,height:spec.mask.bounds.height,palette:snapshot.palette,...(maxColors===undefined?{}:{maxColors}),fit,paletteMode});
  const original=snapshot.crop?.paletteRefs;if(!original||original.length!==fixed.paletteRefs.length)throw new Error("validation_failed: comparable crop missing");
  fixed.paletteRefs.forEach((_,index)=>{if(!maskEnabled(spec.mask,index))fixed.paletteRefs[index]=original[index]!});
  const candidate=validateCandidate({snapshotToken:snapshot.token,bounds:spec.mask.bounds,paletteRefs:fixed.paletteRefs,...(fixed.palette?{palette:fixed.palette}:{})}),diff=candidateDiff(candidate,snapshot,spec);
  if(validateArt){const errors=artDirectionErrors(candidate,snapshot,spec,profile);if(errors.length)throw new Error(`validation_failed: ${errors.join(",")}`)}
  return {candidate,diff};
}

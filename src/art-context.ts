import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { z } from "zod";

const MAX_MANIFEST_BYTES=64*1024;
const MAX_REFERENCE_BYTES=2*1024*1024;
const MAX_REFERENCE_PAYLOAD_BYTES=4*1024*1024;
const short=z.string().trim().min(1).max(120);
const labels=z.array(short).max(12);
const range=(max:number)=>z.object({min:z.number().int().min(1).max(max),max:z.number().int().min(1).max(max)}).strict().refine(value=>value.min<=value.max,"min must not exceed max");

export const artContextLockFields=[
  "nativeHeight","proportions","anatomy","outline.mode","outline.thickness","outline.treatment",
  "shading.valuesPerMaterial","shading.light","shading.edges","clusters.size","clusters.detailDensity",
  "clusters.antiAliasing","clusters.maxColors","paletteRoles","priorityAccessories","negativeConstraints","styleNotes"
] as const;
export type ArtContextLockField=typeof artContextLockFields[number];

const paletteRoles=z.object({
  outline:z.array(z.number().int().nonnegative()).max(16),
  shadow:z.array(z.number().int().nonnegative()).min(1).max(32),
  base:z.array(z.number().int().nonnegative()).min(1).max(32),
  highlight:z.array(z.number().int().nonnegative()).min(1).max(32)
}).strict();

export const artContextManifestV1Schema=z.object({
  version:z.literal(1),
  name:z.string().trim().min(1).max(80),
  nativeHeight:range(256),
  proportions:labels,
  anatomy:labels,
  outline:z.object({mode:z.enum(["none","black-continuous","colored-continuous","selective"]),thickness:z.number().int().min(0).max(4),treatment:z.enum(["black","colored"])}).strict(),
  shading:z.object({valuesPerMaterial:z.tuple([z.number().int().min(1).max(8),z.number().int().min(1).max(8)]).refine(([min,max])=>min<=max,"minimum values must not exceed maximum"),light:short,edges:z.enum(["hard","soft"])}).strict(),
  clusters:z.object({size:range(256),detailDensity:z.object({min:z.number().min(0).max(1),max:z.number().min(0).max(1)}).strict().refine(value=>value.min<=value.max,"min must not exceed max"),antiAliasing:z.boolean(),maxColors:z.number().int().min(1).max(256)}).strict(),
  paletteRoles,
  priorityAccessories:labels,
  negativeConstraints:labels,
  styleNotes:labels,
  references:z.array(z.object({path:z.string().trim().min(1).max(240),purpose:short}).strict()).max(3),
  locked:z.array(z.enum(artContextLockFields)).max(artContextLockFields.length)
}).strict().superRefine((manifest,ctx)=>{
  const indices=Object.values(manifest.paletteRoles).flat();
  if((manifest.outline.mode==="none")!==(manifest.outline.thickness===0))ctx.addIssue({code:"custom",path:["outline","thickness"],message:"outline thickness must be 0 only when outline mode is none"});
  if(manifest.outline.mode!=="none"&&!manifest.paletteRoles.outline.length)ctx.addIssue({code:"custom",path:["paletteRoles","outline"],message:"outline role is required for the selected outline mode"});
  if(manifest.outline.mode==="none"&&manifest.paletteRoles.outline.length)ctx.addIssue({code:"custom",path:["paletteRoles","outline"],message:"outline role must be empty when outline mode is none"});
  if(new Set(indices).size!==indices.length)ctx.addIssue({code:"custom",path:["paletteRoles"],message:"palette indices must be unique across roles"});
  if(new Set(manifest.locked).size!==manifest.locked.length)ctx.addIssue({code:"custom",path:["locked"],message:"locked fields must be unique"});
});

export type ArtContextManifestV1=z.infer<typeof artContextManifestV1Schema>;
export interface LoadedArtReference { path:string; purpose:string; width:number; height:number; pngBase64:string }
export interface LoadedArtContext { manifest:ArtContextManifestV1; references:LoadedArtReference[] }

const inside=(root:string,target:string)=>target===root||target.startsWith(root+path.sep);

export async function loadArtContext(manifestPath:string):Promise<LoadedArtContext>{
  if(!manifestPath.trim())throw new Error("art_context_invalid: empty manifest path");
  let manifestBytes:Buffer;
  try{manifestBytes=await readFile(manifestPath)}catch{throw new Error("art_context_invalid: manifest unreadable")}
  if(manifestBytes.length>MAX_MANIFEST_BYTES)throw new Error(`art_context_invalid: manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  let json:unknown;
  try{json=JSON.parse(manifestBytes.toString("utf8"))}catch{throw new Error("art_context_invalid: malformed JSON")}
  const parsed=artContextManifestV1Schema.safeParse(json);
  if(!parsed.success)throw new Error(`art_context_invalid: ${z.prettifyError(parsed.error)}`);

  const root=await realpath(path.dirname(path.resolve(manifestPath)));
  const references:LoadedArtReference[]=[];
  let total=0;
  for(const reference of parsed.data.references){
    if(path.isAbsolute(reference.path)||/^[a-z][a-z\d+.-]*:/i.test(reference.path))throw new Error(`art_context_invalid: reference path must be local and relative: ${reference.path}`);
    const resolved=path.resolve(root,reference.path);
    if(!inside(root,resolved))throw new Error(`art_context_invalid: reference escapes manifest directory: ${reference.path}`);
    let actual:string,bytes:Buffer;
    try{actual=await realpath(resolved);bytes=await readFile(actual)}catch{throw new Error(`art_context_invalid: reference unreadable: ${reference.path}`)}
    if(!inside(root,actual))throw new Error(`art_context_invalid: reference escapes manifest directory: ${reference.path}`);
    if(bytes.length>MAX_REFERENCE_BYTES||(total+=bytes.length)>MAX_REFERENCE_PAYLOAD_BYTES)throw new Error("art_context_invalid: reference payload too large");
    if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error(`art_context_invalid: reference is not PNG: ${reference.path}`);
    const headerWidth=bytes.readUInt32BE(16),headerHeight=bytes.readUInt32BE(20);
    if(headerWidth<1||headerHeight<1||headerWidth>1024||headerHeight>1024)throw new Error(`art_context_invalid: reference dimensions out of range: ${reference.path}`);
    let png:PNG;
    try{png=PNG.sync.read(bytes)}catch{throw new Error(`art_context_invalid: malformed PNG: ${reference.path}`)}
    if(png.width!==headerWidth||png.height!==headerHeight)throw new Error(`art_context_invalid: malformed PNG dimensions: ${reference.path}`);
    references.push({path:reference.path,purpose:reference.purpose,width:png.width,height:png.height,pngBase64:bytes.toString("base64")});
  }
  return {manifest:parsed.data,references};
}

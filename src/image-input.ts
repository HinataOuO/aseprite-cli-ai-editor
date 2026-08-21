import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { MAX_PNG_BYTES, MAX_PNG_DIMENSION } from "./pixel-art-fixer.js";
import type { PaletteEntry, Rect } from "./protocol.js";

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const inside=(root:string,target:string)=>target===root||target.startsWith(root+path.sep);
const invalid=(detail:string):never=>{throw new Error(`validation_failed: ${detail}`)};

export async function readLocalPng(imagePath:string,configuredRoot=process.env.AI_EDITOR_IMAGE_INPUT_DIR??process.cwd()):Promise<string>{
  if(path.extname(imagePath).toLowerCase()!==".png")invalid("imagePath must name a PNG file");
  const root=await realpath(path.resolve(configuredRoot)).catch(()=>invalid("image input directory does not exist"));
  const requested=path.resolve(imagePath),info=await lstat(requested).catch(()=>invalid("imagePath does not exist"));
  if(info.isSymbolicLink()||!info.isFile())invalid("imagePath must be a regular non-symlink file");
  const actual=await realpath(requested).catch(()=>invalid("imagePath does not exist"));
  if(!inside(root,actual))invalid("imagePath is outside AI_EDITOR_IMAGE_INPUT_DIR");
  const handle=await open(requested,constants.O_RDONLY|constants.O_NOFOLLOW).catch(()=>invalid("imagePath cannot be opened safely"));
  try{
    const opened=await handle.stat();
    if(opened.dev!==info.dev||opened.ino!==info.ino)invalid("imagePath changed while opening");
    if(!opened.isFile()||opened.size<24||opened.size>MAX_PNG_BYTES)invalid("PNG size must be between 24 bytes and 8 MiB");
    const bytes=await handle.readFile();
    if(!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(8)!==13||bytes.toString("ascii",12,16)!=="IHDR")invalid("PNG header");
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(!width||!height||width>MAX_PNG_DIMENSION||height>MAX_PNG_DIMENSION)invalid("PNG dimensions must be within 2048x2048");
    return bytes.toString("base64");
  }finally{await handle.close()}
}

export interface ImageGenerationContext {bounds:Rect;palette?:PaletteEntry[];maxColors?:number;artBrief:string}
export interface ImageProviderOptions {fetch?:typeof fetch;timeoutMs?:number;apiKey?:string;model?:string}

const colorHex=(rgba:number)=>`#${(rgba>>>8).toString(16).padStart(6,"0")}${(rgba&255).toString(16).padStart(2,"0")}`;

export async function generateImagePng(prompt:string,context:ImageGenerationContext,options:ImageProviderOptions={}):Promise<string>{
  const apiKey=options.apiKey??process.env.OPENAI_API_KEY;
  if(!apiKey)invalid("OPENAI_API_KEY is required");
  const model=options.model??process.env.OPENAI_IMAGE_MODEL??"gpt-image-2",ratio=context.bounds.width/context.bounds.height;
  const size=ratio>1.2?"1536x1024":ratio<1/1.2?"1024x1536":"1024x1024";
  const enriched=[
    "Generate exactly one PNG for a pixel-art layer.",
    `User request: ${prompt}`,
    `Target bounds: ${context.bounds.width}x${context.bounds.height}; aspect ratio ${context.bounds.width}:${context.bounds.height}.`,
    context.palette?`Allowed Aseprite palette (index:RGBA): ${context.palette.map(({index,rgba})=>`${index}:${colorHex(rgba)}`).join(", ")}.`:`Use at most ${context.maxColors} colors including transparency. Do not target any pre-existing palette.`,
    "Use transparent background where no sprite pixel belongs. Hard pixel clusters; no blur or gradients.",
    context.artBrief
  ].join("\n");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs??120_000);timer.unref();
  let response:Response;
  try{
    response=await (options.fetch??globalThis.fetch)("https://api.openai.com/v1/images/generations",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({model,prompt:enriched,n:1,size,output_format:"png"}),signal:controller.signal});
  }catch(error){
    const detail=error instanceof Error&&error.name==="AbortError"?"timeout":"request failed";
    throw new Error(`provider_unavailable: OpenAI image generation ${detail}`);
  }finally{clearTimeout(timer)}
  if(!response.ok)throw new Error(`provider_unavailable: OpenAI image generation HTTP ${response.status}`);
  let payload:unknown;
  try{payload=await response.json()}catch{invalid("OpenAI image response is not JSON")}
  const data=(payload as {data?:unknown})?.data,image=Array.isArray(data)?(data[0] as {b64_json?:unknown}|undefined)?.b64_json:undefined;
  if(typeof image!=="string"||!image)return invalid("OpenAI image response has no PNG");
  return image;
}

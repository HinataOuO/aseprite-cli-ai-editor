import { PNG } from "pngjs";
import { TRANSPARENT, type Candidate, type EditSpec, type PaletteEntry, type Rect, type Snapshot } from "./protocol.js";

export type RuleSource="technical"|"explicit"|"observed"|"default";
export interface ArtRule<T>{value:T;evidence:string;confidence:number;source:RuleSource}
export type OutlineMode="none"|"black-continuous"|"colored-continuous"|"selective";

export interface ArtDirectionProfile {
  nativeSprite:{canvas:{width:number;height:number};contentBounds:ArtRule<Rect|null>;nominalSize:ArtRule<16|32|48|64>;detailBudget:ArtRule<string>};
  pixelStyle:{outline:ArtRule<OutlineMode>;outlineThickness:ArtRule<number>;clusterSize:ArtRule<number>;antiAliasing:ArtRule<boolean>};
  rendering:{shadesPerMaterial:ArtRule<number>;maxColors:ArtRule<number>;maxDensity:ArtRule<number>;lightShape:ArtRule<string>};
  paletteRoles:{outline:number[];shadow:number[];base:number[];highlight:number[]};
  character:ArtRule<string>;
  pose:ArtRule<string>;
  preserve:ArtRule<string[]>;
  negativeConstraints:ArtRule<string[]>;
  priorities:string[];
}

const rule=<T>(value:T,evidence:string,confidence:number,source:RuleSource):ArtRule<T>=>({value,evidence,confidence,source});
const rgbaChannels=(rgba:number)=>[(rgba>>>24)&255,(rgba>>>16)&255,(rgba>>>8)&255,(rgba&255)] as const;
const luminance=(rgba:number)=>{const [r,g,b]=rgbaChannels(rgba);return .2126*r+.7152*g+.0722*b};
const isBlack=(rgba:number)=>{const [r,g,b]=rgbaChannels(rgba);return Math.max(r,g,b)<=40};
const sameRect=(a:Rect,b:Rect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;

function cropRefs(snapshot:Snapshot):{bounds:Rect;refs:number[]}|null{
  const crop=snapshot.crop;if(!crop)return null;
  if(crop.paletteRefs)return {bounds:crop.bounds,refs:crop.paletteRefs};
  if(!crop.pngBase64)return null;
  const png=PNG.sync.read(Buffer.from(crop.pngBase64,"base64"));
  if(png.width!==crop.bounds.width||png.height!==crop.bounds.height)return null;
  const colors=new Map(snapshot.palette.map(({index,rgba})=>[rgba>>>0,index]));
  const refs=Array.from({length:png.width*png.height},(_,i)=>{
    const rgba=((png.data[i*4]!<<24)|(png.data[i*4+1]!<<16)|(png.data[i*4+2]!<<8)|png.data[i*4+3]!)>>>0;
    return png.data[i*4+3]===0?TRANSPARENT:(colors.get(rgba)??TRANSPARENT);
  });
  return {bounds:crop.bounds,refs};
}

function measurements(bounds:Rect,refs:number[],palette:PaletteEntry[]){
  const frequency=new Map<number,number>();let minX=bounds.width,minY=bounds.height,maxX=-1,maxY=-1,opaque=0;
  refs.forEach((ref,i)=>{if(ref===TRANSPARENT)return;opaque++;frequency.set(ref,(frequency.get(ref)??0)+1);const x=i%bounds.width,y=Math.floor(i/bounds.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)});
  const contentBounds=maxX<0?null:{x:bounds.x+minX,y:bounds.y+minY,width:maxX-minX+1,height:maxY-minY+1};
  const boundary:number[]=[];
  refs.forEach((ref,i)=>{if(ref===TRANSPARENT)return;const x=i%bounds.width,y=Math.floor(i/bounds.width);if([[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([nx,ny])=>nx!<0||ny!<0||nx!>=bounds.width||ny!>=bounds.height||refs[ny!*bounds.width+nx!]===TRANSPARENT))boundary.push(ref)});
  const edgeFrequency=new Map<number,number>();for(const ref of boundary)edgeFrequency.set(ref,(edgeFrequency.get(ref)??0)+1);
  const colors=new Map(palette.map(entry=>[entry.index,entry.rgba]));
  const used=[...frequency.keys()].sort((a,b)=>luminance(colors.get(a)??0)-luminance(colors.get(b)??0));
  const outline=used.length<2?undefined:{ref:used[0]!,coverage:(edgeFrequency.get(used[0]!)??0)/Math.max(1,boundary.length)};
  const base=outline?[...used.filter(ref=>ref!==outline.ref)].sort((a,b)=>(frequency.get(b)??0)-(frequency.get(a)??0))[0]:undefined;
  let antiAliasTransitions=0,outlineThickness=outline?1:0;
  if(outline&&base!==undefined){
    const low=luminance(colors.get(outline.ref)??0),high=luminance(colors.get(base)??0);
    refs.forEach((ref,i)=>{if(ref===TRANSPARENT||ref===outline.ref||ref===base)return;const lum=luminance(colors.get(ref)??0);if(lum<=Math.min(low,high)||lum>=Math.max(low,high))return;const x=i%bounds.width,y=Math.floor(i/bounds.width),neighbors=[x?i-1:-1,x<bounds.width-1?i+1:-1,y?i-bounds.width:-1,y<bounds.height-1?i+bounds.width:-1].map(n=>refs[n]);if(neighbors.includes(outline.ref)&&neighbors.includes(base))antiAliasTransitions++});
    outer:for(let y=1;y<bounds.height-1;y++)for(let x=1;x<bounds.width-1;x++){const i=y*bounds.width+x;if(refs[i]===outline.ref&&[-bounds.width-1,-bounds.width,-bounds.width+1,-1,1,bounds.width-1,bounds.width,bounds.width+1].every(d=>refs[i+d]===outline.ref)){outlineThickness=2;break outer}}
  }
  const componentSizes:number[]=[];const seen=new Set<number>();
  refs.forEach((ref,start)=>{if(ref===TRANSPARENT||seen.has(start))return;let size=0;const stack=[start];seen.add(start);while(stack.length){const i=stack.pop()!;size++;const x=i%bounds.width,y=Math.floor(i/bounds.width);for(const n of [i-1,i+1,i-bounds.width,i+bounds.width])if(n>=0&&n<refs.length&&!seen.has(n)&&refs[n]===ref&&(n===i-1||n===i+1?Math.floor(n/bounds.width)===y:true)){seen.add(n);stack.push(n)}}componentSizes.push(size)});
  componentSizes.sort((a,b)=>a-b);
  return {frequency,colors,used,contentBounds,opaque,density:opaque/refs.length,outline,outlineThickness,antiAliasing:antiAliasTransitions>=2,clusterSize:componentSizes.length?componentSizes[Math.floor(componentSizes.length/2)]!:1};
}

export function analyzeArtDirection(snapshot:Snapshot,intent:string):ArtDirectionProfile{
  const crop=cropRefs(snapshot),fallbackBounds=snapshot.crop?.bounds??{x:0,y:0,width:snapshot.width,height:snapshot.height};
  const measured=measurements(crop?.bounds??fallbackBounds,crop?.refs??Array(fallbackBounds.width*fallbackBounds.height).fill(TRANSPARENT),snapshot.palette);
  const extent=measured.contentBounds?Math.max(measured.contentBounds.width,measured.contentBounds.height):Math.max(fallbackBounds.width,fallbackBounds.height);
  const nominal:16|32|48|64=snapshot.width===64&&extent<=52&&extent>32?48:extent<=16?16:extent<=32?32:64;
  const detail=nominal===16?"silhouette and fundamental forms; almost no detail":nominal===32?"simplified head and limbs; large clusters; 2-3 shades":nominal===48?"32-48 native-pixel figure inside the 64x64 canvas": "articulated forms while preserving large pixel clusters and a limited palette";
  const outlineCandidate=measured.outline,outlineRef=outlineCandidate?.ref,outlineRgba=outlineRef===undefined?undefined:measured.colors.get(outlineRef);
  let outline:OutlineMode=outlineCandidate?(outlineCandidate.coverage>=.72?(outlineRgba!==undefined&&isBlack(outlineRgba)?"black-continuous":"colored-continuous"):outlineCandidate.coverage>=.12?"selective":"none"):"none";
  let outlineSource:RuleSource="observed",outlineEvidence=outlineCandidate?`dark edge color ${outlineRef} covers ${Math.round(outlineCandidate.coverage*100)}% of exposed edge`:"fewer than two opaque colors";
  const lower=intent.toLowerCase();
  if(/(?:no|senza) (?:outline|contorno)/.test(lower)){outline="none";outlineSource="explicit";outlineEvidence="explicit intent"}
  else if(/outline selettiv|selective outline/.test(lower)){outline="selective";outlineSource="explicit";outlineEvidence="explicit intent"}
  else if(/outline continu|continuous outline/.test(lower)){outline=outlineRgba!==undefined&&isBlack(outlineRgba)?"black-continuous":"colored-continuous";outlineSource="explicit";outlineEvidence="explicit intent"}
  const nonOutline=measured.used.filter(ref=>ref!==outlineRef),byFrequency=[...nonOutline].sort((a,b)=>(measured.frequency.get(b)??0)-(measured.frequency.get(a)??0));
  const shadow=nonOutline.slice(0,1),base=byFrequency.slice(0,1),highlight=nonOutline.slice(-1);
  const observedColors=measured.used.length;
  return {
    nativeSprite:{canvas:{width:snapshot.width,height:snapshot.height},contentBounds:rule(measured.contentBounds,crop?"non-transparent crop pixels":"crop unavailable",crop?.refs?.length?1:.2,"observed"),nominalSize:rule(nominal,`content extent ${extent}px on ${snapshot.width}x${snapshot.height}`,measured.contentBounds?.width? .85:.4,"observed"),detailBudget:rule(detail,`resolution rule for ${nominal}px`,1,"technical")},
    pixelStyle:{outline:rule(outline,outlineEvidence,outlineSource==="explicit"?1:.75,outlineSource),outlineThickness:rule(measured.outlineThickness||1,measured.outlineThickness>1?"solid 3x3 outline-color area observed":"single-pixel edge dominates",outline==="none"?.4:.7,outline==="none"?"default":"observed"),clusterSize:rule(Math.max(1,Math.round(measured.clusterSize)),"median same-color connected component",crop? .7:.2,"observed"),antiAliasing:rule(measured.antiAliasing,measured.antiAliasing?"repeated intermediate edge colors bridge outline and base":"no systematic intermediate edge-color transitions",crop?.refs?.length? .75:.3,"observed")},

    rendering:{shadesPerMaterial:rule(Math.min(3,Math.max(2,nonOutline.length)),`${nonOutline.length} non-outline colors observed`,.65,"observed"),maxColors:rule(Math.min(snapshot.palette.length,Math.max(3,observedColors+2)),"observed colors plus edit allowance",.7,"observed"),maxDensity:rule(Math.min(1,Math.max(.65,measured.density*1.5)),`observed opaque density ${measured.density.toFixed(2)}`,.65,"observed"),lightShape:rule("hard-edged shadow and highlight blocks","pixel-art default",.8,"default")},
    paletteRoles:{outline:outline==="none"||outlineRef===undefined?[]:[outlineRef],shadow,base,highlight},
    character:rule(intent,"explicit user intent",1,"explicit"),pose:rule(intent,"pose/action retained verbatim; do not invent specifics",.8,"explicit"),
    preserve:rule(["pixels outside the mask","canvas dimensions","snapshot token, frame, and target layer","native pixel grid"],"document authorization",1,"technical"),
    negativeConstraints:rule(["no gradients","no blur",...(measured.antiAliasing?[]:["no soft anti-aliasing"]),"no subpixel detail","no unauthorized palette indices","no pixels outside the mask"],"pixel and protocol constraints",1,"technical"),
    priorities:["silhouette","proportions","pixel clusters","palette roles","details"]
  };
}

const maskEnabled=(spec:EditSpec,index:number)=>((Buffer.from(spec.mask.bits,"base64")[index>>3]??0)&(1<<(index&7)))!==0;
export function artDirectionErrors(candidate:Candidate,snapshot:Snapshot,spec:EditSpec,profile:ArtDirectionProfile):string[]{
  const errors:string[]=[];
  if(!sameRect(candidate.bounds,spec.mask.bounds))return ["artistic_bounds_changed"];
  const allowed=new Set(snapshot.palette.map(entry=>entry.index));
  if(candidate.paletteRefs.some(ref=>ref!==TRANSPARENT&&!allowed.has(ref)))errors.push("artistic_foreign_palette_color");
  if(candidate.paletteRefs.some((ref,i)=>!maskEnabled(spec,i)&&ref!==snapshot.crop?.paletteRefs?.[i]))errors.push("artistic_pixel_outside_mask");
  const used=new Set(candidate.paletteRefs.filter(ref=>ref!==TRANSPARENT));
  if(used.size>profile.rendering.maxColors.value)errors.push(`artistic_too_many_colors:${used.size}>${profile.rendering.maxColors.value}`);
  const density=candidate.paletteRefs.filter(ref=>ref!==TRANSPARENT).length/candidate.paletteRefs.length;
  if(density>profile.rendering.maxDensity.value+.05)errors.push(`artistic_density:${density.toFixed(2)}>${profile.rendering.maxDensity.value.toFixed(2)}`);
  const outline=new Set(profile.paletteRoles.outline);
  if(profile.pixelStyle.outlineThickness.value<=1&&outline.size){const w=candidate.bounds.width,h=candidate.bounds.height,p=candidate.paletteRefs;outer:for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(outline.has(p[i]!)&&[-w-1,-w,-w+1,-1,1,w-1,w,w+1].every(d=>outline.has(p[i+d]!))){errors.push("artistic_outline_thicker_than_1px");break outer}}}
  if(!profile.pixelStyle.antiAliasing.value&&measurements(candidate.bounds,candidate.paletteRefs,snapshot.palette).antiAliasing)errors.push("artistic_soft_antialiasing_detected");
  return errors;
}

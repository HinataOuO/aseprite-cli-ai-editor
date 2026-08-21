import { PNG } from "pngjs";
import type { ArtContextLockField, LoadedArtContext } from "./art-context.js";
import { TRANSPARENT, type Candidate, type EditSpec, type PaletteEntry, type Rect, type Snapshot } from "./protocol.js";

export type RuleSource="technical"|"context"|"explicit"|"observed"|"default";
export interface ArtRule<T>{value:T;evidence:string;confidence:number;source:RuleSource;locked:boolean}
export type OutlineMode="none"|"black-continuous"|"colored-continuous"|"selective";
export interface PaletteRoles {outline:number[];shadow:number[];base:number[];highlight:number[]}

export interface ArtDirectionProfile {
  artContext?:{name:string;version:1;locked:ArtContextLockField[];references:{path:string;purpose:string;width:number;height:number}[]};
  nativeSprite:{canvas:{width:number;height:number};contentBounds:ArtRule<Rect|null>;nativeHeight:ArtRule<{min:number;max:number}>;nominalSize:ArtRule<number>;detailBudget:ArtRule<string>};
  roster:{proportions:ArtRule<string[]>;anatomy:ArtRule<string[]>;priorityAccessories:ArtRule<string[]>;styleNotes:ArtRule<string[]>};
  pixelStyle:{outline:ArtRule<OutlineMode>;outlineThickness:ArtRule<number>;outlineTreatment:ArtRule<"black"|"colored">;clusterSize:ArtRule<{min:number;max:number}>;antiAliasing:ArtRule<boolean>};
  rendering:{shadesPerMaterial:ArtRule<{min:number;max:number}>;maxColors:ArtRule<number>;maxDensity:ArtRule<number>;lightDirection:ArtRule<string>;shadingEdges:ArtRule<"hard"|"soft">};
  paletteRoles:PaletteRoles;
  paletteRolesMeta:{source:RuleSource;locked:boolean;evidence:string};
  character:ArtRule<string>;
  pose:ArtRule<string>;
  preserve:ArtRule<string[]>;
  negativeConstraints:ArtRule<string[]>;
  priorities:string[];
}

const rule=<T>(value:T,evidence:string,confidence:number,source:RuleSource,locked=false):ArtRule<T>=>({value,evidence,confidence,source,locked});
const contextRule=<T>(context:LoadedArtContext,path:ArtContextLockField,value:T):ArtRule<T>=>rule(value,`art context ${context.manifest.name}: ${path}`,1,"context",context.manifest.locked.includes(path));
const mergeRule=<T>(explicit:ArtRule<T>|undefined,context:ArtRule<T>|undefined,fallback:ArtRule<T>):ArtRule<T>=>context?.locked?context:explicit??context??fallback;
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

export function analyzeArtDirection(snapshot:Snapshot,intent:string,context?:LoadedArtContext):ArtDirectionProfile{
  const crop=cropRefs(snapshot),fallbackBounds=snapshot.crop?.bounds??{x:0,y:0,width:snapshot.width,height:snapshot.height};
  const measured=measurements(crop?.bounds??fallbackBounds,crop?.refs??Array(fallbackBounds.width*fallbackBounds.height).fill(TRANSPARENT),snapshot.palette);
  const extent=measured.contentBounds?Math.max(measured.contentBounds.width,measured.contentBounds.height):Math.max(fallbackBounds.width,fallbackBounds.height);
  const observedNominal=snapshot.width===64&&extent<=52&&extent>32?48:extent<=16?16:extent<=32?32:extent<=64?64:128;
  const nativeHeight=context?contextRule(context,"nativeHeight",context.manifest.nativeHeight):rule({min:observedNominal,max:observedNominal},`content extent ${extent}px on ${snapshot.width}x${snapshot.height}`,measured.contentBounds?.width?.85:.4,"observed");
  const nominal=context?Math.round((nativeHeight.value.min+nativeHeight.value.max)/2):observedNominal;
  const detail=nominal<=16?"silhouette and fundamental forms; almost no detail":nominal<=32?"simplified head and limbs; large clusters; 2-3 shades":nominal<=48?"32-48 native-pixel figure inside the canvas":nominal<=64?"articulated forms while preserving large pixel clusters and a limited palette":"articulated forms with clear cluster hierarchy, selective detail, and a deliberately limited palette; do not scale up 64px detail uniformly";
  const opaquePalette=snapshot.palette.filter(entry=>(entry.rgba&255)>0),simplePalette=opaquePalette.length>0&&opaquePalette.length<=4;
  const inferred=[...opaquePalette].sort((a,b)=>luminance(a.rgba)-luminance(b.rgba)||a.index-b.index).map(entry=>entry.index);
  const inferredRoles:PaletteRoles=inferred.length===1?{outline:[],shadow:[],base:[inferred[0]!],highlight:[]}:inferred.length===2?{outline:[inferred[0]!],shadow:[],base:[inferred[1]!],highlight:[]}:inferred.length===3?{outline:[inferred[0]!],shadow:[],base:[inferred[1]!],highlight:[inferred[2]!]}:{outline:[inferred[0]!],shadow:[inferred[1]!],base:[inferred[2]!],highlight:[inferred[3]!]};
  const inferSimpleRoles=!context&&!measured.contentBounds&&simplePalette;
  const outlineCandidate=measured.outline,outlineRef=outlineCandidate?.ref,outlineRgba=outlineRef===undefined?undefined:measured.colors.get(outlineRef);
  let outline:OutlineMode=outlineCandidate?(outlineCandidate.coverage>=.72?(outlineRgba!==undefined&&isBlack(outlineRgba)?"black-continuous":"colored-continuous"):outlineCandidate.coverage>=.12?"selective":"none"):inferSimpleRoles&&inferred.length>=2?"selective":"none";
  let outlineSource:RuleSource=inferSimpleRoles?"default":"observed",outlineEvidence=outlineCandidate?`dark edge color ${outlineRef} covers ${Math.round(outlineCandidate.coverage*100)}% of exposed edge`:inferSimpleRoles?"empty crop; simple palette luminance roles":"fewer than two opaque colors";
  const lower=intent.toLowerCase();
  if(/(?:no|senza) (?:outline|contorno)/.test(lower)){outline="none";outlineSource="explicit";outlineEvidence="explicit intent"}
  else if(/outline selettiv|selective outline/.test(lower)){outline="selective";outlineSource="explicit";outlineEvidence="explicit intent"}
  else if(/outline continu|continuous outline/.test(lower)){outline=outlineRgba!==undefined&&isBlack(outlineRgba)?"black-continuous":"colored-continuous";outlineSource="explicit";outlineEvidence="explicit intent"}
  const nonOutline=measured.used.filter(ref=>ref!==outlineRef),byFrequency=[...nonOutline].sort((a,b)=>(measured.frequency.get(b)??0)-(measured.frequency.get(a)??0));
  const shadow=nonOutline.slice(0,1),base=byFrequency.slice(0,1),highlight=nonOutline.slice(-1);
  const observedColors=measured.used.length;
  const observedOutline=rule(outline,outlineEvidence,outlineSource==="explicit"?1:.75,outlineSource);
  const explicitOutline=outlineSource==="explicit"?observedOutline:undefined;
  const resolvedOutline=mergeRule(explicitOutline,context?contextRule(context,"outline.mode",context.manifest.outline.mode):undefined,observedOutline);
  const observedRoles:PaletteRoles=inferSimpleRoles?inferredRoles:{outline:resolvedOutline.value==="none"||outlineRef===undefined?[]:[outlineRef],shadow,base,highlight};
  const paletteRoles=context?structuredClone(context.manifest.paletteRoles):observedRoles;
  const contextEvidence=context?`art context ${context.manifest.name}: paletteRoles`:"observed palette usage";
  const contextNegative=context?contextRule(context,"negativeConstraints",context.manifest.negativeConstraints):undefined;
  const technicalNegative=["no gradients","no blur",...(context?.manifest.clusters.antiAliasing||measured.antiAliasing?[]:["no soft anti-aliasing"]),"no subpixel detail","no unauthorized palette indices","no pixels outside the mask"];
  return {
    ...(context?{artContext:{name:context.manifest.name,version:context.manifest.version,locked:[...context.manifest.locked],references:context.references.map(({path,purpose,width,height})=>({path,purpose,width,height}))}}:{}),
    nativeSprite:{canvas:{width:snapshot.width,height:snapshot.height},contentBounds:rule(measured.contentBounds,crop?"non-transparent crop pixels":"crop unavailable",crop?.refs?.length?1:.2,"observed"),nativeHeight,nominalSize:rule(nominal,context?"midpoint of art-context native height":"observed native scale",context?1:.85,context?"context":"observed",nativeHeight.locked),detailBudget:rule(detail,`resolution rule for ${nominal}px`,1,"technical",true)},
    roster:{
      proportions:context?contextRule(context,"proportions",context.manifest.proportions):rule([],"no art context",.2,"default"),
      anatomy:context?contextRule(context,"anatomy",context.manifest.anatomy):rule([],"no art context",.2,"default"),
      priorityAccessories:context?contextRule(context,"priorityAccessories",context.manifest.priorityAccessories):rule([],"explicit intent supplies accessories",.5,"default"),
      styleNotes:context?contextRule(context,"styleNotes",context.manifest.styleNotes):rule([],"no art context",.2,"default")
    },
    pixelStyle:{
      outline:resolvedOutline,
      outlineThickness:mergeRule(undefined,context?contextRule(context,"outline.thickness",context.manifest.outline.thickness):undefined,rule(measured.outlineThickness||1,measured.outlineThickness>1?"solid 3x3 outline-color area observed":"single-pixel edge dominates",outline==="none"?.4:.7,outline==="none"?"default":"observed")),
      outlineTreatment:context?contextRule(context,"outline.treatment",context.manifest.outline.treatment):rule(outline==="black-continuous"?"black":"colored","observed outline color",.7,"observed"),
      clusterSize:context?contextRule(context,"clusters.size",context.manifest.clusters.size):rule({min:Math.max(1,Math.round(measured.clusterSize)),max:Math.max(1,Math.round(measured.clusterSize))},"median same-color connected component",crop?.refs?.length?.7:.2,"observed"),
      antiAliasing:context?contextRule(context,"clusters.antiAliasing",context.manifest.clusters.antiAliasing):rule(measured.antiAliasing,measured.antiAliasing?"repeated intermediate edge colors bridge outline and base":"no systematic intermediate edge-color transitions",crop?.refs?.length?.75:.3,"observed")
    },
    rendering:{
      shadesPerMaterial:context?contextRule(context,"shading.valuesPerMaterial",{min:context.manifest.shading.valuesPerMaterial[0],max:context.manifest.shading.valuesPerMaterial[1]}):rule({min:Math.min(3,Math.max(2,nonOutline.length)),max:Math.min(3,Math.max(2,nonOutline.length))},`${nonOutline.length} non-outline colors observed`,.65,"observed"),
      maxColors:simplePalette?rule(opaquePalette.length,"all opaque colors in simple palette",1,"technical",true):context?contextRule(context,"clusters.maxColors",context.manifest.clusters.maxColors):rule(Math.max(1,Math.min(opaquePalette.length,Math.max(3,observedColors+2))),"observed colors plus edit allowance",.7,"observed"),
      maxDensity:context?contextRule(context,"clusters.detailDensity",context.manifest.clusters.detailDensity.max):rule(Math.min(1,Math.max(.65,measured.density*1.5)),`observed opaque density ${measured.density.toFixed(2)}`,.65,"observed"),
      lightDirection:context?contextRule(context,"shading.light",context.manifest.shading.light):rule("unspecified","preserve observed light where readable",.4,"default"),
      shadingEdges:context?contextRule(context,"shading.edges",context.manifest.shading.edges):rule("hard","pixel-art default",.8,"default")
    },
    paletteRoles,
    paletteRolesMeta:{source:context?"context":"observed",locked:context?.manifest.locked.includes("paletteRoles")??false,evidence:contextEvidence},
    character:rule(intent,"explicit user subject, clothing, and accessories",1,"explicit"),
    pose:rule(intent,"explicit user pose/action; do not infer it from references",1,"explicit"),
    preserve:rule(["pixels outside the mask","canvas dimensions","snapshot token, frame, and target layer","native pixel grid"],"document authorization",1,"technical",true),
    negativeConstraints:rule([...technicalNegative,...(contextNegative?.value??[])],context?"technical constraints plus art context":"pixel and protocol constraints",1,"technical",true),
    priorities:["silhouette","proportions","pixel clusters","palette roles","details"]
  };
}

const maskEnabled=(spec:EditSpec,index:number)=>((Buffer.from(spec.mask.bits,"base64")[index>>3]??0)&(1<<(index&7)))!==0;
export function artDirectionErrors(candidate:Candidate,snapshot:Snapshot,spec:EditSpec,profile:ArtDirectionProfile):string[]{
  const errors:string[]=[];
  if(!sameRect(candidate.bounds,spec.mask.bounds))return ["artistic_bounds_changed"];
  const allowed=new Set(snapshot.palette.map(entry=>entry.index));
  if(candidate.paletteRefs.some(ref=>ref!==TRANSPARENT&&!allowed.has(ref)))errors.push("artistic_foreign_palette_color");
  const contextPalette=profile.artContext?new Set(Object.values(profile.paletteRoles).flat()):undefined;
  if(contextPalette&&candidate.paletteRefs.some(ref=>ref!==TRANSPARENT&&!contextPalette.has(ref)))errors.push("artistic_unauthorized_palette_index");
  if(candidate.paletteRefs.some((ref,i)=>!maskEnabled(spec,i)&&ref!==snapshot.crop?.paletteRefs?.[i]))errors.push("artistic_pixel_outside_mask");
  const used=new Set(candidate.paletteRefs.filter(ref=>ref!==TRANSPARENT));
  if(used.size>profile.rendering.maxColors.value)errors.push(`artistic_too_many_colors:${used.size}>${profile.rendering.maxColors.value}`);
  const density=candidate.paletteRefs.filter(ref=>ref!==TRANSPARENT).length/candidate.paletteRefs.length;
  if(density>profile.rendering.maxDensity.value+.05)errors.push(`artistic_density:${density.toFixed(2)}>${profile.rendering.maxDensity.value.toFixed(2)}`);
  const measured=measurements(candidate.bounds,candidate.paletteRefs,snapshot.palette);
  const contentHeight=measured.contentBounds?.height??0;
  if(profile.artContext&&(contentHeight<profile.nativeSprite.nativeHeight.value.min||contentHeight>profile.nativeSprite.nativeHeight.value.max))errors.push(`artistic_native_height:${contentHeight} not in ${profile.nativeSprite.nativeHeight.value.min}-${profile.nativeSprite.nativeHeight.value.max}`);
  const outline=new Set(profile.paletteRoles.outline);
  if(profile.pixelStyle.outlineThickness.value<=1&&outline.size){const w=candidate.bounds.width,h=candidate.bounds.height,p=candidate.paletteRefs;outer:for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(outline.has(p[i]!)&&[-w-1,-w,-w+1,-1,1,w-1,w,w+1].every(d=>outline.has(p[i+d]!))){errors.push("artistic_outline_thicker_than_1px");break outer}}}
  if((profile.pixelStyle.outline.value==="selective"||profile.pixelStyle.outline.value==="none")&&(measured.outline?.coverage??0)>=.72)errors.push("artistic_continuous_outline_forbidden");
  if(snapshot.palette.filter(entry=>(entry.rgba&255)>0).length>4&&!profile.pixelStyle.antiAliasing.value&&measured.antiAliasing)errors.push("artistic_soft_antialiasing_detected");
  return errors;
}

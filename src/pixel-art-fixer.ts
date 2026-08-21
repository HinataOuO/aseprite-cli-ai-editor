import { PNG } from "pngjs";
import { TRANSPARENT, type PaletteEntry } from "./protocol.js";

export const MAX_PNG_BYTES=8*1024*1024,MAX_PNG_DIMENSION=2048;
type RGB={r:number;g:number;b:number};
type Sample=RGB&{count:number};
type Family={samples:Sample[];count:number;kind:"hue"|"black"|"white"|"gray";hue?:number};
export type PaletteMode="auto"|"current"|"extract";
export interface FixPixelArtOptions {width:number;height:number;palette:PaletteEntry[];maxColors?:number;fit?:"contain"|"cover";paletteMode?:PaletteMode}
export interface FixedPixelArt {paletteRefs:number[];confidence:number[];palette?:PaletteEntry[]}

const invalid=(detail:string):never=>{throw new Error(`validation_failed: ${detail}`)};
const distance=(a:RGB,b:RGB)=>(a.r-b.r)**2+(a.g-b.g)**2+(a.b-b.b)**2;
const channels=(rgba:number):RGB=>({r:(rgba>>>24)&255,g:(rgba>>>16)&255,b:(rgba>>>8)&255});
const key=(color:RGB)=>`${color.r},${color.g},${color.b}`;
const rgba=(color:RGB)=>(((color.r*256+color.g)*256+color.b)*256+255)>>>0;
const lightness=(color:RGB)=>(Math.max(color.r,color.g,color.b)+Math.min(color.r,color.g,color.b))/510;
const hue=(color:RGB):number=>{
  const r=color.r/255,g=color.g/255,b=color.b/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  if(!delta)return 0;
  const value=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
  return (value*60+360)%360;
};
const hueDistance=(a:number,b:number)=>Math.min(Math.abs(a-b),360-Math.abs(a-b));

function decodePng(value:string):PNG{
  if(!value||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4!==0)invalid("preview PNG base64");
  const bytes=Buffer.from(value,"base64");
  if(bytes.length>MAX_PNG_BYTES||bytes.toString("base64")!==value)invalid("preview PNG base64");
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString("ascii",12,16)!=="IHDR")invalid("preview PNG header");
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>MAX_PNG_DIMENSION||height>MAX_PNG_DIMENSION)invalid("preview PNG dimensions");
  try{const png=PNG.sync.read(bytes,{checkCRC:true});if(png.width!==width||png.height!==height)invalid("preview PNG dimensions");return png}catch{return invalid("corrupt preview PNG")}
}

function weightedMedoid(samples:Sample[]):RGB{
  const total=samples.reduce((sum,color)=>sum+color.count,0),center={
    r:samples.reduce((sum,color)=>sum+color.r*color.count,0)/total,
    g:samples.reduce((sum,color)=>sum+color.g*color.count,0)/total,
    b:samples.reduce((sum,color)=>sum+color.b*color.count,0)/total
  };
  return [...samples].sort((a,b)=>distance(a,center)-distance(b,center)||b.count-a.count||a.r-b.r||a.g-b.g||a.b-b.b)[0]!;
}

function kind(color:RGB):Family["kind"]{
  const max=Math.max(color.r,color.g,color.b),min=Math.min(color.r,color.g,color.b),chroma=max-min;
  if(max<=40)return "black";
  if(min>=220&&chroma<=30)return "white";
  return chroma<=20?"gray":"hue";
}

function adaptiveColors(samples:Sample[],limit:number,splitLightness:boolean):RGB[]{
  const families:Family[]=[];
  for(const sample of [...samples].sort((a,b)=>b.count-a.count||a.r-b.r||a.g-b.g||a.b-b.b)){
    const sampleKind=kind(sample),sampleHue=hue(sample);
    let family=sampleKind==="hue"?[...families].filter(item=>item.kind==="hue"&&hueDistance(item.hue!,sampleHue)<=30).sort((a,b)=>hueDistance(a.hue!,sampleHue)-hueDistance(b.hue!,sampleHue)||b.count-a.count)[0]:families.find(item=>item.kind===sampleKind);
    if(!family){family={samples:[],count:0,kind:sampleKind,...(sampleKind==="hue"?{hue:sampleHue}:{})};families.push(family)}
    family.samples.push(sample);family.count+=sample.count;
    if(family.kind==="hue"){
      const x=family.samples.reduce((sum,color)=>sum+Math.cos(hue(color)*Math.PI/180)*color.count,0),y=family.samples.reduce((sum,color)=>sum+Math.sin(hue(color)*Math.PI/180)*color.count,0);
      family.hue=(Math.atan2(y,x)*180/Math.PI+360)%360;
    }
  }
  const total=samples.reduce((sum,color)=>sum+color.count,0),expanded:Family[]=[];
  for(const family of families){
    const sorted=[...family.samples].sort((a,b)=>lightness(a)-lightness(b)||a.r-b.r||a.g-b.g||a.b-b.b),range=lightness(sorted.at(-1)!)-lightness(sorted[0]!);
    let best=-1,bestGap=-1,left=0;
    if(splitLightness&&range>=.25)for(let i=0;i<sorted.length-1;i++){left+=sorted[i]!.count;const right=family.count-left,gap=lightness(sorted[i+1]!)-lightness(sorted[i]!);if(left>=total*.02&&right>=total*.02&&gap>bestGap){best=i+1;bestGap=gap}}
    if(best>0){for(const group of [sorted.slice(0,best),sorted.slice(best)])expanded.push({...family,samples:group,count:group.reduce((sum,color)=>sum+color.count,0)})}
    else expanded.push(family);
  }
  return [...expanded].sort((a,b)=>b.count-a.count||key(weightedMedoid(a.samples)).localeCompare(key(weightedMedoid(b.samples)))).slice(0,limit).map(family=>weightedMedoid(family.samples));
}

function removeBackground(colors:(RGB|null)[],width:number,height:number):void{
  const border:number[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||y===0||x===width-1||y===height-1)border.push(y*width+x);
  const counts=new Map<string,{color:RGB;count:number}>();
  for(const index of border){const color=colors[index];if(!color)continue;const id=key(color),found=counts.get(id);if(found)found.count++;else counts.set(id,{color,count:1})}
  const background=[...counts.values()].sort((a,b)=>b.count-a.count||key(a.color).localeCompare(key(b.color)))[0]?.color;
  if(!background)return;
  const compatible=(color:RGB|null|undefined)=>!!color&&Math.max(Math.abs(color.r-background.r),Math.abs(color.g-background.g),Math.abs(color.b-background.b))<=12;
  if(colors.every(color=>!color||compatible(color)))return;
  const removed=new Set<number>(),stack=border.filter(index=>compatible(colors[index]));for(const index of stack)removed.add(index);
  while(stack.length){const index=stack.pop()!,x=index%width,y=Math.floor(index/width);for(const next of [x?index-1:-1,x<width-1?index+1:-1,y?index-width:-1,y<height-1?index+width:-1])if(next>=0&&!removed.has(next)&&compatible(colors[next])){removed.add(next);stack.push(next)}}
  for(const index of removed)colors[index]=null;
}

const defaultBudget=(width:number,height:number)=>Math.max(width,height)<=16?4:Math.max(width,height)<=64?8:16;

export function fixPixelArt(pngBase64:string,{width,height,palette,maxColors,fit="cover",paletteMode="current"}:FixPixelArtOptions):FixedPixelArt{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||(maxColors!==undefined&&(!Number.isInteger(maxColors)||maxColors<1||maxColors>256))||!palette.length||!(["auto","current","extract"] as const).includes(paletteMode)||!(["contain","cover"] as const).includes(fit))invalid("fixer options");
  const png=decodePng(pngBase64),hasTransparency=png.data.some((value,index)=>index%4===3&&value<255);
  let cropX=0,cropY=0,cropWidth=png.width,cropHeight=png.height;
  if(fit==="cover"){
    if(png.width*height>png.height*width){cropWidth=Math.floor(png.height*width/height);cropX=Math.floor((png.width-cropWidth)/2)}
    else if(png.width*height<png.height*width){cropHeight=Math.floor(png.width*height/width);cropY=Math.floor((png.height-cropHeight)/2)}
    if(cropWidth<width||cropHeight<height)invalid("preview PNG ratio or resolution");
  }
  const containScale=Math.min(1,width/png.width,height/png.height),containWidth=Math.max(1,Math.min(width,Math.round(png.width*containScale))),containHeight=Math.max(1,Math.min(height,Math.round(png.height*containScale))),containX=Math.floor((width-containWidth)/2),containY=Math.floor((height-containHeight)/2);
  const sampled:(RGB|null)[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(fit==="contain"&&(x<containX||x>=containX+containWidth||y<containY||y>=containY+containHeight)){sampled.push(null);continue}
    const localX=fit==="cover"?x:x-containX,localY=fit==="cover"?y:y-containY,targetWidth=fit==="cover"?width:containWidth,targetHeight=fit==="cover"?height:containHeight;
    const sx=Math.min(png.width-1,(fit==="cover"?cropX:0)+Math.floor((localX+.5)*(fit==="cover"?cropWidth:png.width)/targetWidth));
    const sy=Math.min(png.height-1,(fit==="cover"?cropY:0)+Math.floor((localY+.5)*(fit==="cover"?cropHeight:png.height)/targetHeight)),i=(sy*png.width+sx)*4;
    sampled.push(png.data[i+3]!<128?null:{r:png.data[i]!,g:png.data[i+1]!,b:png.data[i+2]!});
  }
  if(!hasTransparency)removeBackground(sampled,width,height);
  const frequencies=new Map<string,Sample>();for(const color of sampled)if(color){const found=frequencies.get(key(color));if(found)found.count++;else frequencies.set(key(color),{...color,count:1})}
  const budget=maxColors??defaultBudget(width,height),colorLimit=budget-1;
  if(colorLimit===0&&frequencies.size)invalid("maxColors leaves no opaque palette entries");
  const representatives=adaptiveColors([...frequencies.values()],Math.min(colorLimit,frequencies.size),Math.max(width,height)>=128&&(maxColors===undefined||maxColors>8));
  const extracting=paletteMode!=="current",extracted=extracting?[{index:0,rgba:0},...representatives.map((color,index)=>({index:index+1,rgba:rgba(color)}))]:undefined,targetPalette=extracted??palette;
  const opaquePalette=targetPalette.filter(entry=>(entry.rgba&255)>=128);
  if(representatives.length&&!opaquePalette.length)invalid("opaque Aseprite palette missing");
  const selected=extracting?opaquePalette:[...new Map(representatives.map(color=>{const entry=[...opaquePalette].sort((a,b)=>distance(channels(a.rgba),color)-distance(channels(b.rgba),color)||a.index-b.index)[0]!;return [entry.index,entry]})).values()];
  const nearest=(color:RGB)=>[...selected].sort((a,b)=>distance(channels(a.rgba),color)-distance(channels(b.rgba),color)||a.index-b.index)[0]!.index;
  const paletteRefs=sampled.map(color=>color?nearest(color):TRANSPARENT);
  return {paletteRefs,confidence:Array(paletteRefs.length).fill(1),...(extracted?{palette:extracted}:{})};
}

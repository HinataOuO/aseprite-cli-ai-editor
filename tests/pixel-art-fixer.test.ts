import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { fixPixelArt } from "../src/pixel-art-fixer.js";

const palette=[{index:1,rgba:0xff0000ff},{index:2,rgba:0x00ff00ff},{index:3,rgba:0x0000ffff},{index:4,rgba:0xffffffff}];
const png=(width:number,height:number,pixel:(x:number,y:number)=>[number,number,number,number])=>{const image=new PNG({width,height});for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;image.data.set(pixel(x,y),i)}return PNG.sync.write(image).toString("base64")};

for(const size of [16,32,64,128])test(`512 preview maps onto ${size} logical grid`,()=>{
  const result=fixPixelArt(png(512,512,()=>[255,0,0,255]),{width:size,height:size,palette,maxColors:3});
  assert.equal(result.paletteRefs.length,size*size);assert.ok(result.paletteRefs.every(ref=>ref===1));
});

test("center sampling preserves one-pixel details at logical cell centers",()=>{
  const source=png(40,10,(x,y)=>x%10===5&&y===5?[255,0,0,255]:[0,255,0,255]);
  const result=fixPixelArt(source,{width:4,height:1,palette,maxColors:3});
  assert.deepEqual(result.paletteRefs,[1,1,1,1]);
});

test("contain centers source without upscaling",()=>{
  const source=png(2,4,(_x,y)=>y===0?[255,0,0,254]:y===3?[0,0,255,254]:[0,255,0,254]);
  assert.deepEqual(fixPixelArt(source,{width:4,height:4,palette,maxColors:4,fit:"contain"}).paletteRefs,[-1,1,1,-1,-1,2,2,-1,-1,2,2,-1,-1,3,3,-1]);
  assert.deepEqual(fixPixelArt(png(2,2,()=>[255,0,0,254]),{width:4,height:4,palette,maxColors:3,fit:"contain"}).paletteRefs,[-1,-1,-1,-1,-1,1,1,-1,-1,1,1,-1,-1,-1,-1,-1]);
});

test("opaque border-connected checkerboard is transparent but enclosed white survives",()=>{
  const source=png(8,8,(x,y)=>{
    if(x>=2&&x<=5&&y>=2&&y<=5)return x===3&&y===3?[255,255,255,255]:[255,0,0,255];
    return (x+y)%2?[250,250,250,255]:[240,240,240,255];
  });
  const result=fixPixelArt(source,{width:8,height:8,palette,maxColors:4,paletteMode:"extract"});
  assert.equal(result.paletteRefs[0],-1);assert.equal(result.paletteRefs[7],-1);assert.notEqual(result.paletteRefs[3*8+3],-1);
  assert.ok(result.palette?.some(entry=>entry.rgba===0xffffffff));
});

test("alpha is normalized at threshold 128",()=>{
  const source=png(2,1,x=>x?[255,0,0,128]:[255,0,0,127]);
  assert.deepEqual(fixPixelArt(source,{width:2,height:1,palette,maxColors:3}).paletteRefs,[-1,1]);
});

test("same-hue shades collapse through 64px and may split at 128px",()=>{
  const shades=Array.from({length:10},(_,i)=>[80+i*17,10,10,254] as [number,number,number,number]);
  const low=fixPixelArt(png(64,1,x=>shades[x%10]!),{width:64,height:1,palette,maxColors:8,paletteMode:"extract"});
  assert.equal(low.palette?.length,2);
  const high=fixPixelArt(png(128,1,x=>x===0?[0,0,0,0]:x<64?[70,0,0,255]:[230,30,30,255]),{width:128,height:1,palette,paletteMode:"extract"});
  assert.equal(high.palette?.length,3);
  assert.equal(fixPixelArt(png(128,1,x=>x===0?[0,0,0,0]:x<64?[70,0,0,255]:[230,30,30,255]),{width:128,height:1,palette,maxColors:16,paletteMode:"extract"}).palette?.length,3);
});

test("explicit low limits disable lightness split and include transparency",()=>{
  const source=png(128,1,x=>x===0?[0,0,0,0]:x<64?[70,0,0,255]:[230,30,30,255]);
  for(const maxColors of [4,8]){const result=fixPixelArt(source,{width:128,height:1,palette,maxColors,paletteMode:"extract"});assert.equal(result.palette?.length,2);assert.ok((result.palette?.length??999)<=maxColors)}
});

test("four chromatic families produce four representatives",()=>{
  const colors:[[number,number,number,number],[number,number,number,number],[number,number,number,number],[number,number,number,number]]=[[255,0,0,254],[255,255,0,254],[0,255,0,254],[0,0,255,254]];
  const result=fixPixelArt(png(40,1,x=>colors[Math.floor(x/10)]!),{width:40,height:1,palette,maxColors:8,paletteMode:"extract"});
  assert.equal(result.palette?.length,5);assert.equal(new Set(result.paletteRefs).size,4);
});

test("dynamic budgets and explicit budgets are total limits",()=>{
  const source=(size:number)=>png(size,1,x=>x===0?[0,0,0,0]:[(x*47)%256,(x*83)%256,(x*131)%256,255]);
  for(const [size,budget] of [[16,4],[32,8],[64,8],[128,16]] as const){const result=fixPixelArt(source(size),{width:size,height:1,palette,paletteMode:"extract"});assert.ok((result.palette?.length??999)<=budget)}
  assert.ok((fixPixelArt(source(128),{width:128,height:1,palette,maxColors:4,paletteMode:"extract"}).palette?.length??999)<=4);
});

test("fixer is deterministic",()=>{
  const source=png(64,8,(x,y)=>[(x*31)%256,(y*47)%256,((x+y)*19)%256,x===0&&y===0?0:255]),options={width:32,height:4,palette,paletteMode:"extract" as const};
  assert.deepEqual(fixPixelArt(source,options),fixPixelArt(source,options));
});

test("accepts 1254/1536 PNGs and rejects corrupt or dimensions above 2048",()=>{
  for(const size of [1254,1536])assert.equal(fixPixelArt(png(size,1,()=>[255,0,0,254]),{width:1,height:1,palette,maxColors:2}).paletteRefs[0],1);
  assert.throws(()=>fixPixelArt("not-base64",{width:1,height:1,palette,maxColors:2}),/validation_failed/);
  assert.throws(()=>fixPixelArt(png(2049,1,()=>[255,0,0,255]),{width:1,height:1,palette,maxColors:2}),/dimensions/);
  assert.throws(()=>fixPixelArt(png(4,1,()=>[255,0,0,255]),{width:1,height:4,palette,maxColors:2}),/ratio or resolution/);
});

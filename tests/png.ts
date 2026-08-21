import { PNG } from "pngjs";
import type { PaletteEntry } from "../src/protocol.js";

export function pngResult(refs:number[],width:number,height:number,palette:PaletteEntry[],scale=4):{pngBase64:string}{
  const colors=new Map(palette.map(entry=>[entry.index,entry.rgba]));const png=new PNG({width:width*scale,height:height*scale});
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const ref=refs[Math.floor(y/scale)*width+Math.floor(x/scale)]!,rgba=ref===-1?0:colors.get(ref);if(rgba===undefined)throw new Error(`missing test palette ref ${ref}`);const i=(y*png.width+x)*4;png.data[i]=(rgba>>>24)&255;png.data[i+1]=(rgba>>>16)&255;png.data[i+2]=(rgba>>>8)&255;png.data[i+3]=rgba&255}
  return {pngBase64:PNG.sync.write(png).toString("base64")};
}

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeServer, type ConnectionInfo } from "./bridge.js";
import { EditOrchestrator, type EditorOptions, type PreparedEdit } from "./editor.js";

export interface BridgeClient { request<T>(type:string,payload:unknown):Promise<T> }
interface McpBridge extends BridgeClient { getConnectionInfo():ConnectionInfo }

const rectSchema=z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()});
const maskSchema=z.object({bounds:rectSchema,bits:z.string()});
const paletteSchema=z.object({index:z.number().int().nonnegative(),rgba:z.number().int().nonnegative()});
const layerSchema=z.object({uuid:z.string(),imageId:z.number().int().nonnegative().nullable(),imageVersion:z.number().int().nonnegative().nullable(),editable:z.boolean()});
const cropSchema=z.object({bounds:rectSchema,pngBase64:z.string().optional(),paletteRefs:z.array(z.number().int().min(-1)).optional()});
const snapshotSchema=z.object({token:z.string(),spriteId:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive(),colorMode:z.enum(["indexed","rgb"]),frame:z.number().int().positive(),activeLayerUuid:z.string(),layers:z.array(layerSchema),palette:z.array(paletteSchema),transparentIndex:z.number().int().nonnegative().optional(),activeCelColorMode:z.enum(["indexed","rgb"]).optional(),documentEmpty:z.boolean(),usedRgba:z.array(z.number().int().positive()),selection:maskSchema,crop:cropSchema.optional()});
const preparedSchema={candidateId:z.string().uuid(),bounds:rectSchema,changedPixels:z.number().int().nonnegative(),candidateHash:z.string(),expiresAt:z.string(),instructions:z.string(),palette:z.array(paletteSchema).optional()};
const commitSchema={applied:z.number().int().nonnegative(),token:z.string(),candidateHash:z.string(),layerUuid:z.string()};
const connectionSchema={host:z.literal("127.0.0.1"),port:z.number().int().min(1).max(65535),nonce:z.string(),status:z.enum(["awaiting_pairing","connected","disconnected"])};
const metadata=(prepared:PreparedEdit)=>{const {previewPngBase64,...value}=prepared;return value};
const textResult=(value:Record<string,unknown>)=>({content:[{type:"text" as const,text:JSON.stringify(value)}],structuredContent:value});
const previewResult=(prepared:PreparedEdit)=>{const value=metadata(prepared);return {content:[{type:"image" as const,data:prepared.previewPngBase64,mimeType:"image/png"},{type:"text" as const,text:JSON.stringify(value)}],structuredContent:value}};

export function createMcpServer(bridge:McpBridge,options:EditorOptions={}):McpServer{
  const server=new McpServer({name:"aseprite-cli-ai-editor",version:"0.1.0"},{instructions:"An active Aseprite selection is required. inspect_aseprite_selection and prepare_* never modify the document. prepare_* return a PNG preview: show it to the user and obtain explicit approval before calling commit_edit. paletteMode='auto' uses a source palette when compatible and the current palette otherwise. commit_edit creates one new layer and must only be called with the approved candidateId."});
  const editor=new EditOrchestrator(bridge,5*60_000,undefined,options);
  let activeOperations=0,processingStarted=Promise.resolve();
  const notify=async(processing:boolean):Promise<void>=>{try{await bridge.request("set_processing",{processing})}catch{}};
  const operation=async<T>(run:()=>Promise<T>):Promise<T>=>{if(++activeOperations===1)processingStarted=notify(true);await processingStarted;try{return await run()}finally{if(--activeOperations===0)await notify(false)}};

  server.registerTool("get_connection_info",{
    title:"Get Aseprite Connection Info",
    description:"Get the local Aseprite bridge endpoint, pairing nonce, and current connection status without contacting Aseprite.",
    inputSchema:{},outputSchema:connectionSchema,
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>textResult({...bridge.getConnectionInfo()}));

  server.registerTool("inspect_aseprite_selection",{
    title:"Inspect Aseprite Selection",
    description:"Inspect the selected Aseprite area, active frame and layer, palette, and optional crop without changing the document.",
    inputSchema:{includeCrop:z.boolean().optional().describe("Include selected pixels as PNG/palette references; defaults to false")},outputSchema:snapshotSchema,
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },input=>operation(async()=>textResult(await editor.inspect(input.includeCrop??false) as unknown as Record<string,unknown>)));

  server.registerTool("prepare_image_import",{
    title:"Prepare Image Import",
    description:"Fit a trusted local PNG into the current selection and return a preview. Adaptive source palette is used by default when compatible. Does not modify Aseprite.",
    inputSchema:{imagePath:z.string().min(1),fit:z.enum(["contain","cover"]).optional().describe("Defaults to contain"),intent:z.string().min(1).optional(),paletteMode:z.enum(["auto","current","extract"]).optional().describe("Defaults to auto"),maxColors:z.number().int().min(1).max(256).optional().describe("Total palette limit including transparency; defaults by target size: 16px=4, 32/64px=8, 128px=16")},outputSchema:preparedSchema,
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  },input=>operation(async()=>previewResult(await editor.prepareImageImport(input.imagePath,input.fit??"contain",input.intent,input.paletteMode??"auto",input.maxColors))));

  server.registerTool("prepare_prompt_generation",{
    title:"Prepare Prompt Generation",
    description:"Generate one PNG with OpenAI for the current selection and return a preview. Adaptive source palette is used by default when compatible. Does not modify Aseprite.",
    inputSchema:{prompt:z.string().min(1),fit:z.enum(["contain","cover"]).optional().describe("Defaults to contain"),paletteMode:z.enum(["auto","current","extract"]).optional().describe("Defaults to auto"),maxColors:z.number().int().min(1).max(256).optional().describe("Total palette limit including transparency; defaults by target size: 16px=4, 32/64px=8, 128px=16")},outputSchema:preparedSchema,
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:true}
  },input=>operation(async()=>previewResult(await editor.preparePromptGeneration(input.prompt,input.fit??"contain",input.paletteMode??"auto",input.maxColors))));

  server.registerTool("commit_edit",{
    title:"Commit Approved Edit",
    description:"After explicit user approval, revalidate the prepared candidate and atomically create its new Aseprite layer in one Undo-safe transaction.",
    inputSchema:{candidateId:z.string().uuid()},outputSchema:commitSchema,
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
  },input=>operation(async()=>textResult(await editor.commit(input.candidateId))));
  return server;
}

export async function main():Promise<void>{
  const bridge=new BridgeServer(Number(process.env.AI_EDITOR_PORT??32123)),port=await bridge.start(),server=createMcpServer(bridge),transport=new StdioServerTransport();
  const signals=["SIGTERM","SIGINT","SIGHUP"] as const;let shutdown!:()=>void;
  const requested=new Promise<void>(resolve=>{let done=false;shutdown=()=>{if(!done){done=true;resolve()}}});
  process.stdin.once("end",shutdown);process.stdin.once("close",shutdown);for(const signal of signals)process.once(signal,shutdown);transport.onclose=shutdown;
  console.error(`Aseprite bridge ready on 127.0.0.1:${port}; pairing nonce: ${bridge.nonce}`);
  try{await server.connect(transport);await requested}
  finally{try{await Promise.all([server.close(),bridge.close()])}finally{process.stdin.off("end",shutdown);process.stdin.off("close",shutdown);for(const signal of signals)process.off(signal,shutdown)}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1});

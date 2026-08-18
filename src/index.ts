import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeServer } from "./bridge.js";
import { EditOrchestrator } from "./editor.js";
import { OpenAICompatibleProvider, type Provider } from "./provider.js";
import { MAX_DIFF_PIXELS } from "./protocol.js";

export interface BridgeClient { request<T>(type: string, payload: unknown): Promise<T> }

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const unavailableProvider:Provider={model:"unconfigured",version:"0",generate:async()=>{throw new Error("provider_unavailable: configure AI_EDITOR_PROVIDER_URL and AI_EDITOR_MODEL")}};
const pixelChange=z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),paletteRef:z.number().int().min(-1)}).strict();
const pixelSpan=z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),length:z.number().int().min(1).max(MAX_DIFF_PIXELS),paletteRef:z.number().int().min(-1)}).strict().describe("Horizontal run; prefer spans for shapes and large areas");
const pixelDiff=z.object({snapshotToken:z.string().min(1),spriteId:z.number().int().nonnegative(),frame:z.number().int().min(1),layerUuid:z.string().min(1),changes:z.array(pixelChange).optional().describe("Legacy per-pixel changes"),spans:z.array(pixelSpan).optional().describe("Compact horizontal runs, preferred for shapes and large areas"),createLayer:z.boolean().optional()}).strict().refine(diff=>diff.changes!==undefined||diff.spans!==undefined,"changes or spans required").refine(diff=>(diff.changes?.length ?? 0)+(diff.spans?.reduce((total,span)=>total+span.length,0) ?? 0)<=MAX_DIFF_PIXELS,`maximum ${MAX_DIFF_PIXELS} expanded pixels`);

export function createMcpServer(bridge: BridgeClient,provider:Provider=unavailableProvider): McpServer {
  const server = new McpServer({ name: "aseprite-cli-ai-editor", version: "0.1.0" });
  const editor=new EditOrchestrator(bridge,provider);
  let activeOperations=0,processingStarted=Promise.resolve();
  const notify=async(processing:boolean):Promise<void>=>{try{await bridge.request("set_processing",{processing});}catch{}}
  const operation=async<T>(run:()=>Promise<T>):Promise<T>=>{
    if(++activeOperations===1)processingStarted=notify(true);
    await processingStarted;
    try{return await run();}
    finally{if(--activeOperations===0)await notify(false);}
  };
  server.registerTool("prepare_edit", { description: "Generate and validate an edit preview that must be confirmed before commit", inputSchema: { intent: z.string().min(1), mode: z.enum(["edit_current","generate_new_layer"]) } }, input => operation(async()=>{
    const prepared=await editor.prepare(input.intent,input.mode);
    const {previewPngBase64,...metadata}=prepared;
    return {content:[{type:"image" as const,data:previewPngBase64,mimeType:"image/png"},{type:"text" as const,text:JSON.stringify(metadata)}],structuredContent:prepared as unknown as Record<string,unknown>};
  }));
  server.registerTool("commit_edit", { description: "Atomically apply one confirmed prepared edit", inputSchema: { candidateId: z.string().uuid() }, annotations:{destructiveHint:true,idempotentHint:false} }, input => operation(async()=>result(await editor.commit(input.candidateId))));
  server.registerTool("read_snapshot", { description: "Read the minimal authorized Aseprite state (diagnostic)", inputSchema: { includeCrop: z.boolean().default(true) } }, input => operation(async()=>result(await bridge.request("read_snapshot", input))));
  server.registerTool("confirm_mask", { description: "Show a proposed mask in Aseprite and return the corrected mask (diagnostic)", inputSchema: { snapshotToken: z.string(), mask: z.unknown() } }, input => operation(async()=>result(await bridge.request("confirm_mask", input))));
  server.registerTool("apply_diff", { description: "Atomically apply a validated palette diff; prefer spans for shapes and large areas (diagnostic)", inputSchema: { diff: pixelDiff }, annotations:{destructiveHint:true,idempotentHint:false} }, input => operation(async()=>result(await bridge.request("apply_diff", input))));
  return server;
}

export async function main(): Promise<void> {
  const bridge = new BridgeServer(Number(process.env.AI_EDITOR_PORT ?? 32123));
  const port = await bridge.start();
  console.error(`Aseprite bridge ready on 127.0.0.1:${port}; pairing nonce: ${bridge.nonce}`);
  const provider=process.env.AI_EDITOR_PROVIDER_URL&&process.env.AI_EDITOR_MODEL
    ? new OpenAICompatibleProvider({baseUrl:process.env.AI_EDITOR_PROVIDER_URL,model:process.env.AI_EDITOR_MODEL,...(process.env.AI_EDITOR_API_KEY?{apiKey:process.env.AI_EDITOR_API_KEY}:{}),...(process.env.AI_EDITOR_MODEL_VERSION?{version:process.env.AI_EDITOR_MODEL_VERSION}:{})})
    : unavailableProvider;
  await createMcpServer(bridge,provider).connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

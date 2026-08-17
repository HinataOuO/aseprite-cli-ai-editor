import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeServer } from "./bridge.js";

export interface BridgeClient { request<T>(type: string, payload: unknown): Promise<T> }

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });

export function createMcpServer(bridge: BridgeClient): McpServer {
  const server = new McpServer({ name: "aseprite-cli-ai-editor", version: "0.1.0" });
  server.registerTool("read_snapshot", { description: "Read the minimal authorized Aseprite state", inputSchema: { includeCrop: z.boolean().default(true) } }, async input => result(await bridge.request("read_snapshot", input)));
  server.registerTool("confirm_mask", { description: "Show a proposed mask in Aseprite and return the corrected mask", inputSchema: { snapshotToken: z.string(), mask: z.unknown() } }, async input => result(await bridge.request("confirm_mask", input)));
  server.registerTool("apply_diff", { description: "Atomically apply a validated palette diff", inputSchema: { diff: z.unknown() } }, async input => result(await bridge.request("apply_diff", input)));
  return server;
}

export async function main(): Promise<void> {
  const bridge = new BridgeServer(Number(process.env.AI_EDITOR_PORT ?? 32123));
  const port = await bridge.start();
  console.error(`Aseprite bridge ready on 127.0.0.1:${port}; pairing nonce: ${bridge.nonce}`);
  await createMcpServer(bridge).connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

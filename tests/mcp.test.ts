import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/index.js";

const compactDiff={snapshotToken:"t",spriteId:1,frame:1,layerUuid:"a",spans:[{x:0,y:0,length:4,paletteRef:1}]};

test("discovers orchestrated and diagnostic tools", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ request: async <T>(type: string, payload: unknown) => ({ type, payload }) as T });
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["apply_diff", "commit_edit", "confirm_mask", "prepare_edit", "read_snapshot"]);
  assert.match(JSON.stringify(tools.tools.find(tool=>tool.name==="apply_diff")?.inputSchema),/spans/);
  const response = await client.callTool({ name: "read_snapshot", arguments: { includeCrop: false } });
  assert.match(JSON.stringify(response), /read_snapshot/);
  const compact=await client.callTool({name:"apply_diff",arguments:{diff:compactDiff}});
  assert.match(JSON.stringify(compact),/spans/);
  await client.close(); await server.close();
});

test("reports processing around successful and failed MCP operations", async () => {
  const events: Array<[string, unknown]> = [];
  const bridge = { request: async <T>(type: string, payload: unknown) => {
    events.push([type, payload]);
    if (type === "apply_diff") throw new Error("apply_failed: test");
    return { type } as T;
  } };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(bridge);
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  await client.callTool({ name: "read_snapshot", arguments: { includeCrop: false } });
  assert.deepEqual(events, [
    ["set_processing", { processing: true }],
    ["read_snapshot", { includeCrop: false }],
    ["set_processing", { processing: false }],
  ]);

  events.length = 0;
  const failed = await client.callTool({ name: "apply_diff", arguments: { diff: compactDiff } });
  assert.equal(failed.isError, true);
  assert.deepEqual(events, [
    ["set_processing", { processing: true }],
    ["apply_diff", { diff: compactDiff }],
    ["set_processing", { processing: false }],
  ]);
  await client.close(); await server.close();
});

test("startup logs do not contaminate stdout", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...process.env, AI_EDITOR_PORT: "0" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  await Promise.race([new Promise<void>(resolve => child.stderr.on("data", () => resolve())),new Promise(resolve => setTimeout(resolve, 2000))]);
  child.kill();
  await new Promise(resolve => child.once("exit", resolve));
  assert.equal(stdout, "");
  assert.match(stderr, /pairing nonce/);
});

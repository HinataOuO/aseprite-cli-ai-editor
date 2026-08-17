import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/index.js";

test("discovers the three bridge tools", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ request: async <T>(type: string, payload: unknown) => ({ type, payload }) as T });
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["apply_diff", "confirm_mask", "read_snapshot"]);
  const response = await client.callTool({ name: "read_snapshot", arguments: { includeCrop: false } });
  assert.match(JSON.stringify(response), /read_snapshot/);
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

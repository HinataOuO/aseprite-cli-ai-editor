import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BridgeServer } from "../src/bridge.js";
import { createMcpServer } from "../src/index.js";

const snapshot={token:"t",spriteId:1,width:16,height:16,colorMode:"indexed",frame:1,activeLayerUuid:"a",layers:[{uuid:"a",imageId:1,imageVersion:1,editable:true}],palette:[{index:0,rgba:255}],documentEmpty:false,usedRgba:[255],selection:{bounds:{x:0,y:0,width:1,height:1},bits:"AQ=="}};
const within=<T>(promise:Promise<T>,ms=10_000)=>new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`timed out after ${ms}ms`)),ms);timer.unref();promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
const launchBridge=async(port=0)=>{
  const child=spawn(process.execPath,["--import","tsx","src/index.ts"],{env:{...process.env,AI_EDITOR_PORT:String(port)},stdio:["pipe","pipe","pipe"]});
  let stdout="",stderr="";
  child.stdout.on("data",data=>{stdout+=data;});
  const ready=new Promise<number>((resolve,reject)=>{
    child.stderr.on("data",data=>{stderr+=data;const match=/ready on 127\.0\.0\.1:(\d+); pairing nonce/.exec(stderr);if(match)resolve(Number(match[1]));});
    child.once("error",reject);
    child.once("exit",(code,signal)=>reject(new Error(`server exited before startup (${code??signal}): ${stderr}`)));
  });
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));
  return {child,port:await within(ready),exited,stdout:()=>stdout};
};

test("discovers exactly five purpose-oriented tools with schemas and annotations", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const events:string[]=[];
  const server = createMcpServer({ request: async <T>(type: string) => {events.push(type);return (type==="read_snapshot"?snapshot:{}) as T},getConnectionInfo:()=>({host:"127.0.0.1",port:45678,nonce:"secret",status:"awaiting_pairing"}) });
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),["commit_edit","get_connection_info","inspect_aseprite_selection","prepare_image_import","prepare_prompt_generation"]);
  for(const tool of tools.tools){assert.ok(tool.title);assert.ok(tool.outputSchema);assert.equal(typeof tool.annotations?.readOnlyHint,"boolean");assert.equal(typeof tool.annotations?.destructiveHint,"boolean");assert.equal(typeof tool.annotations?.idempotentHint,"boolean");assert.equal(typeof tool.annotations?.openWorldHint,"boolean")}
  assert.match(JSON.stringify(tools.tools.find(tool=>tool.name==="prepare_image_import")?.inputSchema),/imagePath/);
  assert.match(JSON.stringify(tools.tools.find(tool=>tool.name==="prepare_prompt_generation")?.inputSchema),/prompt/);
  for(const name of ["prepare_image_import","prepare_prompt_generation"]){const schema=JSON.stringify(tools.tools.find(tool=>tool.name===name)?.inputSchema);assert.match(schema,/paletteMode/);assert.match(schema,/auto/);assert.match(schema,/maxColors/);assert.match(schema,/128px=16/)}
  const connectionTool=tools.tools.find(tool=>tool.name==="get_connection_info");
  assert.deepEqual(connectionTool?.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  assert.match(JSON.stringify(connectionTool?.outputSchema),/awaiting_pairing/);
  const connection=await client.callTool({name:"get_connection_info",arguments:{}});
  assert.match(JSON.stringify(connection),/45678/);assert.deepEqual(events,[]);
  const response=await client.callTool({name:"inspect_aseprite_selection",arguments:{includeCrop:false}});
  assert.equal(response.isError,undefined);assert.match(JSON.stringify(response),/activeLayerUuid/);
  await client.close(); await server.close();
});

test("returns the dynamic bridge port before pairing", async t => {
  const bridge=new BridgeServer(0,"secret"),port=await bridge.start();t.after(()=>bridge.close());
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(),server=createMcpServer(bridge),client=new Client({name:"test",version:"1"});
  await Promise.all([server.connect(serverTransport),client.connect(clientTransport)]);
  const response=await client.callTool({name:"get_connection_info",arguments:{}});
  assert.deepEqual(response.structuredContent,{host:"127.0.0.1",port,nonce:"secret",status:"awaiting_pairing"});
  await client.close();await server.close();
});

test("reports processing around successful and failed MCP operations", async () => {
  const events: Array<[string, unknown]> = [];
  let fail=false;
  const bridge = { getConnectionInfo:()=>({host:"127.0.0.1" as const,port:32123,nonce:"secret",status:"awaiting_pairing" as const}),request: async <T>(type: string, payload: unknown) => {
    events.push([type, payload]);
    if(type==="read_snapshot"){if(fail)throw new Error("disconnected");return snapshot as T}
    return {} as T;
  } };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(bridge);
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  await client.callTool({name:"inspect_aseprite_selection",arguments:{includeCrop:false}});
  assert.deepEqual(events, [
    ["set_processing", { processing: true }],
    ["read_snapshot", { includeCrop: false }],
    ["set_processing", { processing: false }],
  ]);

  events.length = 0;
  fail=true;
  const failed=await client.callTool({name:"inspect_aseprite_selection",arguments:{includeCrop:false}});
  assert.equal(failed.isError, true);
  assert.deepEqual(events, [
    ["set_processing", { processing: true }],
    ["read_snapshot", { includeCrop: false }],
    ["set_processing", { processing: false }],
  ]);
  await client.close(); await server.close();
});

test("stdin EOF shuts down the process and releases the bridge port", async t => {
  const children=new Set<ReturnType<typeof spawn>>();
  t.after(()=>{for(const child of children)child.kill();});
  const first=await launchBridge(); children.add(first.child);
  first.child.stdin.end();
  assert.deepEqual(await within(first.exited),{code:0,signal:null});
  assert.equal(first.stdout(),"");
  children.delete(first.child);

  const second=await launchBridge(first.port); children.add(second.child);
  assert.equal(second.port,first.port);
  second.child.stdin.end();
  assert.deepEqual(await within(second.exited),{code:0,signal:null});
  assert.equal(second.stdout(),"");
});

test("signals shut down the process cleanly", async t=>{
  const children=new Set<ReturnType<typeof spawn>>();
  t.after(()=>{for(const child of children)child.kill();});
  for(const signal of ["SIGTERM","SIGINT","SIGHUP"] as const){
    const running=await launchBridge(); children.add(running.child);
    assert.equal(running.child.kill(signal),true);
    assert.deepEqual(await within(running.exited),{code:0,signal:null});
    assert.equal(running.stdout(),"");
    children.delete(running.child);
  }
});

test("two bridges can start concurrently on dynamic ports", async t=>{
  const children=new Set<ReturnType<typeof spawn>>();
  t.after(()=>{for(const child of children)child.kill();});
  const [first,second]=await Promise.all([launchBridge(),launchBridge()]);
  children.add(first.child); children.add(second.child);
  assert.notEqual(first.port,second.port);
  first.child.stdin.end(); second.child.stdin.end();
  assert.deepEqual(await within(Promise.all([first.exited,second.exited])),[{code:0,signal:null},{code:0,signal:null}]);
  assert.equal(first.stdout()+second.stdout(),"");
});

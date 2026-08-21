import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { BridgeServer } from "../src/bridge.js";
import { MAX_PAYLOAD_BYTES, PROTOCOL_VERSION } from "../src/protocol.js";

const pair = (nonce: string, id = "pair") => JSON.stringify({ version: PROTOCOL_VERSION, id, type: "pair", payload: { nonce, capabilities: { asepriteVersion: "1.3.0", protocolVersion: PROTOCOL_VERSION, methods: ["read_snapshot", "confirm_mask", "apply_diff"] } } });
const open = (url: string) => new Promise<WebSocket>((resolve, reject) => { const ws = new WebSocket(url); ws.once("open", () => resolve(ws)); ws.once("error", reject); });
const message = (ws: WebSocket) => new Promise<string>(resolve => ws.once("message", data => resolve(data.toString())));
const closed = (ws: WebSocket) => new Promise<number>(resolve => ws.once("close", resolve));

test("reports dynamic endpoint and pairing lifecycle", async () => {
  const bridge = new BridgeServer(0, "secret");
  const port = await bridge.start();
  assert.ok(port > 0);
  assert.deepEqual(bridge.getConnectionInfo(), { host: "127.0.0.1", port, nonce: "secret", status: "awaiting_pairing" });
  const ws = await open(`ws://127.0.0.1:${port}`);
  ws.send(pair("secret")); await message(ws);
  assert.equal(bridge.getConnectionInfo().status, "connected");
  const disconnected = closed(ws); ws.close(); await disconnected;
  assert.equal(bridge.getConnectionInfo().status, "disconnected");
  await bridge.close();
});

test("pairs and correlates requests", async () => {
  const bridge = new BridgeServer(0, "secret", 100);
  const port = await bridge.start();
  const ws = await open(`ws://127.0.0.1:${port}`);
  ws.send(pair("secret"));
  assert.equal(JSON.parse(await message(ws)).ok, true);
  ws.once("message", raw => { const request = JSON.parse(raw.toString()); ws.send(JSON.stringify({ version: PROTOCOL_VERSION, id: request.id, ok: true, payload: { value: 7 } })); });
  assert.deepEqual(await bridge.request("read_snapshot", {}), { value: 7 });
  await bridge.close();
});

test("close disconnects clients, rejects pending requests and releases the port", async () => {
  const bridge = new BridgeServer(0, "secret");
  const port = await bridge.start();
  const ws = await open(`ws://127.0.0.1:${port}`);
  ws.send(pair("secret")); await message(ws);
  const pending = assert.rejects(bridge.request("never", {}), /disconnected/);
  const disconnected = closed(ws);
  await Promise.all([bridge.close(), pending, disconnected]);
  await bridge.close();
  const replacement = new BridgeServer(port);
  assert.equal(await replacement.start(), port);
  await replacement.close();
});

test("rejects wrong nonce and replay", async () => {
  const bridge = new BridgeServer(0, "secret");
  const port = await bridge.start();
  const wrong = await open(`ws://127.0.0.1:${port}`);
  wrong.send(pair("wrong"));
  assert.equal(await closed(wrong), 1008);
  const valid = await open(`ws://127.0.0.1:${port}`);
  valid.send(pair("secret")); await message(valid);
  valid.send(pair("secret", "again"));
  assert.equal(await closed(valid), 1008);
  await bridge.close();
});

test("times out, disconnects and limits payload", async () => {
  const bridge = new BridgeServer(0, "secret", 20);
  const port = await bridge.start();
  const ws = await open(`ws://127.0.0.1:${port}`);
  ws.send(pair("secret")); await message(ws);
  await assert.rejects(bridge.request("never", {}), /timeout/);
  await assert.rejects(bridge.request("large", { data: "x".repeat(MAX_PAYLOAD_BYTES) }), /payload_too_large/);
  ws.close(); await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(bridge.request("gone", {}), /disconnected/);
  await bridge.close();
});

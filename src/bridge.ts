import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { MAX_PAYLOAD_BYTES, PROTOCOL_VERSION, type Capabilities, type ProtocolError, type Request, type Response, validateEnvelope } from "./protocol.js";

interface Pending { resolve(value: unknown): void; reject(reason: Error): void; timer: NodeJS.Timeout; type:string; requestBytes:number; started:number }

export interface ConnectionInfo {
  host: "127.0.0.1";
  port: number;
  nonce: string;
  status: "awaiting_pairing" | "connected" | "disconnected";
}

export class BridgeServer {
  readonly nonce: string;
  private server: WebSocketServer | undefined;
  private socket: WebSocket | undefined;
  private paired = false;
  private usedNonce = false;
  private boundPort: number | undefined;
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();
  capabilities?: Capabilities;
  private closing: Promise<void> | undefined;

  constructor(private readonly port = 32123, nonce?: string, private readonly timeoutMs = 10_000) {
    this.nonce = nonce ?? randomBytes(24).toString("base64url");
  }

  async start(): Promise<number> {
    if (this.server) throw new Error("bridge already started");
    this.server = new WebSocketServer({ host: "127.0.0.1", port: this.port, maxPayload: MAX_PAYLOAD_BYTES });
    this.server.on("connection", socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => { this.server!.once("listening", resolve); this.server!.once("error", reject); });
    this.boundPort = (this.server.address() as { port: number }).port;
    return this.boundPort;
  }

  getConnectionInfo(): ConnectionInfo {
    if (this.boundPort === undefined) throw new Error("bridge not started");
    return { host: "127.0.0.1", port: this.boundPort, nonce: this.nonce, status: this.paired ? "connected" : this.usedNonce ? "disconnected" : "awaiting_pairing" };
  }

  private accept(socket: WebSocket): void {
    if (this.socket) { socket.close(1008, "one plugin only"); return; }
    this.socket = socket;
    socket.on("message", data => this.receive(data.toString()));
    socket.on("close", () => {
      this.socket = undefined; this.paired = false;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("disconnected")); }
      this.pending.clear();
    });
  }

  private receive(raw: string): void {
    let message: Request | Response;
    try { message = validateEnvelope(raw); }
    catch { this.socket?.close(1008, "invalid message"); return; }
    if (!this.paired) {
      const pair = message as Request<{ nonce?: unknown; capabilities?: Capabilities }>;
      const nonce = pair.payload?.nonce;
      const capabilities = pair.payload?.capabilities;
      const supplied = typeof nonce === "string" ? Buffer.from(nonce) : Buffer.alloc(0);
      const expected = Buffer.from(this.nonce);
      const required: Capabilities["methods"] = ["read_snapshot", "confirm_mask", "apply_diff"];
      const version = /^(\d+)\.(\d+)/.exec(capabilities?.asepriteVersion ?? "");
      const supportedVersion = !!version && (Number(version[1]) > 1 || Number(version[1]) === 1 && Number(version[2]) >= 3);
      if (!("type" in message) || message.type !== "pair" || this.usedNonce || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
        || !supportedVersion || capabilities?.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(capabilities.methods) || required.some(method => !capabilities.methods.includes(method))) {
        this.socket?.close(1008, "pairing failed"); return;
      }
      this.usedNonce = true; this.paired = true;
      this.capabilities = capabilities;
      this.socket?.send(JSON.stringify({ version: PROTOCOL_VERSION, id: message.id, ok: true, payload: {} } satisfies Response));
      return;
    }
    if ("type" in message && message.type === "pair") { this.socket?.close(1008, "nonce replay"); return; }
    const pending = this.pending.get(message.id);
    if (!pending || !("ok" in message)) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    console.error(JSON.stringify({component:"bridge",method:pending.type,durationMs:Math.round((performance.now()-pending.started)*100)/100,requestBytes:pending.requestBytes,responseBytes:Buffer.byteLength(raw)}));
    if (message.ok) pending.resolve(message.payload);
    else pending.reject(Object.assign(new Error(message.error?.message ?? "bridge error"), { protocolError: message.error }));
  }

  request<T>(type: string, payload: unknown): Promise<T> {
    if (!this.paired || !this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("disconnected"));
    const id = String(++this.sequence);
    const message = JSON.stringify({ version: PROTOCOL_VERSION, id, type, payload } satisfies Request);
    if (Buffer.byteLength(message) > MAX_PAYLOAD_BYTES) return Promise.reject(new Error("payload_too_large"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("timeout")); }, this.timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, type, requestBytes:Buffer.byteLength(message), started:performance.now() });
      this.socket!.send(message, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    const server = this.server;
    this.server = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.paired = false;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("disconnected")); }
    this.pending.clear();
    socket?.terminate();
    if (!server) return;
    this.closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      .finally(() => { this.closing = undefined; });
    return this.closing;
  }
}

export function bridgeError(code: ProtocolError["code"], message: string, retryable = false): ProtocolError {
  return { code, message, retryable };
}

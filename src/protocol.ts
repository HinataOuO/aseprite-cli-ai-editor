export const PROTOCOL_VERSION = "1.0" as const;
export const MAX_PAYLOAD_BYTES = 1024 * 1024;
export const SUPPORTED_SIZES = [16, 32, 64] as const;
export const TRANSPARENT = -1 as const;

export type ColorMode = "indexed" | "rgb";
export const ERROR_CODES = ["invalid_message","incompatible_version","payload_too_large","pairing_failed","timeout","disconnected","unsupported_document","stale_snapshot","unauthorized_change","provider_unavailable","validation_failed","confirmation_required","attempts_exhausted","apply_failed"] as const;
export type ErrorCode = typeof ERROR_CODES[number];

export interface ProtocolError { code: ErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Mask { bounds: Rect; bits: string }
export interface PaletteEntry { index: number; rgba: number }
export interface LayerState { uuid: string; imageId: number | null; imageVersion: number | null; editable: boolean }
export interface Snapshot {
  token: string;
  spriteId: number;
  width: 16 | 32 | 64;
  height: 16 | 32 | 64;
  colorMode: ColorMode;
  frame: number;
  activeLayerUuid: string;
  layers: LayerState[];
  palette: PaletteEntry[];
  transparentIndex?: number;
  selection?: Mask;
  crop?: { bounds: Rect; pngBase64?: string; paletteRefs?: number[] };
}
export interface Capabilities { asepriteVersion: string; protocolVersion: typeof PROTOCOL_VERSION; methods: ("read_snapshot" | "confirm_mask" | "apply_diff")[] }
export interface PairMessage { version: typeof PROTOCOL_VERSION; id: string; type: "pair"; payload: { nonce: string; capabilities: Capabilities } }
export interface Request<T = unknown> { version: typeof PROTOCOL_VERSION; id: string; type: string; payload: T }
export interface Response<T = unknown> { version: typeof PROTOCOL_VERSION; id: string; ok: boolean; payload?: T; error?: ProtocolError }
export interface EditSpec {
  intent: string;
  snapshotToken: string;
  frame: number;
  layerUuids: string[];
  mask: Mask;
  semanticRequirements: string[];
  confirmationRequired: boolean;
}
export interface Candidate { snapshotToken: string; bounds: Rect; paletteRefs: number[] }
export interface PixelChange { x: number; y: number; paletteRef: number }
export interface PixelDiff { snapshotToken: string; spriteId: number; frame: number; layerUuid: string; changes: PixelChange[] }

export class ProtocolValidationError extends Error {
  constructor(public readonly error: ProtocolError) { super(error.message); }
}

const fail = (message: string, code: ErrorCode = "invalid_message"): never => {
  throw new ProtocolValidationError({ code, message, retryable: false });
};
const object = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
};
const integer = (value: unknown, name: string, min = 0): number => {
  if (!Number.isInteger(value) || (value as number) < min) fail(`${name} must be an integer >= ${min}`);
  return value as number;
};
const text = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  return value as string;
};

export function validateRect(value: unknown, name = "rect"): Rect {
  const v = object(value, name);
  return { x: integer(v.x, `${name}.x`), y: integer(v.y, `${name}.y`), width: integer(v.width, `${name}.width`, 1), height: integer(v.height, `${name}.height`, 1) };
}

export function validateMask(value: unknown): Mask {
  const v = object(value, "mask");
  const bounds = validateRect(v.bounds, "mask.bounds");
  const bits = text(v.bits, "mask.bits");
  const bytes = Buffer.from(bits, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== bits.replace(/=+$/, "")) fail("mask.bits must be canonical base64");
  const count = bounds.width * bounds.height;
  if (bytes.length !== Math.ceil(count / 8)) fail("mask bit length does not match bounds");
  const remainder = count % 8;
  if (remainder && ((bytes.at(-1) ?? 0) >> remainder) !== 0) fail("mask padding bits must be zero");
  return { bounds, bits };
}

export function validateEnvelope(value: unknown): Request | Response {
  const bytes = Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) ?? "");
  if (bytes > MAX_PAYLOAD_BYTES) fail("message exceeds 1 MiB", "payload_too_large");
  let parsed: unknown = value;
  if (typeof value === "string") try { parsed = JSON.parse(value); } catch { fail("message is not valid JSON"); }
  const v = object(parsed, "message");
  if (v.version !== PROTOCOL_VERSION) fail("unsupported protocol version", "incompatible_version");
  const id = text(v.id, "id");
  if (typeof v.ok === "boolean") {
    let error: ProtocolError | undefined;
    if (v.ok === false) {
      const e = object(v.error, "error");
      if (!ERROR_CODES.includes(e.code as ErrorCode) || typeof e.retryable !== "boolean") fail("response error is invalid");
      error = { code:e.code as ErrorCode,message:text(e.message,"error.message"),retryable:e.retryable as boolean,...(e.details && typeof e.details==="object" && !Array.isArray(e.details)?{details:e.details as Record<string,unknown>}:{}) };
    }
    return { version: PROTOCOL_VERSION, id, ok: v.ok, ...(v.payload === undefined ? {} : { payload: v.payload }), ...(error === undefined ? {} : { error }) };
  }
  return { version: PROTOCOL_VERSION, id, type: text(v.type, "type"), payload: v.payload };
}

export function validateRequest(value: unknown): Request {
  const message = validateEnvelope(value);
  if ("ok" in message) fail("expected request");
  return message as Request;
}

export function validateSnapshot(value: unknown): Snapshot {
  const v = object(value, "snapshot");
  const width = integer(v.width, "width");
  const height = integer(v.height, "height");
  if (!SUPPORTED_SIZES.includes(width as 16) || !SUPPORTED_SIZES.includes(height as 16)) fail("unsupported dimensions", "unsupported_document");
  if (v.colorMode !== "indexed" && v.colorMode !== "rgb") fail("unsupported color mode", "unsupported_document");
  const colorMode = v.colorMode as ColorMode;
  if (!Array.isArray(v.layers) || !Array.isArray(v.palette) || v.layers.length === 0 || v.palette.length === 0) fail("layers and palette are required");
  const layerValues = v.layers as unknown[], paletteValues = v.palette as unknown[];
  const layers = layerValues.map((item, i) => {
    const layer = object(item, `layers[${i}]`);
    return { uuid: text(layer.uuid, `layers[${i}].uuid`), imageId: layer.imageId === null ? null : integer(layer.imageId, "imageId"), imageVersion: layer.imageVersion === null ? null : integer(layer.imageVersion, "imageVersion"), editable: layer.editable === true };
  });
  const palette = paletteValues.map((item, i) => {
    const entry = object(item, `palette[${i}]`);
    return { index: integer(entry.index, "palette.index"), rgba: integer(entry.rgba, "palette.rgba") };
  });
  if (new Set(palette.map(({ index }) => index)).size !== palette.length) fail("palette indices must be unique");
  const snapshot: Snapshot = {
    token: text(v.token, "token"), spriteId: integer(v.spriteId, "spriteId"), width: width as Snapshot["width"], height: height as Snapshot["height"],
    colorMode, frame: integer(v.frame, "frame", 1), activeLayerUuid: text(v.activeLayerUuid, "activeLayerUuid"), layers, palette
  };
  if (v.transparentIndex !== undefined) snapshot.transparentIndex = integer(v.transparentIndex, "transparentIndex");
  if (v.selection !== undefined) snapshot.selection = validateMask(v.selection);
  if (v.crop !== undefined) {
    const crop = object(v.crop, "crop");
    const bounds = validateRect(crop.bounds, "crop.bounds");
    if (crop.pngBase64 === undefined && !Array.isArray(crop.paletteRefs)) fail("crop requires PNG or palette references");
    snapshot.crop = { bounds, ...(crop.pngBase64 === undefined ? {} : { pngBase64: text(crop.pngBase64, "crop.pngBase64") }), ...(Array.isArray(crop.paletteRefs) ? { paletteRefs: crop.paletteRefs.map((x, i) => integer(x, `crop.paletteRefs[${i}]`, -1)) } : {}) };
  }
  return snapshot;
}

export function validateCandidate(value: unknown): Candidate {
  const v = object(value, "candidate");
  const bounds = validateRect(v.bounds, "candidate.bounds");
  if (!Array.isArray(v.paletteRefs) || v.paletteRefs.length !== bounds.width * bounds.height || v.paletteRefs.some(x => !Number.isInteger(x) || x < TRANSPARENT)) fail("candidate paletteRefs do not match bounds");
  return { snapshotToken: text(v.snapshotToken, "snapshotToken"), bounds, paletteRefs: v.paletteRefs as number[] };
}

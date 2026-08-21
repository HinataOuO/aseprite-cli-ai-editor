export const PROTOCOL_VERSION = "1.0" as const;
export const MAX_PAYLOAD_BYTES = 1024 * 1024;
export const MAX_SPRITE_DIMENSION = 128;
export const MAX_DIFF_PIXELS = 16384;
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
  width: number;
  height: number;
  colorMode: ColorMode;
  frame: number;
  activeLayerUuid: string;
  layers: LayerState[];
  palette: PaletteEntry[];
  transparentIndex?: number;
  activeCelColorMode?: ColorMode;
  documentEmpty?: boolean;
  usedRgba?: number[];
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
export interface Candidate { snapshotToken: string; bounds: Rect; paletteRefs: number[]; palette?: PaletteEntry[] }
export interface PixelChange { x: number; y: number; paletteRef: number }
export interface PixelSpan { x: number; y: number; length: number; paletteRef: number }
export interface PixelDiff { snapshotToken: string; spriteId: number; frame: number; layerUuid: string; changes: PixelChange[]; spans?: PixelSpan[]; createLayer?: boolean; palette?: PaletteEntry[] }

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

function validatePalette(value:unknown,name="palette",sequential=false):PaletteEntry[]{
  if(!Array.isArray(value)||value.length<1||value.length>256)fail(`${name} must contain 1..256 entries`);
  const palette=(value as unknown[]).map((item,i)=>{
    const entry=object(item,`${name}[${i}]`);
    const index=integer(entry.index,`${name}[${i}].index`),rgba=integer(entry.rgba,`${name}[${i}].rgba`);
    if(rgba>0xffffffff)fail(`${name}[${i}].rgba must be <= 4294967295`);
    return {index,rgba};
  });
  if(new Set(palette.map(({index})=>index)).size!==palette.length)fail(`${name} indices must be unique`);
  if(sequential&&palette.some((entry,index)=>entry.index!==index||(index===0?(entry.rgba&255)!==0:(entry.rgba&255)===0)))fail(`${name} must be sequential with transparent index 0`);
  return palette;
}

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
  const width = integer(v.width, "width", 1);
  const height = integer(v.height, "height", 1);
  if (width > MAX_SPRITE_DIMENSION || height > MAX_SPRITE_DIMENSION || width * height > MAX_DIFF_PIXELS) fail("unsupported dimensions", "unsupported_document");
  if (v.colorMode !== "indexed" && v.colorMode !== "rgb") fail("unsupported color mode", "unsupported_document");
  const colorMode = v.colorMode as ColorMode;
  if (!Array.isArray(v.layers) || !Array.isArray(v.palette) || v.layers.length === 0 || v.palette.length === 0) fail("layers and palette are required");
  const layerValues = v.layers as unknown[];
  const layers = layerValues.map((item, i) => {
    const layer = object(item, `layers[${i}]`);
    return { uuid: text(layer.uuid, `layers[${i}].uuid`), imageId: layer.imageId === null ? null : integer(layer.imageId, "imageId"), imageVersion: layer.imageVersion === null ? null : integer(layer.imageVersion, "imageVersion"), editable: layer.editable === true };
  });
  const palette=validatePalette(v.palette);
  const snapshot: Snapshot = {
    token: text(v.token, "token"), spriteId: integer(v.spriteId, "spriteId"), width, height,
    colorMode, frame: integer(v.frame, "frame", 1), activeLayerUuid: text(v.activeLayerUuid, "activeLayerUuid"), layers, palette,
    documentEmpty:v.documentEmpty===true,
    ...(Array.isArray(v.usedRgba)?{usedRgba:(v.usedRgba as unknown[]).map((value,index)=>{const rgba=integer(value,`usedRgba[${index}]`,1);if(rgba>0xffffffff||(rgba&255)===0)fail(`usedRgba[${index}] must be opaque RGBA`);return rgba})}:{})
  };
  if(new Set(snapshot.usedRgba??[]).size!==(snapshot.usedRgba??[]).length)fail("usedRgba must contain unique colors");
  if (v.transparentIndex !== undefined) snapshot.transparentIndex = integer(v.transparentIndex, "transparentIndex");
  if (v.activeCelColorMode !== undefined) {
    if (v.activeCelColorMode !== "indexed" && v.activeCelColorMode !== "rgb") fail("unsupported cel color mode", "unsupported_document");
    snapshot.activeCelColorMode = v.activeCelColorMode as ColorMode;
  }
  if (v.selection !== undefined) {
    const selection=validateMask(v.selection),bounds=selection.bounds;
    if(bounds.x+bounds.width>width||bounds.y+bounds.height>height||bounds.width*bounds.height>MAX_DIFF_PIXELS)fail("selection exceeds document bounds","unsupported_document");
    snapshot.selection=selection;
  }
  if (v.crop !== undefined) {
    const crop = object(v.crop, "crop");
    const bounds = validateRect(crop.bounds, "crop.bounds");
    if(bounds.x+bounds.width>width||bounds.y+bounds.height>height||bounds.width*bounds.height>MAX_DIFF_PIXELS)fail("crop exceeds document bounds","unsupported_document");
    if (crop.pngBase64 === undefined && !Array.isArray(crop.paletteRefs)) fail("crop requires PNG or palette references");
    snapshot.crop = { bounds, ...(crop.pngBase64 === undefined ? {} : { pngBase64: text(crop.pngBase64, "crop.pngBase64") }), ...(Array.isArray(crop.paletteRefs) ? { paletteRefs: crop.paletteRefs.map((x, i) => integer(x, `crop.paletteRefs[${i}]`, -1)) } : {}) };
  }
  return snapshot;
}

export function validateCandidate(value: unknown): Candidate {
  const v = object(value, "candidate");
  const bounds = validateRect(v.bounds, "candidate.bounds");
  if (!Array.isArray(v.paletteRefs) || v.paletteRefs.length !== bounds.width * bounds.height || v.paletteRefs.some(x => !Number.isInteger(x) || x < TRANSPARENT)) fail("candidate paletteRefs do not match bounds");
  return { snapshotToken: text(v.snapshotToken, "snapshotToken"), bounds, paletteRefs: v.paletteRefs as number[], ...(v.palette===undefined?{}:{palette:validatePalette(v.palette,"candidate.palette",true)}) };
}

export const countDiffPixels=(diff:Pick<PixelDiff,"changes"|"spans">):number=>diff.changes.length+(diff.spans?.reduce((total,span)=>total+span.length,0)??0);

export function validatePixelDiff(value: unknown): PixelDiff {
  const v=object(value,"diff");
  if (v.changes===undefined && v.spans===undefined) fail("diff requires changes or spans");
  if (v.changes!==undefined && !Array.isArray(v.changes)) fail("diff.changes must be an array");
  if (v.spans!==undefined && !Array.isArray(v.spans)) fail("diff.spans must be an array");
  const changes=(v.changes as unknown[]|undefined)?.map((item,i)=>{
    const change=object(item,`diff.changes[${i}]`);
    return {x:integer(change.x,`diff.changes[${i}].x`),y:integer(change.y,`diff.changes[${i}].y`),paletteRef:integer(change.paletteRef,`diff.changes[${i}].paletteRef`,TRANSPARENT)};
  });
  const spans=(v.spans as unknown[]|undefined)?.map((item,i)=>{
    const span=object(item,`diff.spans[${i}]`);
    return {x:integer(span.x,`diff.spans[${i}].x`),y:integer(span.y,`diff.spans[${i}].y`),length:integer(span.length,`diff.spans[${i}].length`,1),paletteRef:integer(span.paletteRef,`diff.spans[${i}].paletteRef`,TRANSPARENT)};
  });
  const diff={snapshotToken:text(v.snapshotToken,"diff.snapshotToken"),spriteId:integer(v.spriteId,"diff.spriteId"),frame:integer(v.frame,"diff.frame",1),layerUuid:text(v.layerUuid,"diff.layerUuid"),changes:changes ?? [],...(spans?{spans}:{}),...(v.createLayer===true?{createLayer:true}:{}),...(v.palette===undefined?{}:{palette:validatePalette(v.palette,"diff.palette",true)})};
  if(countDiffPixels(diff)>MAX_DIFF_PIXELS)fail(`diff exceeds ${MAX_DIFF_PIXELS} expanded pixels`);
  return diff;
}

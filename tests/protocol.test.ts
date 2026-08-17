import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PAYLOAD_BYTES, PROTOCOL_VERSION, ProtocolValidationError, validateCandidate, validateMask, validateRequest, validateSnapshot } from "../src/protocol.js";

const mask = { bounds: { x: 0, y: 0, width: 2, height: 2 }, bits: "Dw==" };
const snapshot = {
  token: "abc", spriteId: 1, width: 32, height: 32, colorMode: "indexed", frame: 1,
  activeLayerUuid: "layer", layers: [{ uuid: "layer", imageId: 2, imageVersion: 3, editable: true }],
  palette: [{ index: 0, rgba: 0 }], transparentIndex: 0, selection: mask
};

test("protocol round-trip", () => {
  const request = { version: PROTOCOL_VERSION, id: "1", type: "read_snapshot", payload: snapshot };
  assert.deepEqual(validateRequest(JSON.stringify(request)), request);
  assert.deepEqual(validateSnapshot(request.payload), snapshot);
  assert.deepEqual(validateMask(mask), mask);
  assert.equal(validateCandidate({ snapshotToken: "abc", bounds: mask.bounds, paletteRefs: [0, -1, 0, 0] }).paletteRefs.length, 4);
});

test("rejects incompatible, missing and oversized messages", () => {
  for (const value of [
    { version: "2.0", id: "1", type: "x", payload: {} },
    { version: PROTOCOL_VERSION, type: "x", payload: {} },
    "x".repeat(MAX_PAYLOAD_BYTES + 1)
  ]) assert.throws(() => validateRequest(value), ProtocolValidationError);
});

test("rejects malformed exact masks and snapshots", () => {
  assert.throws(() => validateMask({ ...mask, bits: "AAE=" }));
  assert.throws(() => validateSnapshot({ ...snapshot, width: 17 }), /unsupported dimensions/);
  assert.throws(() => validateCandidate({ snapshotToken: "abc", bounds: mask.bounds, paletteRefs: [0] }));
});

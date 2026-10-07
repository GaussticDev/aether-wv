import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AETHER_MAGIC,
  AETHER_VERSION,
  HEADER_SIZE,
  FrameType,
  FrameFlags,
  encodeFrame,
  decodeFrame,
  BinaryWriter,
  BinaryReader,
} from '../packages/core/src/index.js';

describe('Aether Binary Protocol', () => {
  test('correctly serializes and deserializes fixed 16-byte header frames', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const frame = {
      type: FrameType.RPC_REQ,
      flags: FrameFlags.NONE,
      streamId: 42,
      sequenceId: 1001,
      payload,
    };

    const encoded = encodeFrame(frame);
    assert.equal(encoded.byteLength, HEADER_SIZE + payload.byteLength);

    const decoded = decodeFrame(encoded);
    assert.equal(decoded.type, FrameType.RPC_REQ);
    assert.equal(decoded.flags, FrameFlags.NONE);
    assert.equal(decoded.streamId, 42);
    assert.equal(decoded.sequenceId, 1001);
    assert.deepEqual(Array.from(decoded.payload), Array.from(payload));
  });

  test('rejects corrupted magic bytes', () => {
    const data = new Uint8Array(16);
    data[0] = 0xFF; // Bad magic
    assert.throws(() => decodeFrame(data), /Invalid magic byte/);
  });

  test('serializes and deserializes all data types without precision loss', () => {
    const w = new BinaryWriter();
    w.writeInt32(-12345);
    w.writeUint32(99999);
    w.writeFloat32(3.1415);
    w.writeFloat64(2.718281828459);
    w.writeBigInt64(1234567890123456789n);
    w.writeBoolean(true);
    w.writeString('Aether-WV Test String');
    w.writeBytes(new Uint8Array([0xAA, 0xBB, 0xCC]));

    const buffer = w.finish();
    const r = new BinaryReader(buffer);

    assert.equal(r.readInt32(), -12345);
    assert.equal(r.readUint32(), 99999);
    assert.ok(Math.abs(r.readFloat32() - 3.1415) < 0.001);
    assert.ok(Math.abs(r.readFloat64() - 2.718281828459) < 0.000000001);
    assert.equal(r.readBigInt64(), 1234567890123456789n);
    assert.equal(r.readBoolean(), true);
    assert.equal(r.readString(), 'Aether-WV Test String');
    assert.deepEqual(Array.from(r.readBytes()), [0xAA, 0xBB, 0xCC]);
    assert.equal(r.remaining, 0);
  });
});

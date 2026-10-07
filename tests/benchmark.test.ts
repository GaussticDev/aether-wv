import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeFrame,
  decodeFrame,
  FrameType,
  FrameFlags,
  BinaryWriter,
  BinaryReader,
} from '../packages/core/src/index.js';

describe('Aether vs JSON Benchmark', () => {
  test('benchmarks 10,000 binary frames vs JSON.stringify / JSON.parse', () => {
    const iterations = 10_000;

    // Sample payload data representing typical native sensor/transaction payload
    const testData = {
      timestamp: 1728329482910,
      deviceId: 'iphone-16-pro-max',
      sensorX: 0.12345,
      sensorY: -0.98765,
      sensorZ: 9.80665,
      status: 'ACTIVE',
      count: 42,
    };

    // 1. Benchmark Aether Binary Protocol
    const t0 = performance.now();
    let binaryTotalBytes = 0;

    for (let i = 0; i < iterations; i++) {
      // Serialize payload
      const w = new BinaryWriter();
      w.writeBigInt64(BigInt(testData.timestamp));
      w.writeString(testData.deviceId);
      w.writeFloat32(testData.sensorX);
      w.writeFloat32(testData.sensorY);
      w.writeFloat32(testData.sensorZ);
      w.writeString(testData.status);
      w.writeInt32(testData.count);
      const payload = w.finish();

      // Encode frame
      const frameBytes = encodeFrame({
        type: FrameType.STREAM_DATA,
        flags: FrameFlags.NONE,
        streamId: 1,
        sequenceId: i,
        payload,
      });
      binaryTotalBytes += frameBytes.byteLength;

      // Decode frame & read payload
      const decodedFrame = decodeFrame(frameBytes);
      const r = new BinaryReader(decodedFrame.payload);
      const ts = r.readBigInt64();
      const dev = r.readString();
      const sx = r.readFloat32();
      const sy = r.readFloat32();
      const sz = r.readFloat32();
      const st = r.readString();
      const cnt = r.readInt32();
    }
    const t1 = performance.now();
    const aetherDurationMs = t1 - t0;

    // 2. Benchmark Classic JSON Bridge
    const t2 = performance.now();
    let jsonTotalBytes = 0;

    for (let i = 0; i < iterations; i++) {
      const jsonString = JSON.stringify({
        action: 'sensor_stream',
        streamId: 1,
        sequenceId: i,
        data: testData,
      });
      jsonTotalBytes += jsonString.length;

      const parsed = JSON.parse(jsonString);
      const ts = parsed.data.timestamp;
      const dev = parsed.data.deviceId;
      const sx = parsed.data.sensorX;
      const sy = parsed.data.sensorY;
      const sz = parsed.data.sensorZ;
      const st = parsed.data.status;
      const cnt = parsed.data.count;
    }
    const t3 = performance.now();
    const jsonDurationMs = t3 - t2;

    const aetherThroughput = Math.round((iterations / aetherDurationMs) * 1000);
    const jsonThroughput = Math.round((iterations / jsonDurationMs) * 1000);
    const aetherAvgByte = Math.round(binaryTotalBytes / iterations);
    const jsonAvgByte = Math.round(jsonTotalBytes / iterations);

    console.log(`
=============================================================
         AETHER-WV vs JSON BRIDGE BENCHMARK (10,000 Ops)
=============================================================
* Aether Binary Frame:
  - Total Time: ${aetherDurationMs.toFixed(2)} ms
  - Throughput: ${aetherThroughput.toLocaleString()} ops/sec
  - Avg Wire Size: ${aetherAvgByte} bytes / frame
  - Avg Latency: ${( (aetherDurationMs / iterations) * 1000 ).toFixed(2)} µs / op

* Classic JSON Bridge (Capacitor / Cordova pattern):
  - Total Time: ${jsonDurationMs.toFixed(2)} ms
  - Throughput: ${jsonThroughput.toLocaleString()} ops/sec
  - Avg Wire Size: ${jsonAvgByte} bytes / frame
  - Avg Latency: ${( (jsonDurationMs / iterations) * 1000 ).toFixed(2)} µs / op

* Speedup: ${(jsonDurationMs / aetherDurationMs).toFixed(2)}x faster
* Wire Size Savings: ${((1 - aetherAvgByte / jsonAvgByte) * 100).toFixed(1)}% smaller
=============================================================
    `);

    assert.ok(aetherThroughput > 20_000, `Throughput should exceed 20k ops/sec, got ${aetherThroughput}`);
    assert.ok(aetherAvgByte < jsonAvgByte * 0.5, `Wire size should be at least 50% smaller, got ${aetherAvgByte} vs ${jsonAvgByte}`);
  });
});

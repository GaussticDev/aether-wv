import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryTransportPair } from '../packages/client/src/index.js';
import { AetherClient } from '../packages/client/src/index.js';
import { AetherNativeHost } from '../packages/native-host/src/index.js';
import { BinaryWriter, BinaryReader } from '../packages/core/src/index.js';

describe('Aether Reactive Streaming with Backpressure', () => {
  test('streams multiple frames from native to client with flow control', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    const totalFrames = 15;

    host.registerStream('SensorService', 'StreamData', async (reqBytes, emitter) => {
      for (let i = 1; i <= totalFrames; i++) {
        const payload = new BinaryWriter().writeInt32(i).finish();
        await emitter.send(payload);
      }
      emitter.close();
    });

    const stream = client.stream('SensorService', 'StreamData', new Uint8Array(0));
    const received: number[] = [];

    for await (const chunk of stream) {
      const val = new BinaryReader(chunk).readInt32();
      received.push(val);
    }

    assert.equal(received.length, totalFrames);
    assert.deepEqual(received, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  test('aborts stream on client signal and stops native production', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    let producerStopped = false;
    let cancelTriggered = false;

    host.registerStream('Streamer', 'InfiniteStream', async (reqBytes, emitter) => {
      emitter.onCancel(() => {
        cancelTriggered = true;
      });

      let count = 0;
      while (!producerStopped && count < 100) {
        count++;
        const p = new BinaryWriter().writeInt32(count).finish();
        await emitter.send(p);
      }
    });

    const abort = new AbortController();
    const stream = client.stream('Streamer', 'InfiniteStream', new Uint8Array(0), '', abort.signal);

    const received: number[] = [];
    for await (const chunk of stream) {
      const val = new BinaryReader(chunk).readInt32();
      received.push(val);
      if (val === 5) {
        abort.abort();
        producerStopped = true;
        break;
      }
    }

    assert.equal(received.length, 5);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ElectronRendererTransport,
  ElectronMainTransport,
  WebView2Transport,
  ElectronIpcRendererLike,
  ElectronIpcMainLike,
  ElectronIpcMainEventLike,
  WebView2Endpoint,
} from '../packages/client/src/index.js';
import { AetherClient } from '../packages/client/src/index.js';
import { AetherNativeHost } from '../packages/native-host/src/index.js';
import { BinaryWriter, BinaryReader, Transport } from '../packages/core/src/index.js';

// Simulates Electron IPC structured clone: both hops copy the buffer
// and dispatch asynchronously, exactly like ipcRenderer <-> ipcMain.
function createElectronPair(): [ElectronRendererTransport, ElectronMainTransport] {
  let mainListener: ((event: ElectronIpcMainEventLike, data: ArrayBuffer) => void) | undefined;
  let rendererListener: ((event: unknown, data: ArrayBuffer) => void) | undefined;

  const rendererSender = {
    send(_channel: string, data: ArrayBuffer): void {
      queueMicrotask(() => rendererListener?.({}, data.slice(0)));
    },
  };

  const ipcRenderer: ElectronIpcRendererLike = {
    send(_channel, data) {
      queueMicrotask(() => mainListener?.({ sender: rendererSender }, data.slice(0)));
    },
    on(_channel, listener) {
      rendererListener = listener;
    },
  };

  const ipcMain: ElectronIpcMainLike = {
    on(_channel, listener) {
      mainListener = listener;
    },
  };

  return [
    new ElectronRendererTransport(ipcRenderer),
    new ElectronMainTransport(ipcMain),
  ];
}

// Simulates WebView2 JSON wire: chrome.webview.postMessage -> JSON ->
// host, and host -> PostWebMessageAsJson -> message event.
function createWebView2Pair(): [WebView2Transport, Transport] {
  let hostListener: ((event: { data: { payload: string } }) => void) | undefined;
  let hostReceiver: ((data: Uint8Array) => void) | undefined;

  const endpoint: WebView2Endpoint = {
    postMessage(msg) {
      const wire = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => hostReceiver?.(new Uint8Array(Buffer.from(wire.payload, 'base64'))));
    },
    addEventListener(_type, listener) {
      hostListener = listener;
    },
  };

  const hostTransport: Transport = {
    send(data) {
      const wire = JSON.parse(
        JSON.stringify({ payload: Buffer.from(data).toString('base64') })
      );
      queueMicrotask(() => hostListener?.({ data: wire }));
    },
    onReceive(handler) {
      hostReceiver = handler;
    },
  };

  return [new WebView2Transport(endpoint), hostTransport];
}

function makeBinaryPayload(size: number): Uint8Array {
  const payload = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    payload[i] = (i * 31 + 7) & 0xff;
  }
  return payload;
}

describe('Aether Electron PC Transport', () => {
  test('executes end-to-end unary RPC over IPC', async () => {
    const [clientTransport, hostTransport] = createElectronPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    host.registerRpc('MathService', 'Add', async (reqBytes) => {
      const r = new BinaryReader(reqBytes);
      const a = r.readInt32();
      const b = r.readInt32();
      return new BinaryWriter().writeInt32(a + b).finish();
    });

    const reqPayload = new BinaryWriter().writeInt32(25).writeInt32(17).finish();
    const resBytes = await client.invoke('MathService', 'Add', reqPayload);
    const res = new BinaryReader(resBytes).readInt32();

    assert.equal(res, 42);
  });

  test('preserves binary payload integrity (16 KB)', async () => {
    const [clientTransport, hostTransport] = createElectronPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    host.registerRpc('FileService', 'Echo', async (reqBytes) => reqBytes);

    const payload = makeBinaryPayload(16 * 1024);
    const echoed = await client.invoke('FileService', 'Echo', payload);

    assert.equal(echoed.byteLength, payload.byteLength);
    assert.deepEqual(echoed, payload);
  });

  test('streams frames with backpressure over IPC', async () => {
    const [clientTransport, hostTransport] = createElectronPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    const totalFrames = 15;

    host.registerStream('SensorService', 'StreamData', async (reqBytes, emitter) => {
      for (let i = 1; i <= totalFrames; i++) {
        await emitter.send(new BinaryWriter().writeInt32(i).finish());
      }
      emitter.close();
    });

    const stream = client.stream('SensorService', 'StreamData', new Uint8Array(0));
    const received: number[] = [];

    for await (const chunk of stream) {
      received.push(new BinaryReader(chunk).readInt32());
    }

    assert.deepEqual(
      received,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
  });
});

describe('Aether WebView2 PC Transport', () => {
  test('executes end-to-end unary RPC across JSON wire', async () => {
    const [clientTransport, hostTransport] = createWebView2Pair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    host.registerRpc('DeviceService', 'GetInfo', async (reqBytes) => {
      const locale = new BinaryReader(reqBytes).readString();
      return new BinaryWriter()
        .writeString('Windows PC')
        .writeString(locale)
        .finish();
    });

    const reqPayload = new BinaryWriter().writeString('ru-RU').finish();
    const resBytes = await client.invoke('DeviceService', 'GetInfo', reqPayload);
    const r = new BinaryReader(resBytes);

    assert.equal(r.readString(), 'Windows PC');
    assert.equal(r.readString(), 'ru-RU');
  });

  test('preserves binary payload through Base64 JSON round-trip (8 KB)', async () => {
    const [clientTransport, hostTransport] = createWebView2Pair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    host.registerRpc('FileService', 'Echo', async (reqBytes) => reqBytes);

    const payload = makeBinaryPayload(8 * 1024);
    const echoed = await client.invoke('FileService', 'Echo', payload);

    assert.equal(echoed.byteLength, payload.byteLength);
    assert.deepEqual(echoed, payload);
  });

  test('streams frames with backpressure across JSON wire', async () => {
    const [clientTransport, hostTransport] = createWebView2Pair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    const totalFrames = 12;

    host.registerStream('SensorService', 'StreamData', async (reqBytes, emitter) => {
      for (let i = 1; i <= totalFrames; i++) {
        await emitter.send(new BinaryWriter().writeInt32(i * 100).finish());
      }
      emitter.close();
    });

    const stream = client.stream('SensorService', 'StreamData', new Uint8Array(0));
    const received: number[] = [];

    for await (const chunk of stream) {
      received.push(new BinaryReader(chunk).readInt32());
    }

    assert.deepEqual(
      received,
      [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
    );
  });
});

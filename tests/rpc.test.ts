import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryTransportPair } from '../packages/client/src/index.js';
import { AetherClient } from '../packages/client/src/index.js';
import { AetherNativeHost } from '../packages/native-host/src/index.js';
import { BinaryWriter, BinaryReader } from '../packages/core/src/index.js';

describe('Aether Unary RPC', () => {
  test('executes end-to-end unary RPC call successfully', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    // Register native handler
    host.registerRpc('MathService', 'Add', async (reqBytes) => {
      const r = new BinaryReader(reqBytes);
      const a = r.readInt32();
      const b = r.readInt32();
      const sum = a + b;
      return new BinaryWriter().writeInt32(sum).finish();
    });

    // Client invokes RPC
    const reqPayload = new BinaryWriter().writeInt32(25).writeInt32(17).finish();
    const resBytes = await client.invoke('MathService', 'Add', reqPayload);
    const res = new BinaryReader(resBytes).readInt32();

    assert.equal(res, 42);
  });

  test('propagates native error back to client', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    host.registerRpc('AuthService', 'Login', async () => {
      throw new Error('Invalid credentials');
    });

    const reqPayload = new Uint8Array(0);
    await assert.rejects(
      async () => {
        await client.invoke('AuthService', 'Login', reqPayload);
      },
      /Invalid credentials/
    );
  });

  test('handles unknown service/method with structured error', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport });

    await assert.rejects(
      async () => {
        await client.invoke('NonExistentService', 'Method', new Uint8Array(0));
      },
      /Method not found/
    );
  });
});

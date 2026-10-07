import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityGatekeeper } from '../packages/core/src/index.js';
import { createMemoryTransportPair } from '../packages/client/src/index.js';
import { AetherClient } from '../packages/client/src/index.js';
import { AetherNativeHost } from '../packages/native-host/src/index.js';

describe('Aether Capability ACL & Security', () => {
  test('generates valid token and authorizes allowed services', () => {
    const gatekeeper = new CapabilityGatekeeper('secret-key-123');

    const token = gatekeeper.generateToken({
      origin: 'https://bank.com',
      allowedServices: ['BiometryService.*', 'HapticsService.vibrate'],
      expiresAt: Date.now() + 60000,
    });

    assert.ok(gatekeeper.authorize(token, 'https://bank.com', 'BiometryService', 'authenticate'));
    assert.ok(gatekeeper.authorize(token, 'https://bank.com', 'HapticsService', 'vibrate'));
    assert.equal(gatekeeper.authorize(token, 'https://bank.com', 'HapticsService', 'impact'), false);
    assert.equal(gatekeeper.authorize(token, 'https://bank.com', 'StorageService', 'readKey'), false);
  });

  test('blocks calls with tampered capability signature', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    const host = new AetherNativeHost(hostTransport, 'secret-key-123');
    const client = new AetherClient({ transport: clientTransport });

    host.registerRpc('SecureVault', 'GetSecret', async () => {
      return new Uint8Array([1, 2, 3]);
    });

    const validToken = host.gatekeeper.generateToken({
      origin: '*',
      allowedServices: ['SecureVault.*'],
      expiresAt: Date.now() + 60000,
    });

    // Tamper token signature
    const badToken = validToken.slice(0, -4) + 'ffff';

    await assert.rejects(
      async () => {
        await client.invoke('SecureVault', 'GetSecret', new Uint8Array(0), badToken);
      },
      /\[Security\] Access denied/
    );
  });
});

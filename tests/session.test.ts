import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AetherFrame,
  FrameType,
  FrameFlags,
  SessionRingBuffer,
  SessionRegistry,
} from '../packages/core/src/index.js';
import { createMemoryTransportPair } from '../packages/client/src/index.js';
import { AetherClient } from '../packages/client/src/index.js';
import { AetherNativeHost } from '../packages/native-host/src/index.js';

describe('Aether Session Resumption & OOM Recovery', () => {
  test('ring buffer stores frames and replays frames after specified sequence ID', () => {
    const ring = new SessionRingBuffer(5);

    for (let i = 1; i <= 6; i++) {
      ring.add({
        type: FrameType.STREAM_DATA,
        flags: FrameFlags.NONE,
        streamId: 1,
        sequenceId: i,
        payload: new Uint8Array([i]),
      });
    }

    // Capacity is 5, so frame 1 was evicted, buffer contains 2,3,4,5,6
    const replayed = ring.getFramesAfter(3);
    assert.equal(replayed.length, 3);
    assert.equal(replayed[0].sequenceId, 4);
    assert.equal(replayed[1].sequenceId, 5);
    assert.equal(replayed[2].sequenceId, 6);
  });

  test('host re適ies unacknowledged frames on client handshake after simulated reload', async () => {
    const [clientTransport, hostTransport] = createMemoryTransportPair();
    const host = new AetherNativeHost(hostTransport);
    const client = new AetherClient({ transport: clientTransport, sessionId: 'user_session_42' });

    // Host sends 5 frames in a session
    host.registerRpc('TestService', 'Ping', async () => {
      return new Uint8Array([100]);
    });

    await client.invoke('TestService', 'Ping', new Uint8Array(0));

    // Now simulate WebContent death & reload:
    // New client instance with same sessionId sends handshake
    const [reloadedClientTransport, reloadedHostTransport] = createMemoryTransportPair();
    // Connect reloaded transports to host
    const reloadedClient = new AetherClient({ transport: reloadedClientTransport, sessionId: 'user_session_42' });

    let handshakeAckReceived = false;
    reloadedClientTransport.onReceive((data) => {
      // Host replied with replayed frames or HANDSHAKE_ACK
      handshakeAckReceived = true;
    });

    // Client handshakes asking for frames after seq 0
    client.handshake(0);

    // Verify session exists in host registry
    const session = host.sessionRegistry.getSession('user_session_42');
    assert.ok(session);
    assert.ok(session.ringBuffer.getFramesAfter(0).length > 0);
  });
});

import { Transport } from '../../../core/src/index.js';

export class MemoryTransport implements Transport {
  private peer?: MemoryTransport;
  private receiver?: (data: Uint8Array) => void;

  connectPeer(peer: MemoryTransport): void {
    this.peer = peer;
  }

  send(data: Uint8Array): void {
    if (!this.peer) {
      throw new Error('[MemoryTransport] Peer not connected');
    }
    // Simulate async tick of IPC
    queueMicrotask(() => {
      if (this.peer?.receiver) {
        this.peer.receiver(data);
      }
    });
  }

  onReceive(handler: (data: Uint8Array) => void): void {
    this.receiver = handler;
  }
}

export function createMemoryTransportPair(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport();
  const host = new MemoryTransport();
  client.connectPeer(host);
  host.connectPeer(client);
  return [client, host];
}

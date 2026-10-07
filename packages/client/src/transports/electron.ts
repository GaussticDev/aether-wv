import { Transport } from '../../../core/src/index.js';

export interface ElectronIpcRendererLike {
  send(channel: string, data: ArrayBuffer): void;
  on(channel: string, listener: (event: unknown, data: ArrayBuffer) => void): void;
}

export interface ElectronIpcMainEventLike {
  sender: { send(channel: string, data: ArrayBuffer): void };
}

export interface ElectronIpcMainLike {
  on(channel: string, listener: (event: ElectronIpcMainEventLike, data: ArrayBuffer) => void): void;
}

/**
 * Renderer-side PC driver (Electron). Structured clone of ArrayBuffer
 * is performed by Electron IPC itself — no Base64 tax, unlike iOS.
 */
export class ElectronRendererTransport implements Transport {
  private receiver?: (data: Uint8Array) => void;

  constructor(
    private ipc: ElectronIpcRendererLike,
    private channel: string = 'aether:frame',
  ) {
    this.ipc.on(this.channel, (_event, data) => {
      this.receiver?.(new Uint8Array(data));
    });
  }

  send(data: Uint8Array): void {
    // Copy into an exact-sized buffer: frames may be views over larger chunks
    this.ipc.send(this.channel, data.slice().buffer as ArrayBuffer);
  }

  onReceive(handler: (data: Uint8Array) => void): void {
    this.receiver = handler;
  }
}

/**
 * Main-process PC driver (Electron). Stores the renderer's WebContents
 * from the first inbound frame; all subsequent replies reuse it.
 */
export class ElectronMainTransport implements Transport {
  private receiver?: (data: Uint8Array) => void;
  private renderer?: { send(channel: string, data: ArrayBuffer): void };

  constructor(
    private ipcMain: ElectronIpcMainLike,
    private channel: string = 'aether:frame',
  ) {
    this.ipcMain.on(this.channel, (event, data) => {
      this.renderer = event.sender;
      this.receiver?.(new Uint8Array(data));
    });
  }

  send(data: Uint8Array): void {
    if (!this.renderer) {
      throw new Error('[ElectronMainTransport] Renderer has not connected yet');
    }
    this.renderer.send(this.channel, data.slice().buffer as ArrayBuffer);
  }

  onReceive(handler: (data: Uint8Array) => void): void {
    this.receiver = handler;
  }
}

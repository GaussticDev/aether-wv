import { Transport } from '../../../core/src/index.js';

export class AndroidWebMessageTransport implements Transport {
  private receiver?: (data: Uint8Array) => void;

  constructor(private port?: MessagePort) {
    if (this.port) {
      this.port.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.receiver?.(new Uint8Array(event.data));
        } else if (event.data instanceof Uint8Array) {
          this.receiver?.(event.data);
        }
      };
    }
  }

  setPort(port: MessagePort): void {
    this.port = port;
    this.port.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.receiver?.(new Uint8Array(event.data));
      } else if (event.data instanceof Uint8Array) {
        this.receiver?.(event.data);
      }
    };
  }

  send(data: Uint8Array): void {
    if (!this.port) {
      throw new Error('[AndroidTransport] MessagePort is not ready');
    }
    this.port.postMessage(data.buffer, [data.buffer]);
  }

  onReceive(handler: (data: Uint8Array) => void): void {
    this.receiver = handler;
  }
}

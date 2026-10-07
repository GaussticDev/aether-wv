import { Transport } from '../../../core/src/index.js';

export class IosScriptMessageTransport implements Transport {
  private receiver?: (data: Uint8Array) => void;

  constructor(private handlerName: string = 'aether') {
    // Setup global receiver for native evaluateJavaScript pushes
    if (typeof window !== 'undefined') {
      (window as any).__aether_native_dispatch = (base64Payload: string) => {
        const binary = atob(base64Payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        this.receiver?.(bytes);
      };
    }
  }

  send(data: Uint8Array): void {
    if (typeof window === 'undefined' || !(window as any).webkit?.messageHandlers?.[this.handlerName]) {
      throw new Error(`[IosTransport] webkit.messageHandlers.${this.handlerName} is unavailable`);
    }

    // Binary to Base64 packing for WebKit compliance
    let binary = '';
    const len = data.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const b64 = btoa(binary);

    (window as any).webkit.messageHandlers[this.handlerName].postMessage({
      payload: b64,
    });
  }

  onReceive(handler: (data: Uint8Array) => void): void {
    this.receiver = handler;
  }
}

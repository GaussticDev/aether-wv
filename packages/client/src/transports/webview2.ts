import { Transport } from '../../../core/src/index.js';

export interface WebView2Endpoint {
  postMessage(payload: { payload: string }): void;
  addEventListener(type: 'message', listener: (event: { data: { payload: string } }) => void): void;
}

/**
 * Renderer-side PC driver (Windows WebView2 / Edge WebView).
 * WebView2 serializes postMessage as JSON, so binary frames are packed
 * into Base64 — same wire strategy as the iOS driver.
 */
export class WebView2Transport implements Transport {
  private receiver?: (data: Uint8Array) => void;
  private endpoint?: WebView2Endpoint;

  constructor(endpoint?: WebView2Endpoint) {
    if (endpoint) {
      this.setEndpoint(endpoint);
    } else if (typeof window !== 'undefined' && (window as any).chrome?.webview) {
      this.setEndpoint((window as any).chrome.webview as WebView2Endpoint);
    }
  }

  setEndpoint(endpoint: WebView2Endpoint): void {
    this.endpoint = endpoint;
    endpoint.addEventListener('message', (event) => {
      const binary = atob(event.data.payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      this.receiver?.(bytes);
    });
  }

  send(data: Uint8Array): void {
    if (!this.endpoint) {
      throw new Error('[WebView2Transport] chrome.webview is unavailable');
    }

    // Binary to Base64 packing for JSON wire compliance
    let binary = '';
    const len = data.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const b64 = btoa(binary);

    this.endpoint.postMessage({ payload: b64 });
  }

  onReceive(handler: (data: Uint8Array) => void): void {
    this.receiver = handler;
  }
}

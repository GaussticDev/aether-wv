# Aether-WV

> A typed, binary IPC protocol for WebView bridges.
> One `.aether` schema compiles to TypeScript, Swift and Kotlin. Frames carry a fixed 16-byte header, streams are flow-controlled with credits, and every call can be gated by an HMAC capability token.
> Works on iOS, Android, Windows (WebView2) and Electron.

---

## Why

Every WebView bridge around today — Capacitor, Cordova, WebViewJavascriptBridge, or a hand-rolled `postMessage` layer — runs into the same problems:

| Problem | Usual approach | Aether-WV |
|----------|----------------|-----------|
| Wire format | JSON text, 207 bytes per call | Binary frames, 71 bytes per call (65.7% less) |
| Typing | Untyped strings passed around | `.aether` schema compiled to TS / Swift / Kotlin |
| Flow control | None — large streams can OOM the WebView | Credit-based backpressure |
| Security | Origin checks at best | HMAC-SHA256 token per service/method |
| Session recovery | Reload loses all state | Ring-buffer replay after reconnect |
| Codegen | Every side written by hand | One schema, three languages |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Native App Process                                       │
│  ┌─────────────────────┐   ┌────────────────────────┐   │
│  │  AetherNativeHost   │   │  CapabilityGatekeeper  │   │
│  │  registerRpc()      │   │  HMAC-SHA256 tokens    │   │
│  │  registerStream()   │   └────────────────────────┘   │
│  └─────────┬───────────┘                                 │
│            │ Transport (WebMessagePort / WKScriptMessage) │
│  ┌─────────▼───────────────────────────────────────────┐ │
│  │          AetherMultiplexer  (16-byte frames)        │ │
│  │   StreamID | SeqID | Type | Flags | PayloadLen      │ │
│  └─────────┬───────────────────────────────────────────┘ │
│            │ IPC boundary (kernel)                        │
└────────────┼─────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────┐
│  WebView (JS Context)                                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │  AetherClient                                    │    │
│  │  client.invoke('DeviceService', 'GetInfo', ...)  │    │
│  │  client.stream('PaymentService', 'Watch', ...)   │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**Wire frame (16 bytes, integers big-endian):**

```
┌──────┬─────┬──────┬───────┬────────────┬──────────┬────────────┐
│Magic │ Ver │ Type │ Flags │  StreamID  │  SeqID   │ PayloadLen │
│ 0xAE │  1B │  1B  │  1B   │   4B BE    │   4B BE  │   4B BE    │
└──────┴─────┴──────┴───────┴────────────┴──────────┴────────────┘
```

---

## Quick Start

### 1. Write a schema

```proto
// examples/schema.aether
syntax = "aether_v1";
package com.myapp;

message DeviceInfoRequest {
  string locale = 1;
}

message DeviceInfoResponse {
  string model   = 1;
  string os      = 2;
  int32  battery = 3;
}

service DeviceService {
  rpc GetInfo(DeviceInfoRequest) returns (DeviceInfoResponse);
}
```

### 2. Compile

```bash
node bin/aetherc.js compile examples/schema.aether \
  --out-ts      generated/schema.ts   \
  --out-swift   generated/schema.swift \
  --out-kotlin  generated/schema.kt
```

### 3. Use from JavaScript (WebView side)

```typescript
import { AetherClient } from 'aether-wv';
import { DeviceServiceClient } from './generated/schema.js';

// transport: IosScriptMessageTransport, AndroidWebMessageTransport,
//            WebView2Transport or ElectronRendererTransport
const client = new AetherClient({ transport });
const svc = new DeviceServiceClient(client, token);

const info = await svc.getInfo({ locale: 'en-US' });
console.log(info.model, info.battery);
```

### 4. Native side (iOS)

The driver templates live in `packages/platform-templates`. The iOS one attaches to your `WKWebView` and hands raw frame bytes back to you:

```swift
import WebKit

let driver = AetherIosDriver(webView: webView) { frameData in
    // decode with the codecs from generated/schema.swift,
    // run your handler, then push the reply back:
    // driver.sendFrameToWeb(data: replyFrame)
}
```

### 5. Native side (Android)

```kotlin
import io.aether.webview.AetherAndroidDriver

val driver = AetherAndroidDriver(
    webView = webView,
    allowedOrigins = setOf("https://app.example.com")
) { frame ->
    // decode with the codecs from generated/schema.kt,
    // run your handler, then driver.sendFrameToWeb(reply)
}
```

---

## Codegen Output

The compiler produces three files from one schema:

**TypeScript** (WebView side)
- an interface per message
- `encodeX()` / `decodeX()` binary codecs
- a `<Service>Client` class, one async method per RPC, streams as async generators

**Swift** (iOS side)
- `struct X: Sendable, Equatable` per message
- codecs on top of `AetherWriter` / `AetherReader`
- `protocol <Service>Protocol: Actor`
- a client stub with async and stream methods

**Kotlin** (Android side)
- a `data class` per message
- codecs on `AetherWriter` / `AetherReader` (`com.aetherwv`)
- an interface with `suspend fun` for RPCs and `Flow<T>` for streams
- a client stub built on coroutines

---

## Features

### Streaming with backpressure

```typescript
const stream = client.stream('PaymentService', 'WatchTransactions', request, token);
for await (const frame of stream) {
  // the host cannot push faster than you consume:
  // every frame spends a credit, and credits are refilled by your ACKs
}
```

The host registers a handler that receives an emitter:

```typescript
host.registerStream('PaymentService', 'WatchTransactions', async (payload, emitter) => {
  const timer = setInterval(async () => {
    await emitter.send(encodeTransaction(...));
  }, 100);

  emitter.onCancel(() => clearInterval(timer)); // client aborted the stream
});
```

### Capability tokens

```typescript
const token = host.gatekeeper.generateToken({
  origin: 'https://app.example.com',
  allowedServices: ['DeviceService.GetInfo', 'PaymentService.*'],
  expiresAt: Date.now() + 3_600_000,
});
// the token travels with every call; the host verifies the HMAC
// and the allow-list before routing
```

### Session resumption

```typescript
// the WebView was killed and reloaded — recreate the client
// with the same session ID you had before:
const client = new AetherClient({ transport, sessionId: savedSessionId });
client.handshake(lastAckedSeq);

// the host replays everything after lastAckedSeq
// from its 256-frame ring buffer
```

---

## Transports

| Platform | Transport class | Mechanism |
|----------|----------------|-----------|
| iOS | `IosScriptMessageTransport` | `WKScriptMessageHandlerWithReply` + Base64 |
| Android | `AndroidWebMessageTransport` | `WebMessagePort`, ArrayBuffer transfer |
| Windows (WebView2) | `WebView2Transport` | `chrome.webview.postMessage` + Base64 |
| Desktop (Electron) | `ElectronRendererTransport` / `ElectronMainTransport` | `ipcRenderer` / `ipcMain`, structured clone |
| Tests | `MemoryTransport` | in-process transport pair |

WKWebView only exchanges string messages with page content, so the iOS path Base64-encodes every frame — about 33% bigger on the wire. Android's `WebMessagePort` and Electron's structured clone move raw bytes with no encoding overhead.

---

## Benchmark

10,000 calls, run with `npm run benchmark`:

```
=============================================================
         AETHER-WV vs JSON BRIDGE BENCHMARK (10,000 Ops)
=============================================================
* Aether Binary Frame:
  - Total Time: 87.51 ms
  - Throughput: 114,266 ops/sec
  - Avg Wire Size: 71 bytes / frame
  - Avg Latency: 8.75 µs / op

* Classic JSON Bridge (Capacitor / Cordova pattern):
  - Total Time: 25.56 ms
  - Throughput: 391,256 ops/sec
  - Avg Wire Size: 207 bytes / frame
  - Avg Latency: 2.56 µs / op

* Speedup: 0.29x faster
* Wire Size Savings: 65.7% smaller
=============================================================
```

The JSON side wins on raw CPU: `JSON.stringify` is native C++ with full type specialization, while the Aether codec is plain `DataView` writes in JavaScript.

Serialization is not where WebView IPC spends its time, though. Every `postMessage` pays 1.5-3.5 ms to cross the process boundary regardless of how fast you encode. Aether frames are 65.7% smaller, so there is less to copy across that boundary on every call. Exact numbers depend on the machine — measure your own with `npm run benchmark`.

---

## Project Structure

```
packages/
  core/                ← Protocol, frames, multiplexer, security, session
  client/              ← AetherClient + platform transports (iOS, Android, Electron, WebView2, Memory)
  native-host/         ← AetherNativeHost (register handlers, route frames)
  compiler/            ← .aether parser + TypeScript/Swift/Kotlin codegen
  platform-templates/
    ios/AetherNativeDriver.swift     ← WKWebView integration template
    android/AetherNativeDriver.kt    ← WebViewCompat integration template

bin/
  aetherc.js           ← CLI schema compiler

examples/
  schema.aether     ← Example schema
  run-demo.ts       ← End-to-end demo (8 steps)

tests/
  protocol.test.ts      ← Binary frame codec
  rpc.test.ts           ← Unary RPC
  streaming.test.ts     ← Backpressure + abort
  security.test.ts      ← HMAC token ACL
  session.test.ts       ← Ring buffer replay
  compiler.test.ts      ← Schema parser + codegen
  pc-transport.test.ts  ← Electron + WebView2 PC drivers
  benchmark.test.ts     ← Aether vs JSON
```

---

## CLI Reference

```bash
# Compile a schema to all three targets
node bin/aetherc.js compile <schema.aether> \
  --out-ts     <file.ts>     \   # TypeScript client
  --out-swift  <file.swift>  \   # Swift 6 (iOS)
  --out-kotlin <file.kt>         # Kotlin 2.x (Android)

# End-to-end demo
npm run demo

# Tests
npm test

# Benchmark
npm run benchmark
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

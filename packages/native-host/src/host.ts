import {
  Transport,
  AetherFrame,
  FrameType,
  FrameFlags,
  encodeFrame,
  decodeFrame,
  BinaryReader,
  BinaryWriter,
  StreamCreditController,
  CapabilityGatekeeper,
  SessionRegistry,
} from '../../core/src/index.js';

export interface StreamEmitter {
  send(payload: Uint8Array): Promise<void>;
  close(): void;
  error(err: Error): void;
  onCancel(cb: () => void): void;
}

export type RpcHandler = (payload: Uint8Array) => Promise<Uint8Array>;
export type StreamHandler = (payload: Uint8Array, emitter: StreamEmitter) => void;

export class AetherNativeHost {
  private rpcHandlers = new Map<string, RpcHandler>();
  private streamHandlers = new Map<string, StreamHandler>();
  private activeEmitters = new Map<number, StreamEmitter>();
  private streamControllers = new Map<number, StreamCreditController>();
  private sequenceId = 1;

  public gatekeeper: CapabilityGatekeeper;
  public sessionRegistry: SessionRegistry;

  constructor(
    private transport: Transport,
    secretKey?: string
  ) {
    this.gatekeeper = new CapabilityGatekeeper(secretKey);
    this.sessionRegistry = new SessionRegistry();

    this.transport.onReceive((data) => this.handleRawBytes(data));
  }

  registerRpc(service: string, method: string, handler: RpcHandler): void {
    this.rpcHandlers.set(`${service}.${method}`, handler);
  }

  registerStream(service: string, method: string, handler: StreamHandler): void {
    this.streamHandlers.set(`${service}.${method}`, handler);
  }

  private handleRawBytes(bytes: Uint8Array): void {
    const frame = decodeFrame(bytes);
    this.handleFrame(frame);
  }

  private sendFrame(frame: AetherFrame, sessionId?: string): void {
    if (sessionId) {
      const session = this.sessionRegistry.getOrCreateSession(sessionId);
      session.ringBuffer.add(frame);
    }
    const bytes = encodeFrame(frame);
    this.transport.send(bytes);
  }

  private sendError(streamId: number, message: string, sessionId?: string): void {
    const errorFrame: AetherFrame = {
      type: FrameType.ERROR,
      flags: FrameFlags.NONE,
      streamId,
      sequenceId: this.sequenceId++,
      payload: new TextEncoder().encode(message),
    };
    this.sendFrame(errorFrame, sessionId);
  }

  private handleFrame(frame: AetherFrame): void {
    switch (frame.type) {
      case FrameType.RPC_REQ: {
        this.handleRpcRequest(frame);
        break;
      }

      case FrameType.STREAM_DATA: {
        this.handleStreamInit(frame);
        break;
      }

      case FrameType.FLOW_ACK: {
        const credits = new DataView(frame.payload.buffer, frame.payload.byteOffset).getUint32(0, false);
        const controller = this.streamControllers.get(frame.streamId);
        if (controller) {
          controller.grantCredits(credits);
        }
        break;
      }

      case FrameType.STREAM_CANCEL: {
        const emitter = this.activeEmitters.get(frame.streamId);
        if (emitter) {
          // Trigger the handler's onCancel callback so it can stop producing data
          (emitter as any).__cancelCallback?.();
          this.activeEmitters.delete(frame.streamId);
        }
        const controller = this.streamControllers.get(frame.streamId);
        if (controller) {
          controller.cancel();
          this.streamControllers.delete(frame.streamId);
        }
        break;
      }


      case FrameType.HANDSHAKE: {
        this.handleHandshake(frame);
        break;
      }
    }
  }

  private handleRpcRequest(frame: AetherFrame): void {
    try {
      const reader = new BinaryReader(frame.payload);
      const sessionId = reader.readString();
      const service = reader.readString();
      const method = reader.readString();
      const token = reader.readString();
      const reqPayload = reader.readBytes();

      // Check ACL permissions if token is provided or expected
      if (token && !this.gatekeeper.authorize(token, '*', service, method)) {
        this.sendError(frame.streamId, `[Security] Access denied for ${service}.${method}`, sessionId);
        return;
      }

      const handler = this.rpcHandlers.get(`${service}.${method}`);
      if (!handler) {
        this.sendError(frame.streamId, `[RpcError] Method not found: ${service}.${method}`, sessionId);
        return;
      }

      handler(reqPayload)
        .then((resPayload) => {
          const respFrame: AetherFrame = {
            type: FrameType.RPC_RESP,
            flags: FrameFlags.NONE,
            streamId: frame.streamId,
            sequenceId: this.sequenceId++,
            payload: resPayload,
          };
          this.sendFrame(respFrame, sessionId);
        })
        .catch((err) => {
          this.sendError(frame.streamId, err.message || String(err), sessionId);
        });
    } catch (err: any) {
      this.sendError(frame.streamId, `[MalformedRequest] ${err.message}`);
    }
  }

  private handleStreamInit(frame: AetherFrame): void {
    try {
      const reader = new BinaryReader(frame.payload);
      const sessionId = reader.readString();
      const service = reader.readString();
      const method = reader.readString();
      const token = reader.readString();
      const reqPayload = reader.readBytes();

      if (token && !this.gatekeeper.authorize(token, '*', service, method)) {
        this.sendError(frame.streamId, `[Security] Access denied for ${service}.${method}`, sessionId);
        return;
      }

      const handler = this.streamHandlers.get(`${service}.${method}`);
      if (!handler) {
        this.sendError(frame.streamId, `[StreamError] Stream method not found: ${service}.${method}`, sessionId);
        return;
      }

      const controller = new StreamCreditController({ initialCredits: 8, ackBatchSize: 4 });
      this.streamControllers.set(frame.streamId, controller);

      let cancelCallback: (() => void) | null = null;
      let closed = false;

      const emitter: StreamEmitter & { __cancelCallback?: () => void } = {
        send: async (data: Uint8Array) => {
          if (closed) return;
          // Wait for available credit from client
          await controller.acquireCredit();
          if (closed) return;

          const dataFrame: AetherFrame = {
            type: FrameType.STREAM_DATA,
            flags: FrameFlags.NONE,
            streamId: frame.streamId,
            sequenceId: this.sequenceId++,
            payload: data,
          };
          this.sendFrame(dataFrame, sessionId);
        },
        close: () => {
          if (closed) return;
          closed = true;
          this.activeEmitters.delete(frame.streamId);
          this.streamControllers.delete(frame.streamId);

          const closeFrame: AetherFrame = {
            type: FrameType.STREAM_CLOSE,
            flags: FrameFlags.END_STREAM,
            streamId: frame.streamId,
            sequenceId: this.sequenceId++,
            payload: new Uint8Array(0),
          };
          this.sendFrame(closeFrame, sessionId);
        },
        error: (err: Error) => {
          if (closed) return;
          closed = true;
          this.activeEmitters.delete(frame.streamId);
          this.streamControllers.delete(frame.streamId);
          this.sendError(frame.streamId, err.message, sessionId);
        },
        onCancel: (cb: () => void) => {
          cancelCallback = cb;
          emitter.__cancelCallback = cb;
        },
      };


      this.activeEmitters.set(frame.streamId, emitter);
      handler(reqPayload, emitter);
    } catch (err: any) {
      this.sendError(frame.streamId, `[MalformedStreamInit] ${err.message}`);
    }
  }

  private handleHandshake(frame: AetherFrame): void {
    try {
      const reader = new BinaryReader(frame.payload);
      const sessionId = reader.readString();
      const lastAckSeq = reader.readUint32();

      const session = this.sessionRegistry.getSession(sessionId);
      if (!session) {
        return;
      }

      // Replay lost frames from ring buffer
      const replayFrames = session.ringBuffer.getFramesAfter(lastAckSeq);
      for (const replay of replayFrames) {
        const replayCopy: AetherFrame = {
          ...replay,
          flags: replay.flags | FrameFlags.RESUMED,
        };
        const bytes = encodeFrame(replayCopy);
        this.transport.send(bytes);
      }

      // Send Handshake ACK
      const ackPayload = new BinaryWriter()
        .writeString(sessionId)
        .writeUint32(replayFrames.length)
        .finish();

      const ackFrame: AetherFrame = {
        type: FrameType.HANDSHAKE_ACK,
        flags: FrameFlags.NONE,
        streamId: 0,
        sequenceId: this.sequenceId++,
        payload: ackPayload,
      };
      const bytes = encodeFrame(ackFrame);
      this.transport.send(bytes);
    } catch {
      // Ignored
    }
  }
}

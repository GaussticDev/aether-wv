import {
  Transport,
  AetherMultiplexer,
  BinaryWriter,
  BinaryReader,
  AetherFrame,
  FrameType,
  FrameFlags,
} from '../../core/src/index.js';

export interface ClientConfig {
  transport: Transport;
  sessionId?: string;
  defaultTimeoutMs?: number;
}

export class AetherClient {
  private multiplexer: AetherMultiplexer;
  private sessionId: string;
  private defaultTimeoutMs: number;

  constructor(config: ClientConfig) {
    this.multiplexer = new AetherMultiplexer(config.transport);
    this.sessionId = config.sessionId ?? `session_${Math.random().toString(36).slice(2, 10)}`;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 15000;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  /**
   * Invokes a unary RPC method on a native service
   */
  async invoke(
    service: string,
    method: string,
    requestPayload: Uint8Array,
    token: string = '',
    timeoutMs?: number
  ): Promise<Uint8Array> {
    const envelope = new BinaryWriter()
      .writeString(this.sessionId)
      .writeString(service)
      .writeString(method)
      .writeString(token)
      .writeBytes(requestPayload)
      .finish();

    return this.multiplexer.invokeRpc(envelope, timeoutMs ?? this.defaultTimeoutMs);
  }

  /**
   * Opens a reactive stream from a native service
   */
  stream(
    service: string,
    method: string,
    requestPayload: Uint8Array,
    token: string = '',
    signal?: AbortSignal
  ): AsyncIterableIterator<Uint8Array> {
    const envelope = new BinaryWriter()
      .writeString(this.sessionId)
      .writeString(service)
      .writeString(method)
      .writeString(token)
      .writeBytes(requestPayload)
      .finish();

    return this.multiplexer.openStream(envelope, signal);
  }

  /**
   * Handshake for OOM crash recovery
   */
  handshake(lastAckSequenceId: number): void {
    const payload = new BinaryWriter()
      .writeString(this.sessionId)
      .writeUint32(lastAckSequenceId)
      .finish();

    const frame: AetherFrame = {
      type: FrameType.HANDSHAKE,
      flags: FrameFlags.NONE,
      streamId: 0,
      sequenceId: 0,
      payload,
    };
    this.multiplexer.send(frame);
  }
}

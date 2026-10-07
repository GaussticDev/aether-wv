import {
  AetherFrame,
  FrameType,
  FrameFlags,
  encodeFrame,
  decodeFrame,
} from '../protocol/frames.js';
import { StreamCreditController } from './backpressure.js';

export interface Transport {
  send(data: Uint8Array): Promise<void> | void;
  onReceive(handler: (data: Uint8Array) => void): void;
}

export interface StreamConsumer<T = Uint8Array> {
  onData: (data: T) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export class AetherMultiplexer {
  private nextStreamId = 1;
  private nextSequenceId = 1;

  // Pending unary RPC requests: streamId -> { resolve, reject, timeout }
  private pendingRpc = new Map<
    number,
    {
      resolve: (payload: Uint8Array) => void;
      reject: (err: Error) => void;
      timer?: NodeJS.Timeout;
    }
  >();

  // Active incoming streams: streamId -> { queue, resolvers, controller, isClosed }
  private activeStreams = new Map<
    number,
    {
      queue: Uint8Array[];
      waiters: Array<(result: IteratorResult<Uint8Array>) => void>;
      controller: StreamCreditController;
      isClosed: boolean;
      error?: Error;
    }
  >();

  // Active outgoing streams (producers): streamId -> controller
  private outgoingStreams = new Map<number, StreamCreditController>();

  constructor(private transport: Transport) {
    this.transport.onReceive((data) => this.handleRawBytes(data));
  }

  private handleRawBytes(bytes: Uint8Array): void {
    const frame = decodeFrame(bytes);
    this.handleFrame(frame);
  }

  handleFrame(frame: AetherFrame): void {
    switch (frame.type) {
      case FrameType.RPC_RESP: {
        const pending = this.pendingRpc.get(frame.streamId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          this.pendingRpc.delete(frame.streamId);
          pending.resolve(frame.payload);
        }
        break;
      }

      case FrameType.ERROR: {
        const errMsg = new TextDecoder().decode(frame.payload);
        const err = new Error(`[AetherError] (Stream ${frame.streamId}): ${errMsg}`);

        // Check if it's an RPC error
        const pendingRpc = this.pendingRpc.get(frame.streamId);
        if (pendingRpc) {
          if (pendingRpc.timer) clearTimeout(pendingRpc.timer);
          this.pendingRpc.delete(frame.streamId);
          pendingRpc.reject(err);
          return;
        }

        // Check if it's a stream error
        const stream = this.activeStreams.get(frame.streamId);
        if (stream) {
          stream.error = err;
          stream.isClosed = true;
          while (stream.waiters.length > 0) {
            const w = stream.waiters.shift();
            if (w) w(Promise.reject(err) as any);
          }
          this.activeStreams.delete(frame.streamId);
        }
        break;
      }

      case FrameType.STREAM_DATA: {
        const stream = this.activeStreams.get(frame.streamId);
        if (stream) {
          if (stream.waiters.length > 0) {
            const waiter = stream.waiters.shift()!;
            waiter({ value: frame.payload, done: false });
          } else {
            stream.queue.push(frame.payload);
          }

          // Check if we need to return credits via FLOW_ACK
          const creditsToAck = stream.controller.onFrameProcessed();
          if (creditsToAck > 0) {
            this.sendAck(frame.streamId, creditsToAck);
          }
        }
        break;
      }

      case FrameType.FLOW_ACK: {
        // Consumer sent us credits to continue producing
        const credits = new DataView(frame.payload.buffer, frame.payload.byteOffset).getUint32(0, false);
        const producerController = this.outgoingStreams.get(frame.streamId);
        if (producerController) {
          producerController.grantCredits(credits);
        }
        break;
      }

      case FrameType.STREAM_CLOSE: {
        const stream = this.activeStreams.get(frame.streamId);
        if (stream) {
          stream.isClosed = true;
          while (stream.waiters.length > 0 && stream.queue.length > 0) {
            const waiter = stream.waiters.shift()!;
            waiter({ value: stream.queue.shift()!, done: false });
          }
          while (stream.waiters.length > 0) {
            const waiter = stream.waiters.shift()!;
            waiter({ value: undefined, done: true });
          }
          if (stream.queue.length === 0) {
            this.activeStreams.delete(frame.streamId);
          }
        }
        break;
      }

      case FrameType.STREAM_CANCEL: {
        const outgoing = this.outgoingStreams.get(frame.streamId);
        if (outgoing) {
          outgoing.cancel();
          this.outgoingStreams.delete(frame.streamId);
        }
        break;
      }
    }
  }

  private sendAck(streamId: number, credits: number): void {
    const ackPayload = new Uint8Array(4);
    new DataView(ackPayload.buffer).setUint32(0, credits, false);

    const frame: AetherFrame = {
      type: FrameType.FLOW_ACK,
      flags: FrameFlags.NONE,
      streamId,
      sequenceId: this.nextSequenceId++,
      payload: ackPayload,
    };
    this.send(frame);
  }

  send(frame: AetherFrame): void {
    const bytes = encodeFrame(frame);
    this.transport.send(bytes);
  }

  /**
   * Execute Unary RPC Call
   */
  async invokeRpc(payload: Uint8Array, timeoutMs = 15000): Promise<Uint8Array> {
    const streamId = this.nextStreamId++;
    const sequenceId = this.nextSequenceId++;

    const frame: AetherFrame = {
      type: FrameType.RPC_REQ,
      flags: FrameFlags.NONE,
      streamId,
      sequenceId,
      payload,
    };

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(streamId);
        reject(new Error(`[AetherRpc] Request timeout after ${timeoutMs}ms (Stream ${streamId})`));
      }, timeoutMs);

      this.pendingRpc.set(streamId, { resolve, reject, timer });
      this.send(frame);
    });
  }

  /**
   * Open reactive stream and return an AsyncIterableIterator with backpressure
   */
  openStream(payload: Uint8Array, signal?: AbortSignal): AsyncIterableIterator<Uint8Array> {
    const streamId = this.nextStreamId++;
    const sequenceId = this.nextSequenceId++;
    const controller = new StreamCreditController({ initialCredits: 8, ackBatchSize: 4 });

    const streamState = {
      queue: [] as Uint8Array[],
      waiters: [] as Array<(result: IteratorResult<Uint8Array>) => void>,
      controller,
      isClosed: false,
    };
    this.activeStreams.set(streamId, streamState);

    // Initial stream request
    const initFrame: AetherFrame = {
      type: FrameType.STREAM_DATA,
      flags: FrameFlags.NONE,
      streamId,
      sequenceId,
      payload,
    };
    this.send(initFrame);

    // Abort controller integration
    if (signal) {
      signal.addEventListener('abort', () => {
        this.cancelStream(streamId);
      });
    }

    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<Uint8Array>> {
        if (streamState.queue.length > 0) {
          const val = streamState.queue.shift()!;
          const creditsToAck = streamState.controller.onFrameProcessed();
          if (creditsToAck > 0) {
            self.sendAck(streamId, creditsToAck);
          }
          return Promise.resolve({ value: val, done: false });
        }

        if (streamState.isClosed) {
          self.activeStreams.delete(streamId);
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          streamState.waiters.push((res) => {
            if (res.done) {
              resolve(res);
            } else {
              resolve(res);
            }
          });
        });
      },
      return(): Promise<IteratorResult<Uint8Array>> {
        self.cancelStream(streamId);
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }

  cancelStream(streamId: number): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.isClosed = true;
      this.activeStreams.delete(streamId);
    }
    const cancelFrame: AetherFrame = {
      type: FrameType.STREAM_CANCEL,
      flags: FrameFlags.NONE,
      streamId,
      sequenceId: this.nextSequenceId++,
      payload: new Uint8Array(0),
    };
    this.send(cancelFrame);
  }

  registerProducerController(streamId: number, controller: StreamCreditController): void {
    this.outgoingStreams.set(streamId, controller);
  }

  unregisterProducerController(streamId: number): void {
    this.outgoingStreams.delete(streamId);
  }
}

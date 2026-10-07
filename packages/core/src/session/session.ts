import { AetherFrame } from '../protocol/frames.js';

/**
 * Ring buffer of recent frames for session resumption following WebContent process OOM reload.
 */
export class SessionRingBuffer {
  private buffer: AetherFrame[] = [];

  constructor(private readonly capacity: number = 256) {}

  add(frame: AetherFrame): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(frame);
  }

  /**
   * Retrieves all frames with sequenceId > lastAckSeq
   */
  getFramesAfter(lastAckSeq: number): AetherFrame[] {
    return this.buffer.filter((f) => f.sequenceId > lastAckSeq);
  }

  clear(): void {
    this.buffer = [];
  }
}

export interface SessionState {
  sessionId: string;
  createdAt: number;
  lastActive: number;
  lastSequenceId: number;
  ringBuffer: SessionRingBuffer;
}

export class SessionRegistry {
  private sessions = new Map<string, SessionState>();

  getOrCreateSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        createdAt: Date.now(),
        lastActive: Date.now(),
        lastSequenceId: 0,
        ringBuffer: new SessionRingBuffer(256),
      };
      this.sessions.set(sessionId, session);
    } else {
      session.lastActive = Date.now();
    }
    return session;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

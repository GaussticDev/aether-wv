/**
 * Aether-WV Credit-Based Flow Control Manager
 * Implements sliding window credit management to prevent consumer overload and GC jank.
 */

export interface FlowControlConfig {
  initialCredits?: number;
  ackBatchSize?: number;
}

export class StreamCreditController {
  private credits: number;
  private pendingAcks: number = 0;
  private readonly ackThreshold: number;
  private waitResolvers: Array<() => void> = [];

  constructor(private config: FlowControlConfig = {}) {
    this.credits = config.initialCredits ?? 8;
    this.ackThreshold = config.ackBatchSize ?? Math.max(1, Math.floor(this.credits / 2));
  }

  /** Current available credits for sending */
  get availableCredits(): number {
    return this.credits;
  }

  /**
   * Called by Producer before sending a frame.
   * If credits <= 0, returns a Promise that resolves when a FLOW_ACK is received.
   */
  async acquireCredit(): Promise<void> {
    if (this.credits > 0) {
      this.credits -= 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitResolvers.push(() => {
        this.credits -= 1;
        resolve();
      });
    });
  }

  /**
   * Called by Producer when FLOW_ACK is received from Consumer.
   */
  grantCredits(count: number): void {
    this.credits += count;
    while (this.credits > 0 && this.waitResolvers.length > 0) {
      const resume = this.waitResolvers.shift();
      if (resume) resume();
    }
  }

  /**
   * Called by Consumer when a frame is processed.
   * Returns positive number of credits to ACK if threshold reached, or 0 if buffered.
   */
  onFrameProcessed(): number {
    this.pendingAcks += 1;
    if (this.pendingAcks >= this.ackThreshold) {
      const toAck = this.pendingAcks;
      this.pendingAcks = 0;
      return toAck;
    }
    return 0;
  }

  /**
   * Force flush any pending acks (e.g. before closing)
   */
  flushPendingAcks(): number {
    const toAck = this.pendingAcks;
    this.pendingAcks = 0;
    return toAck;
  }

  /**
   * Cancel and unblock all waiting producers (e.g. on stream termination/error)
   */
  cancel(): void {
    this.credits = 0;
    const resolvers = this.waitResolvers;
    this.waitResolvers = [];
    for (const res of resolvers) {
      res();
    }
  }
}

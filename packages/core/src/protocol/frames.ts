/**
 * Aether-WV Binary Wire Protocol Frame Definitions
 * 
 * Fixed 16-byte header:
 * [Magic (1B) | Version (1B) | Type (1B) | Flags (1B)]
 * [Stream ID (4B)                                    ]
 * [Sequence ID (4B)                                  ]
 * [Payload Length (4B)                               ]
 * [Payload Data (N Bytes)                            ]
 */

export const AETHER_MAGIC = 0xAE;
export const AETHER_VERSION = 0x01;
export const HEADER_SIZE = 16;

export enum FrameType {
  RPC_REQ = 0x01,
  RPC_RESP = 0x02,
  STREAM_DATA = 0x03,
  STREAM_CLOSE = 0x04,
  STREAM_CANCEL = 0x05,
  FLOW_ACK = 0x06,
  ERROR = 0x07,
  HANDSHAKE = 0x08,
  HANDSHAKE_ACK = 0x09,
}

export enum FrameFlags {
  NONE = 0x00,
  END_STREAM = 0x01,
  COMPRESSED = 0x02,
  RESUMED = 0x04,
}

export interface AetherFrame {
  type: FrameType;
  flags: number;
  streamId: number;
  sequenceId: number;
  payload: Uint8Array;
}

/**
 * Serializes an AetherFrame into a contiguous binary Uint8Array
 */
export function encodeFrame(frame: AetherFrame): Uint8Array {
  const payloadLen = frame.payload.byteLength;
  const totalLen = HEADER_SIZE + payloadLen;
  const buffer = new ArrayBuffer(totalLen);
  const view = new DataView(buffer);

  // Header
  view.setUint8(0, AETHER_MAGIC);
  view.setUint8(1, AETHER_VERSION);
  view.setUint8(2, frame.type);
  view.setUint8(3, frame.flags);
  view.setUint32(4, frame.streamId, false); // BigEndian
  view.setUint32(8, frame.sequenceId, false);
  view.setUint32(12, payloadLen, false);

  // Payload
  const out = new Uint8Array(buffer);
  if (payloadLen > 0) {
    out.set(frame.payload, HEADER_SIZE);
  }

  return out;
}

/**
 * Decodes a binary Uint8Array into an AetherFrame (zero-copy slice)
 */
export function decodeFrame(data: Uint8Array): AetherFrame {
  if (data.byteLength < HEADER_SIZE) {
    throw new Error(`[Aether] Frame too short: ${data.byteLength} < ${HEADER_SIZE}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, HEADER_SIZE);
  const magic = view.getUint8(0);
  if (magic !== AETHER_MAGIC) {
    throw new Error(`[Aether] Invalid magic byte: 0x${magic.toString(16).toUpperCase()} != 0xAE`);
  }

  const version = view.getUint8(1);
  if (version !== AETHER_VERSION) {
    throw new Error(`[Aether] Unsupported protocol version: ${version}`);
  }

  const type = view.getUint8(2) as FrameType;
  const flags = view.getUint8(3);
  const streamId = view.getUint32(4, false);
  const sequenceId = view.getUint32(8, false);
  const payloadLength = view.getUint32(12, false);

  if (data.byteLength < HEADER_SIZE + payloadLength) {
    throw new Error(
      `[Aether] Incomplete frame payload: got ${data.byteLength - HEADER_SIZE}, expected ${payloadLength}`
    );
  }

  const payload = data.subarray(HEADER_SIZE, HEADER_SIZE + payloadLength);

  return {
    type,
    flags,
    streamId,
    sequenceId,
    payload,
  };
}

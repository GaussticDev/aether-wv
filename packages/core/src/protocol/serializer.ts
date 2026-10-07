/**
 * Aether-WV Compact Binary Serializer Primitives
 * High-performance encoding/decoding without external dependencies
 */

export class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number = 0;

  constructor(initialCapacity = 256) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensureCapacity(needed: number) {
    if (this.offset + needed <= this.buffer.byteLength) return;
    let newCap = Math.max(this.buffer.byteLength * 2, this.offset + needed);
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this.buffer);
    this.buffer = newBuf;
    this.view = new DataView(this.buffer.buffer);
  }

  writeUint8(val: number): this {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, val);
    this.offset += 1;
    return this;
  }

  writeInt32(val: number): this {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, false);
    this.offset += 4;
    return this;
  }

  writeUint32(val: number): this {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, val, false);
    this.offset += 4;
    return this;
  }

  writeFloat32(val: number): this {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, val, false);
    this.offset += 4;
    return this;
  }

  writeFloat64(val: number): this {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, val, false);
    this.offset += 8;
    return this;
  }

  writeBigInt64(val: bigint): this {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.offset, val, false);
    this.offset += 8;
    return this;
  }

  writeBoolean(val: boolean): this {
    return this.writeUint8(val ? 1 : 0);
  }

  writeBytes(bytes: Uint8Array): this {
    this.writeUint32(bytes.byteLength);
    this.ensureCapacity(bytes.byteLength);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.byteLength;
    return this;
  }

  writeString(str: string): this {
    const encoded = new TextEncoder().encode(str);
    return this.writeBytes(encoded);
  }

  finish(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }
}

export class BinaryReader {
  private view: DataView;
  private offset: number = 0;

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get remaining(): number {
    return this.buffer.byteLength - this.offset;
  }

  readUint8(): number {
    if (this.remaining < 1) throw new Error('[AetherReader] Underflow reading uint8');
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readInt32(): number {
    if (this.remaining < 4) throw new Error('[AetherReader] Underflow reading int32');
    const val = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readUint32(): number {
    if (this.remaining < 4) throw new Error('[AetherReader] Underflow reading uint32');
    const val = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readFloat32(): number {
    if (this.remaining < 4) throw new Error('[AetherReader] Underflow reading float32');
    const val = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readFloat64(): number {
    if (this.remaining < 8) throw new Error('[AetherReader] Underflow reading float64');
    const val = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return val;
  }

  readBigInt64(): bigint {
    if (this.remaining < 8) throw new Error('[AetherReader] Underflow reading bigint64');
    const val = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return val;
  }

  readBoolean(): boolean {
    return this.readUint8() !== 0;
  }

  readBytes(): Uint8Array {
    const len = this.readUint32();
    if (this.remaining < len) throw new Error(`[AetherReader] Underflow reading bytes: ${this.remaining} < ${len}`);
    const bytes = this.buffer.subarray(this.offset, this.offset + len);
    this.offset += len;
    return bytes;
  }

  readString(): string {
    const bytes = this.readBytes();
    return new TextDecoder().decode(bytes);
  }
}

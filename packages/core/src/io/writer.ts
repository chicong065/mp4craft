import { ConfigError } from '@/types/errors'

/**
 * Append-only big-endian binary writer used by every box builder.
 *
 * The writer owns a growable `Uint8Array`. Each write method appends to the current position
 * and grows the backing buffer geometrically when needed. Multi-byte integer helpers always
 * emit big-endian byte order, matching the ISOBMFF convention.
 *
 * @remarks
 * {@link Writer#toBytes} returns a subarray view over the internal buffer rather than a copy,
 * so it remains valid only until the next write that forces reallocation. Callers that need
 * a stable snapshot should copy immediately.
 */
export class Writer {
  private buffer: Uint8Array
  private dataView: DataView
  private writeOffset = 0

  /**
   * Constructs a writer.
   *
   * @param initialCapacity - Initial backing buffer capacity in bytes. Defaults to 1024. The
   *   buffer grows automatically as needed, so this is a hint, not a hard limit.
   */
  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity)
    this.dataView = new DataView(this.buffer.buffer)
  }

  /** Number of bytes written so far. */
  get length(): number {
    return this.writeOffset
  }

  private ensureCapacity(byteCount: number): void {
    const requiredSize = this.writeOffset + byteCount
    if (requiredSize <= this.buffer.length) {
      return
    }
    let newCapacity = this.buffer.length || 16
    while (newCapacity < requiredSize) newCapacity *= 2
    const grownBuffer = new Uint8Array(newCapacity)
    grownBuffer.set(this.buffer.subarray(0, this.writeOffset))
    this.buffer = grownBuffer
    this.dataView = new DataView(this.buffer.buffer)
  }

  /**
   * Writes one unsigned 8-bit integer.
   *
   * @param value - Value in the range `[0, 0xFF]`. Out-of-range inputs follow the `DataView`
   *   coercion rules.
   */
  u8(value: number): void {
    this.ensureCapacity(1)
    this.dataView.setUint8(this.writeOffset, value)
    this.writeOffset += 1
  }

  /**
   * Writes one big-endian unsigned 16-bit integer.
   *
   * @param value - Value in the range `[0, 0xFFFF]`.
   */
  u16(value: number): void {
    this.ensureCapacity(2)
    this.dataView.setUint16(this.writeOffset, value, false)
    this.writeOffset += 2
  }

  /**
   * Writes one big-endian unsigned 24-bit integer (three bytes).
   *
   * @param value - Value in the range `[0, 0xFFFFFF]`. Used by ISOBMFF FullBox flags and a few
   *   descriptor fields.
   */
  u24(value: number): void {
    this.ensureCapacity(3)
    this.dataView.setUint8(this.writeOffset, (value >>> 16) & 0xff)
    this.dataView.setUint8(this.writeOffset + 1, (value >>> 8) & 0xff)
    this.dataView.setUint8(this.writeOffset + 2, value & 0xff)
    this.writeOffset += 3
  }

  /**
   * Writes one big-endian unsigned 32-bit integer.
   *
   * @param value - Value in the range `[0, 0xFFFFFFFF]`. The `>>> 0` coercion inside handles
   *   JavaScript's signed 32-bit bitwise semantics so callers can pass values up to 2^32 - 1.
   */
  u32(value: number): void {
    this.ensureCapacity(4)
    this.dataView.setUint32(this.writeOffset, value >>> 0, false)
    this.writeOffset += 4
  }

  /**
   * Writes one big-endian signed 32-bit integer.
   *
   * @param value - Value in the range `[-2^31, 2^31 - 1]`.
   */
  i32(value: number): void {
    this.ensureCapacity(4)
    this.dataView.setInt32(this.writeOffset, value, false)
    this.writeOffset += 4
  }

  /**
   * Writes one big-endian unsigned 64-bit integer.
   *
   * @param value - Value as a non-negative `bigint`. Used by `co64` and other 64-bit-sized
   *   header fields.
   */
  u64(value: bigint): void {
    this.ensureCapacity(8)
    this.dataView.setBigUint64(this.writeOffset, value, false)
    this.writeOffset += 8
  }

  /**
   * Writes a four-character code (ASCII box type or brand).
   *
   * @param text - A four-character ASCII string.
   * @throws {@link ConfigError} When the string is not exactly four characters, or when any
   *   character is outside the 7-bit ASCII range.
   */
  fourcc(text: string): void {
    if (text.length !== 4) {
      throw new ConfigError(`fourcc must be 4 chars, got "${text}"`)
    }
    for (let index = 0; index < 4; index++) {
      if (text.charCodeAt(index) > 0x7f) {
        throw new ConfigError(`fourcc char out of ASCII range at index ${index}: "${text}"`)
      }
    }
    this.ensureCapacity(4)
    for (let index = 0; index < 4; index++) {
      this.buffer[this.writeOffset + index] = text.charCodeAt(index)
    }
    this.writeOffset += 4
  }

  /**
   * Writes an ASCII string verbatim (one byte per character, no length prefix or terminator).
   *
   * @param text - A string whose characters are assumed to be in the 7-bit ASCII range.
   *   Characters above `0x7F` are truncated by the `charCodeAt` result being stored into a
   *   byte slot.
   */
  ascii(text: string): void {
    this.ensureCapacity(text.length)
    for (let index = 0; index < text.length; index++) {
      this.buffer[this.writeOffset + index] = text.charCodeAt(index)
    }
    this.writeOffset += text.length
  }

  /**
   * Appends raw bytes.
   *
   * @param data - Byte buffer to append. The writer copies out of `data` into its own buffer.
   */
  bytes(data: Uint8Array): void {
    this.ensureCapacity(data.length)
    this.buffer.set(data, this.writeOffset)
    this.writeOffset += data.length
  }

  /**
   * Writes `byteCount` zero bytes. Exploits the fact that a freshly allocated `Uint8Array` is
   * already zero-initialized, so growth covers the region without an explicit fill.
   *
   * @param byteCount - Number of zero bytes to append.
   */
  zeros(byteCount: number): void {
    this.ensureCapacity(byteCount)
    this.writeOffset += byteCount // Uint8Array allocation is zero-initialized
  }

  /**
   * Writes one 16.16 fixed-point value as a big-endian unsigned 32-bit integer.
   *
   * @param value - Real-valued input. Multiplied by `0x10000`, rounded, and coerced to
   *   unsigned 32-bit.
   */
  fixed16_16(value: number): void {
    this.u32(Math.round(value * 0x10000) >>> 0)
  }

  /**
   * Writes one 2.30 fixed-point value as a big-endian unsigned 32-bit integer. Used by the
   * `tkhd` transformation matrix.
   *
   * @param value - Real-valued input. Multiplied by `0x40000000`, rounded, and coerced to
   *   unsigned 32-bit.
   */
  fixed2_30(value: number): void {
    this.u32(Math.round(value * 0x40000000) >>> 0)
  }

  /**
   * Overwrites an already-written big-endian unsigned 32-bit integer in place.
   *
   * Used to patch box size fields after the enclosed content has been serialized (classic
   * ISOBMFF box layout trick). Does not move the write cursor.
   *
   * @param offset - Byte offset at which to patch. Must be within the already-written region.
   * @param value - New unsigned 32-bit value.
   * @throws {@link ConfigError} When `offset + 4` extends past the written region.
   */
  patchU32(offset: number, value: number): void {
    if (offset < 0 || offset + 4 > this.writeOffset) {
      throw new ConfigError(`patchU32 offset ${offset} out of written range [0, ${this.writeOffset})`)
    }
    this.dataView.setUint32(offset, value >>> 0, false)
  }

  /**
   * Returns a view of the bytes written so far.
   *
   * @returns A `Uint8Array` subarray aliased to the internal buffer, covering `[0, length)`.
   *   The view is invalidated if the writer grows, so callers should copy when holding the
   *   result beyond subsequent writes.
   */
  toBytes(): Uint8Array {
    return this.buffer.subarray(0, this.writeOffset)
  }
}

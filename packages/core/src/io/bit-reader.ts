import { ConfigError } from '@/types/errors'

/**
 * Big-endian bit-oriented reader.
 *
 * Bits within each byte are read MSB-first, matching the NAL-unit bitstream convention used
 * by AVC and HEVC. The reader is used by the muxer's AVC SPS parser to derive coded picture
 * dimensions, and provides Exp-Golomb helpers (`readUE` and `readSE`) as specified by
 * ISO/IEC 14496-10 §9.1.
 */
export class BitReader {
  private byteOffset = 0
  private bitPositionInCurrentByte = 0 // 0..7, MSB-first within each byte

  /**
   * Constructs a reader over an existing byte buffer.
   *
   * @param data - Source bytes. Typically an RBSP payload already stripped of emulation
   *   prevention bytes via {@link unescapeRbsp}.
   */
  constructor(private readonly data: Uint8Array) {}

  /**
   * Reads the next single bit.
   *
   * @returns `0` or `1`.
   * @throws {@link ConfigError} When the cursor has advanced past the end of the buffer.
   */
  readBit(): number {
    if (this.byteOffset >= this.data.length) {
      throw new ConfigError('BitReader: read past end of buffer')
    }
    const currentByte = this.data[this.byteOffset]!
    const bitValue = (currentByte >> (7 - this.bitPositionInCurrentByte)) & 1
    this.bitPositionInCurrentByte++
    if (this.bitPositionInCurrentByte === 8) {
      this.bitPositionInCurrentByte = 0
      this.byteOffset++
    }
    return bitValue
  }

  /**
   * Reads the next `bitCount` bits as a single unsigned integer (MSB-first).
   *
   * @param bitCount - Number of bits to read. Must be in the range `[0, 32]` so the result
   *   fits in an unsigned 32-bit value.
   * @returns The assembled unsigned integer, coerced to unsigned 32-bit.
   * @throws {@link ConfigError} When `bitCount` exceeds 32, or when the read overruns the
   *   buffer.
   */
  readBits(bitCount: number): number {
    if (bitCount > 32) {
      throw new ConfigError('BitReader.readBits: bitCount must be <= 32')
    }
    let result = 0
    for (let index = 0; index < bitCount; index++) result = (result << 1) | this.readBit()
    return result >>> 0
  }

  /**
   * Reads one unsigned Exp-Golomb (`ue(v)`) code.
   *
   * Implements the decode procedure of ISO/IEC 14496-10 §9.1: count leading zeros, then read
   * that many suffix bits, and combine as `(1 << leadingZeros) - 1 + suffix`.
   *
   * @returns The decoded unsigned integer.
   * @throws {@link ConfigError} When more than 32 leading zeros are encountered (indicating a
   *   malformed bitstream), or when the read overruns the buffer.
   */
  readUE(): number {
    let leadingZeroCount = 0
    while (this.readBit() === 0) {
      if (leadingZeroCount === 32) {
        throw new ConfigError('BitReader.readUE: too many leading zeros')
      }
      leadingZeroCount++
    }
    if (leadingZeroCount === 0) {
      return 0
    }
    const suffix = this.readBits(leadingZeroCount)
    return (1 << leadingZeroCount) - 1 + suffix
  }

  /**
   * Reads one signed Exp-Golomb (`se(v)`) code.
   *
   * Uses the mapping from ISO/IEC 14496-10 Table 9-3: the unsigned value `u` maps to
   * `(-1)^(u+1) * ceil(u/2)`, so odd `u` yields positive signed values and even `u` yields
   * negative signed values.
   *
   * @returns The decoded signed integer.
   */
  readSE(): number {
    const unsignedValue = this.readUE()
    if (unsignedValue === 0) {
      return 0
    }
    // Odd ue produces a positive value, even ue produces a negative value (H.264 spec Table 9-3).
    const sign = unsignedValue & 1 ? 1 : -1
    return sign * Math.ceil(unsignedValue / 2)
  }

  /**
   * Advances the cursor by `bitCount` bits without decoding them.
   *
   * @param bitCount - Non-negative number of bits to skip.
   * @throws {@link ConfigError} When `bitCount` is negative, or when the skip overruns the
   *   buffer.
   */
  skipBits(bitCount: number): void {
    if (bitCount < 0) {
      throw new ConfigError('BitReader.skipBits: bitCount must be >= 0')
    }
    for (let index = 0; index < bitCount; index++) this.readBit()
  }
}

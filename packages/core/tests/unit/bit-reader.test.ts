import { BitReader } from '@/io/bit-reader'
import { ConfigError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('BitReader', () => {
  it('reads individual bits MSB-first', () => {
    const reader = new BitReader(new Uint8Array([0b10110001]))
    expect(reader.readBit()).toBe(1)
    expect(reader.readBit()).toBe(0)
    expect(reader.readBit()).toBe(1)
    expect(reader.readBit()).toBe(1)
    expect(reader.readBit()).toBe(0)
    expect(reader.readBit()).toBe(0)
    expect(reader.readBit()).toBe(0)
    expect(reader.readBit()).toBe(1)
  })

  it('readBits spans byte boundaries', () => {
    const reader = new BitReader(new Uint8Array([0xf0, 0x0f]))
    expect(reader.readBits(4)).toBe(0xf)
    expect(reader.readBits(8)).toBe(0x00)
    expect(reader.readBits(4)).toBe(0xf)
  })

  it('unsigned Exp-Golomb (readUE)', () => {
    // Unsigned Exp-Golomb codes from ISO/IEC 14496-10 §9.1 decode as follows:
    //   "1"      decodes to 0
    //   "010"    decodes to 1
    //   "011"    decodes to 2
    //   "00100"  decodes to 3
    //   "00111"  decodes to 6
    const bitString = '1' + '010' + '011' + '00100' + '00111'
    const paddedBitString = bitString.padEnd(Math.ceil(bitString.length / 8) * 8, '0')
    const inputBytes = new Uint8Array(paddedBitString.length / 8)
    for (let byteIndex = 0; byteIndex < inputBytes.length; byteIndex++) {
      inputBytes[byteIndex] = parseInt(paddedBitString.slice(byteIndex * 8, byteIndex * 8 + 8), 2)
    }
    const reader = new BitReader(inputBytes)
    expect(reader.readUE()).toBe(0)
    expect(reader.readUE()).toBe(1)
    expect(reader.readUE()).toBe(2)
    expect(reader.readUE()).toBe(3)
    expect(reader.readUE()).toBe(6)
  })

  it('signed Exp-Golomb (readSE)', () => {
    // Signed Exp-Golomb folds each Ue(v) into a signed integer per ISO/IEC 14496-10 §9.1.1.
    // ue=0 decodes to 0, ue=1 to +1, ue=2 to -1, ue=3 to +2, ue=4 to -2.
    const bitString = '1' + '010' + '011' + '00100' + '00101'
    const paddedBitString = bitString.padEnd(Math.ceil(bitString.length / 8) * 8, '0')
    const inputBytes = new Uint8Array(paddedBitString.length / 8)
    for (let byteIndex = 0; byteIndex < inputBytes.length; byteIndex++) {
      inputBytes[byteIndex] = parseInt(paddedBitString.slice(byteIndex * 8, byteIndex * 8 + 8), 2)
    }
    const reader = new BitReader(inputBytes)
    expect(reader.readSE()).toBe(0)
    expect(reader.readSE()).toBe(1)
    expect(reader.readSE()).toBe(-1)
    expect(reader.readSE()).toBe(2)
    expect(reader.readSE()).toBe(-2)
  })

  it('readBit throws ConfigError when reading past end', () => {
    const reader = new BitReader(new Uint8Array([0xff]))
    for (let index = 0; index < 8; index++) reader.readBit()
    expect(() => reader.readBit()).toThrow(ConfigError)
  })

  it('readBits throws ConfigError for bitCount > 32', () => {
    const reader = new BitReader(new Uint8Array(8))
    expect(() => reader.readBits(33)).toThrow(ConfigError)
  })

  it('skipBits throws ConfigError for negative bitCount', () => {
    const reader = new BitReader(new Uint8Array([0xff]))
    expect(() => reader.skipBits(-1)).toThrow(ConfigError)
  })
})

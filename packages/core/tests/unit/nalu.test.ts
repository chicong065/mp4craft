import { annexBToLengthPrefixed, splitAnnexB, unescapeRbsp } from '@/io/nalu'
import { describe, expect, it } from 'vitest'

describe('NALU utilities', () => {
  it('splitAnnexB finds NAL units separated by 00 00 00 01', () => {
    const input = new Uint8Array([0, 0, 0, 1, 0x67, 0xaa, 0, 0, 0, 1, 0x68, 0xbb, 0xcc])
    const nalus = splitAnnexB(input)
    expect(nalus).toHaveLength(2)
    expect([...nalus[0]!]).toEqual([0x67, 0xaa])
    expect([...nalus[1]!]).toEqual([0x68, 0xbb, 0xcc])
  })

  it('splitAnnexB also accepts 3-byte start code', () => {
    const input = new Uint8Array([0, 0, 1, 0x67, 0xaa, 0, 0, 1, 0x68, 0xbb])
    const nalus = splitAnnexB(input)
    expect(nalus).toHaveLength(2)
    expect([...nalus[0]!]).toEqual([0x67, 0xaa])
    expect([...nalus[1]!]).toEqual([0x68, 0xbb])
  })

  it('annexBToLengthPrefixed emits 4-byte big-endian length + payload', () => {
    const input = new Uint8Array([0, 0, 0, 1, 0x67, 0xaa, 0, 0, 0, 1, 0x68, 0xbb, 0xcc])
    const output = annexBToLengthPrefixed(input)
    expect([...output]).toEqual([0, 0, 0, 2, 0x67, 0xaa, 0, 0, 0, 3, 0x68, 0xbb, 0xcc])
  })

  it('unescapeRbsp removes 0x03 emulation-prevention bytes', () => {
    const input = new Uint8Array([0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x03, 0x02])
    const output = unescapeRbsp(input)
    expect([...output]).toEqual([0x00, 0x00, 0x01, 0x00, 0x00, 0x02])
  })

  it('splitAnnexB handles mixed 3-byte and 4-byte start codes, preserving NALU payload bytes', () => {
    // 4-byte start code followed by 3-byte start code: boundary lengths recorded at scan time
    const input = new Uint8Array([
      0,
      0,
      0,
      1,
      0x67,
      0xaa, // 4-byte start code, payload: [0x67, 0xaa]
      0,
      0,
      1,
      0x68,
      0xbb, // 3-byte start code, payload: [0x68, 0xbb]
      0,
      0,
      0,
      1,
      0x41,
      0xcc, // 4-byte start code, payload: [0x41, 0xcc]
    ])
    const nalus = splitAnnexB(input)
    expect(nalus).toHaveLength(3)
    expect([...nalus[0]!]).toEqual([0x67, 0xaa])
    expect([...nalus[1]!]).toEqual([0x68, 0xbb])
    expect([...nalus[2]!]).toEqual([0x41, 0xcc])
  })

  it('splitAnnexB returns empty array for empty input', () => {
    expect(splitAnnexB(new Uint8Array([]))).toEqual([])
  })

  it('splitAnnexB returns empty array when no start code is present', () => {
    expect(splitAnnexB(new Uint8Array([0x67, 0xaa, 0xbb]))).toEqual([])
  })
})

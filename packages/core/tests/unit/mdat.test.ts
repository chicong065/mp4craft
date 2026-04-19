import { writeMdatHeader32, writeMdatHeader64, MDAT_HEADER_SIZE_32, MDAT_HEADER_SIZE_64 } from '@/boxes/mdat'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('mdat header', () => {
  it('MDAT_HEADER_SIZE_32 matches actual 32-bit header byte count', () => {
    const outputWriter = new Writer()
    writeMdatHeader32(outputWriter, MDAT_HEADER_SIZE_32)
    expect(outputWriter.toBytes().length).toBe(MDAT_HEADER_SIZE_32)
  })

  it('MDAT_HEADER_SIZE_64 matches actual 64-bit header byte count', () => {
    const outputWriter = new Writer()
    writeMdatHeader64(outputWriter, BigInt(MDAT_HEADER_SIZE_64))
    expect(outputWriter.toBytes().length).toBe(MDAT_HEADER_SIZE_64)
  })

  it('32-bit form writes [size(4)] [mdat(4)]', () => {
    const outputWriter = new Writer()
    writeMdatHeader32(outputWriter, 1000)
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(8)
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)).toBe(1000)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mdat')
  })

  it('64-bit form writes [1(4)] [mdat(4)] [size(8)]', () => {
    const outputWriter = new Writer()
    writeMdatHeader64(outputWriter, 0x100000000n)
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(16)
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)).toBe(1)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mdat')
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(8, false)).toBe(0x100000000n)
  })
})

import { writeBox } from '@/boxes/box'
import { createFtyp } from '@/boxes/ftyp'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('ftyp box', () => {
  it('emits major brand, minor version, compatible brands', () => {
    const outputWriter = new Writer()
    writeBox(
      outputWriter,
      createFtyp({
        majorBrand: 'isom',
        minorVersion: 512,
        compatibleBrands: ['isom', 'iso2', 'avc1', 'mp41'],
      })
    )
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(32)
    expect(bytes[3]).toBe(32)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp')
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('isom')
    expect(new DataView(bytes.buffer).getUint32(12, false)).toBe(512)
    expect(String.fromCharCode(...bytes.subarray(16, 20))).toBe('isom')
    expect(String.fromCharCode(...bytes.subarray(28, 32))).toBe('mp41')
  })
})

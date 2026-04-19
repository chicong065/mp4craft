import { Writer } from '@/io/writer'
import { ConfigError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('Writer', () => {
  it('writes u8 / u16 / u24 / u32 big-endian', () => {
    const writer = new Writer()
    writer.u8(0x12)
    writer.u16(0x3456)
    writer.u24(0x789abc)
    writer.u32(0xdeadbeef)
    expect([...writer.toBytes()]).toEqual([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xad, 0xbe, 0xef])
  })

  it('writes u64 as big-endian', () => {
    const writer = new Writer()
    writer.u64(0x0123456789abcdefn)
    expect([...writer.toBytes()]).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef])
  })

  it('writes fourcc as ASCII', () => {
    const writer = new Writer()
    writer.fourcc('moov')
    expect(new TextDecoder().decode(writer.toBytes())).toBe('moov')
  })

  it('fourcc throws ConfigError for wrong length', () => {
    const writer = new Writer()
    expect(() => writer.fourcc('mv')).toThrow(ConfigError)
  })

  it('fourcc throws ConfigError for non-ASCII chars', () => {
    const writer = new Writer()
    expect(() => writer.fourcc('\u00e9xyz')).toThrow(ConfigError)
  })

  it('writes fixed-point 16.16', () => {
    const writer = new Writer()
    writer.fixed16_16(1.0)
    expect([...writer.toBytes()]).toEqual([0x00, 0x01, 0x00, 0x00])
  })

  it('writes fixed-point 2.30 (matrix entry)', () => {
    const writer = new Writer()
    writer.fixed2_30(1.0)
    expect([...writer.toBytes()]).toEqual([0x40, 0x00, 0x00, 0x00])
  })

  it('writes raw bytes and tracks length', () => {
    const writer = new Writer()
    writer.bytes(new Uint8Array([1, 2, 3]))
    expect(writer.length).toBe(3)
  })

  it('writes zeros and advances length with zero bytes in output', () => {
    const writer = new Writer()
    writer.u8(0xaa)
    writer.zeros(3)
    expect(writer.length).toBe(4)
    expect([...writer.toBytes()]).toEqual([0xaa, 0x00, 0x00, 0x00])
  })

  it('writes i32 big-endian including negative values', () => {
    const writer = new Writer()
    writer.i32(-1)
    expect([...writer.toBytes()]).toEqual([0xff, 0xff, 0xff, 0xff])
  })

  it('writes ascii string bytes', () => {
    const writer = new Writer()
    writer.ascii('hello')
    expect(new TextDecoder().decode(writer.toBytes())).toBe('hello')
  })

  it('grows its internal buffer as needed', () => {
    const writer = new Writer(4) // start small
    for (let index = 0; index < 100; index++) writer.u8(index & 0xff)
    expect(writer.length).toBe(100)
    expect(writer.toBytes()[99]).toBe(99)
    expect(writer.toBytes()[63]).toBe(63) // boundary-straddling byte
  })

  it('patches u32 at a prior offset (for box size fixups)', () => {
    const writer = new Writer()
    const sizeFieldOffset = writer.length
    writer.u32(0)
    writer.fourcc('test')
    writer.u32(0x12345678)
    writer.patchU32(sizeFieldOffset, writer.length)
    const outputBytes = writer.toBytes()
    expect([...outputBytes.subarray(0, 4)]).toEqual([0, 0, 0, 12])
  })

  it('patchU32 throws ConfigError for out-of-bounds offset', () => {
    const writer = new Writer()
    writer.u32(0)
    expect(() => writer.patchU32(99, 1)).toThrow(ConfigError)
  })
})

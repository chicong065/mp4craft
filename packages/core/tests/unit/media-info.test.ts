import { writeBox } from '@/boxes/box'
import { createDref } from '@/boxes/dref'
import { createHdlr } from '@/boxes/hdlr'
import { createMdhd } from '@/boxes/mdhd'
import { createSmhd } from '@/boxes/smhd'
import { createVmhd } from '@/boxes/vmhd'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('media info boxes', () => {
  it('mdhd packs ISO-639 language as 5 bits * 3 (char - 0x60)', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createMdhd({ timescale: 48000, duration: 0, language: 'eng' }))
    const bytes = outputWriter.toBytes()
    // 8 header + 4 FullBox + 4 creation + 4 modification + 4 timescale + 4 duration + 2 lang + 2 pre = 32
    expect(bytes.length).toBe(32)
    // ISO 639-2/T 'eng' packs into 15 bits as three 5-bit letters relative to 0x60:
    //   e - 0x60 = 5, n - 0x60 = 14, g - 0x60 = 7.
    //   (5 << 10) | (14 << 5) | 7 = 0x15C7.
    expect(new DataView(bytes.buffer).getUint16(28, false)).toBe(0x15c7)
  })

  it('hdlr type is "vide" for video and carries a name', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createHdlr({ handlerType: 'vide', name: 'VideoHandler' }))
    const bytes = outputWriter.toBytes()
    const handlerTypeStart = 8 + 4 + 4 // after box header + FullBox + pre_defined(u32)
    expect(String.fromCharCode(...bytes.subarray(handlerTypeStart, handlerTypeStart + 4))).toBe('vide')
  })

  it('vmhd has flags=1 and correct size', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createVmhd())
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(8 + 4 + 8) // header + FullBox + 2 graphicsmode + 6 opcolor
    expect(bytes[11]).toBe(0x01) // flags last byte
  })

  it('smhd is 16 bytes total', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createSmhd())
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(16)
  })

  it('dref has one self-contained url entry (flags=0x000001)', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createDref())
    const bytes = outputWriter.toBytes()
    // 8 header + 4 FullBox + 4 entry_count + 12 url child = 28
    expect(bytes.length).toBe(28)
    expect(String.fromCharCode(...bytes.subarray(20, 24))).toBe('url ')
  })
})

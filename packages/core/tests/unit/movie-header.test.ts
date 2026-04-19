import { writeBox } from '@/boxes/box'
import { createMvhd } from '@/boxes/mvhd'
import { createTkhd } from '@/boxes/tkhd'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('movie/track headers', () => {
  it('mvhd v0 is 108 bytes total (8 header + 4 FullBox + 96 payload)', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createMvhd({ timescale: 1000, duration: 0, nextTrackId: 2 }))
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(108)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mvhd')
    expect(new DataView(bytes.buffer).getUint32(20, false)).toBe(1000)
    expect(new DataView(bytes.buffer).getUint32(104, false)).toBe(2)
  })

  it('tkhd v0 has track_enabled flag and width/height in 16.16 fixed-point', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createTkhd({ trackId: 1, duration: 0, width: 1920, height: 1080, isAudio: false }))
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(92)
    expect(bytes[11]).toBe(0x01)
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint32(84, false)).toBe(1920 * 0x10000)
    expect(dataView.getUint32(88, false)).toBe(1080 * 0x10000)
  })
})

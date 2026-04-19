import { writeBox } from '@/boxes/box'
import type { Box, FourCC } from '@/boxes/box'
import { createMoov } from '@/boxes/moov'
import { createMvhd } from '@/boxes/mvhd'
import { createTrak } from '@/boxes/trak'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

function makeStubBox(type: FourCC, totalSize = 8): Box {
  return { type, write: (writer) => writer.zeros(totalSize - 8) }
}

describe('trak/moov', () => {
  it('trak nests tkhd and mdia', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createTrak({ tkhd: makeStubBox('tkhd', 16), mdia: makeStubBox('mdia', 24) }))
    const bytes = outputWriter.toBytes()
    // 8 header + 16 tkhd + 24 mdia = 48
    expect(bytes.length).toBe(48)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trak')
  })

  it('moov nests mvhd and one or more traks', () => {
    const outputWriter = new Writer()
    writeBox(
      outputWriter,
      createMoov({
        mvhd: createMvhd({ timescale: 1000, duration: 0, nextTrackId: 2 }),
        traks: [makeStubBox('trak', 40)],
      })
    )
    const bytes = outputWriter.toBytes()
    // 8 header + 108 mvhd + 40 trak = 156
    expect(bytes.length).toBe(156)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('moov')
  })
})

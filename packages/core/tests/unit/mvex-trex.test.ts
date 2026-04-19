import { writeBox } from '@/boxes/box'
import { createMehd } from '@/boxes/mehd'
import { createMvex } from '@/boxes/mvex'
import { createTrex } from '@/boxes/trex'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('createTrex', () => {
  it('emits a trex FullBox with default sample flags', () => {
    // Per ISO/IEC 14496-12 §8.8.3.2, the trex payload after the FullBox header is
    // track_ID (u32), default_sample_description_index (u32), default_sample_duration (u32),
    // default_sample_size (u32), default_sample_flags (u32). Total body is 20 bytes, and
    // the box header adds size (u32), fourcc (4), version (u8), flags (u24) for 12 bytes.
    const trex = createTrex({
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: 0,
    })
    const boxWriter = new Writer()
    writeBox(boxWriter, trex)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 20)
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint32(0, false)).toBe(bytes.length)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trex')
    expect(dataView.getUint8(8)).toBe(0)
    expect(dataView.getUint32(12, false)).toBe(1)
    expect(dataView.getUint32(16, false)).toBe(1)
    expect(dataView.getUint32(20, false)).toBe(0)
    expect(dataView.getUint32(24, false)).toBe(0)
    expect(dataView.getUint32(28, false)).toBe(0)
  })
})

describe('createMehd', () => {
  it('emits a version-1 mehd FullBox with the fragment duration as u64', () => {
    // Per ISO/IEC 14496-12 §8.8.2, version 1 encodes fragment_duration as u64 in the movie timescale.
    const mehd = createMehd({ fragmentDurationInMovieTimescale: 10_000n })
    const boxWriter = new Writer()
    writeBox(boxWriter, mehd)
    const bytes = boxWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mehd')
    expect(dataView.getUint8(8)).toBe(1)
    expect(dataView.getBigUint64(12, false)).toBe(10_000n)
  })
})

describe('createMvex', () => {
  it('emits an mvex container box with optional mehd followed by trex children', () => {
    const trex = createTrex({
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: 0,
    })
    const mvex = createMvex({ trex: [trex] })
    const boxWriter = new Writer()
    writeBox(boxWriter, mvex)
    const bytes = boxWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mvex')
    const bodyText = new TextDecoder('latin1').decode(bytes)
    expect(bodyText.indexOf('trex')).toBeGreaterThan(0)
    expect(bodyText.indexOf('mehd')).toBe(-1)
  })

  it('emits mehd before trex when mehd is supplied', () => {
    const trex = createTrex({
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: 0,
    })
    const mehd = createMehd({ fragmentDurationInMovieTimescale: 5_000n })
    const mvex = createMvex({ mehd, trex: [trex] })
    const boxWriter = new Writer()
    writeBox(boxWriter, mvex)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    const mehdPosition = bodyText.indexOf('mehd')
    const trexPosition = bodyText.indexOf('trex')
    expect(mehdPosition).toBeGreaterThan(0)
    expect(trexPosition).toBeGreaterThan(0)
    expect(mehdPosition).toBeLessThan(trexPosition)
  })
})

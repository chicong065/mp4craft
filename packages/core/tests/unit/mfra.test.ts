import { writeBox } from '@/boxes/box'
import { createMfra } from '@/boxes/mfra'
import { createMfro } from '@/boxes/mfro'
import { createTfra } from '@/boxes/tfra'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('createTfra', () => {
  it('emits a version-1 tfra FullBox listing one entry per fragment with u64 time and moofOffset', () => {
    // Per ISO/IEC 14496-12 §8.8.10, tfra version 1 stores time and moof_offset as u64.
    // Remaining fields (traf_number, trun_number, sample_number) use the minimum one-byte width
    // because mp4craft emits one traf per track per fragment and one trun per traf, and each
    // fragment begins at a sync sample.
    const tfra = createTfra({
      trackId: 1,
      entries: [
        {
          timeInTrackTimescale: 0n,
          moofOffsetFromFileStart: 1000n,
          trafNumber: 1,
          trunNumber: 1,
          sampleNumber: 1,
        },
        {
          timeInTrackTimescale: 90_000n,
          moofOffsetFromFileStart: 2000n,
          trafNumber: 1,
          trunNumber: 1,
          sampleNumber: 1,
        },
      ],
    })
    const boxWriter = new Writer()
    writeBox(boxWriter, tfra)
    const bytes = boxWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('tfra')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(1)
    expect(dataView.getUint32(12, false)).toBe(1)
    expect(dataView.getUint32(16, false)).toBe(0)
    expect(dataView.getUint32(20, false)).toBe(2)
    expect(dataView.getBigUint64(24, false)).toBe(0n)
    expect(dataView.getBigUint64(32, false)).toBe(1000n)
    expect(dataView.getUint8(40)).toBe(1)
    expect(dataView.getUint8(41)).toBe(1)
    expect(dataView.getUint8(42)).toBe(1)
  })
})

describe('createMfro', () => {
  it('emits an mfro FullBox carrying the supplied mfra size as u32', () => {
    const mfro = createMfro({ mfraByteLength: 256 })
    const boxWriter = new Writer()
    writeBox(boxWriter, mfro)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(16)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mfro')
    expect(new DataView(bytes.buffer).getUint32(12, false)).toBe(256)
  })
})

describe('createMfra', () => {
  it('emits an mfra container with every tfra followed by a final mfro', () => {
    const tfra = createTfra({
      trackId: 1,
      entries: [
        {
          timeInTrackTimescale: 0n,
          moofOffsetFromFileStart: 100n,
          trafNumber: 1,
          trunNumber: 1,
          sampleNumber: 1,
        },
      ],
    })
    const mfra = createMfra({ tfras: [tfra], totalByteLength: 64 })
    const boxWriter = new Writer()
    writeBox(boxWriter, mfra)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    expect(bodyText.indexOf('mfra')).toBe(4)
    const tfraPosition = bodyText.indexOf('tfra')
    const mfroPosition = bodyText.indexOf('mfro')
    expect(tfraPosition).toBeGreaterThan(0)
    expect(mfroPosition).toBeGreaterThan(tfraPosition)
  })
})

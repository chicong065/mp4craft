import { writeBox } from '@/boxes/box'
import { createTfdt } from '@/boxes/tfdt'
import { createTfhd } from '@/boxes/tfhd'
import { createTraf } from '@/boxes/traf'
import { createTrun, encodeTrunSampleFlags } from '@/boxes/trun'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('createTfhd', () => {
  it('emits a tfhd FullBox with default-base-is-moof and only the track_ID field', () => {
    // Per ISO/IEC 14496-12 §8.8.7, flag 0x020000 (default-base-is-moof) tells parsers to
    // treat data_offset values in subsequent trun boxes as offsets from the start of the
    // parent moof. With no other flags set the payload is just track_ID (u32).
    const tfhd = createTfhd({ trackId: 1 })
    const boxWriter = new Writer()
    writeBox(boxWriter, tfhd)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 4)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('tfhd')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(0)
    // The u24 flags field occupies bytes 9, 10, 11.
    expect(dataView.getUint8(9)).toBe(0x02)
    expect(dataView.getUint8(10)).toBe(0x00)
    expect(dataView.getUint8(11)).toBe(0x00)
    expect(dataView.getUint32(12, false)).toBe(1)
  })
})

describe('createTfdt', () => {
  it('emits a version-1 tfdt FullBox with baseMediaDecodeTime as u64', () => {
    // Per ISO/IEC 14496-12 §8.8.12, version 1 stores baseMediaDecodeTime as u64 in the
    // track timescale.
    const tfdt = createTfdt({ baseMediaDecodeTimeInTrackTimescale: 300_000n })
    const boxWriter = new Writer()
    writeBox(boxWriter, tfdt)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 8)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('tfdt')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(1)
    expect(dataView.getBigUint64(12, false)).toBe(300_000n)
  })
})

describe('encodeTrunSampleFlags', () => {
  it('encodes a keyframe as sample_depends_on=2 with sample_is_non_sync_sample=0', () => {
    expect(encodeTrunSampleFlags(true)).toBe(0x02000000)
  })

  it('encodes a non-keyframe as sample_depends_on=1 with sample_is_non_sync_sample=1', () => {
    expect(encodeTrunSampleFlags(false)).toBe(0x01010000)
  })
})

describe('createTrun', () => {
  it('emits a trun with data_offset, and per-sample duration, size, and flags for two samples', () => {
    // The selected flag set 0x000701 combines 0x000001 (data_offset_present),
    // 0x000100 (sample_duration_present), 0x000200 (sample_size_present), and
    // 0x000400 (sample_flags_present). Payload shape after the FullBox header:
    // sample_count (u32) + data_offset (i32) + per sample: duration (u32), size (u32), flags (u32).
    const trun = createTrun({
      dataOffset: 123,
      samples: [
        { duration: 3000, size: 200, flags: encodeTrunSampleFlags(true) },
        { duration: 3000, size: 150, flags: encodeTrunSampleFlags(false) },
      ],
    })
    const boxWriter = new Writer()
    writeBox(boxWriter, trun)
    const bytes = boxWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trun')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(9)).toBe(0x00)
    expect(dataView.getUint8(10)).toBe(0x07)
    expect(dataView.getUint8(11)).toBe(0x01)
    expect(dataView.getUint32(12, false)).toBe(2)
    expect(dataView.getInt32(16, false)).toBe(123)
    expect(dataView.getUint32(20, false)).toBe(3000)
    expect(dataView.getUint32(24, false)).toBe(200)
    expect(dataView.getUint32(28, false)).toBe(0x02000000)
    expect(dataView.getUint32(32, false)).toBe(3000)
    expect(dataView.getUint32(36, false)).toBe(150)
    expect(dataView.getUint32(40, false)).toBe(0x01010000)
  })
})

describe('createTraf', () => {
  it('emits a traf container with tfhd, tfdt, and trun in that order', () => {
    const tfhd = createTfhd({ trackId: 1 })
    const tfdt = createTfdt({ baseMediaDecodeTimeInTrackTimescale: 0n })
    const trun = createTrun({
      dataOffset: 0,
      samples: [{ duration: 3000, size: 100, flags: encodeTrunSampleFlags(true) }],
    })
    const traf = createTraf({ tfhd, tfdt, trun })
    const boxWriter = new Writer()
    writeBox(boxWriter, traf)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    const tfhdPosition = bodyText.indexOf('tfhd')
    const tfdtPosition = bodyText.indexOf('tfdt')
    const trunPosition = bodyText.indexOf('trun')
    expect(tfhdPosition).toBeGreaterThan(0)
    expect(tfdtPosition).toBeGreaterThan(tfhdPosition)
    expect(trunPosition).toBeGreaterThan(tfdtPosition)
  })
})

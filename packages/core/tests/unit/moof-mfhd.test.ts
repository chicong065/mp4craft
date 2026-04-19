import { writeBox, type Box } from '@/boxes/box'
import { createMfhd } from '@/boxes/mfhd'
import { createMoof } from '@/boxes/moof'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('createMfhd', () => {
  it('emits an mfhd FullBox carrying the sequence number as a u32', () => {
    // Per ISO/IEC 14496-12 §8.8.5, the mfhd payload after the FullBox header is a single u32.
    // Box layout from the start: size (u32) + fourcc (4) + version (u8) + flags (u24) + sequence_number (u32).
    const mfhd = createMfhd({ sequenceNumber: 7 })
    const boxWriter = new Writer()
    writeBox(boxWriter, mfhd)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 4)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mfhd')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(0)
    expect(dataView.getUint32(12, false)).toBe(7)
  })
})

describe('createMoof', () => {
  it('writes mfhd followed by each traf', () => {
    const mfhd = createMfhd({ sequenceNumber: 1 })
    const trafStub: Box = { type: 'traf', write: () => undefined }
    const moof = createMoof({ mfhd, trafs: [trafStub, trafStub] })
    const boxWriter = new Writer()
    writeBox(boxWriter, moof)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    expect(bodyText.indexOf('moof')).toBe(4)
    expect(bodyText.indexOf('mfhd')).toBeGreaterThan(8)
    const firstTrafIndex = bodyText.indexOf('traf')
    expect(firstTrafIndex).toBeGreaterThan(bodyText.indexOf('mfhd'))
    const secondTrafIndex = bodyText.indexOf('traf', firstTrafIndex + 4)
    expect(secondTrafIndex).toBeGreaterThan(firstTrafIndex)
  })
})

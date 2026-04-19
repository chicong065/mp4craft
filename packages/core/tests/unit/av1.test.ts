import { createAv1c } from '@/boxes/av1c'
import { writeBox } from '@/boxes/box'
import { Av1Codec } from '@/codecs/video/av1'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

// Minimal AV1CodecConfigurationRecord payload (4 bytes) per AV1 ISOBMFF §2.3:
//   byte 0: marker (1 bit) = 1, version (7 bits) = 1  packed as 0x81
//   byte 1: seq_profile (3 bits) = 0, seq_level_idx_0 (5 bits) = 0 packed as 0x00
//   byte 2: seq_tier_0 (1) = 0, high_bitdepth (1) = 0, twelve_bit (1) = 0, monochrome (1) = 0,
//           chroma_subsampling_x (1) = 1, chroma_subsampling_y (1) = 1, chroma_sample_position (2) = 0
//           packed as 0x0c
//   byte 3: reserved (3) = 0, initial_presentation_delay_present (1) = 0, reserved (4) = 0 packed as 0x00
// This is structural scaffolding for testing box serialization. It is not a decodable AV1 stream.
const minimalAv1ConfigurationRecord = new Uint8Array([0x81, 0x00, 0x0c, 0x00])

describe('createAv1c', () => {
  it('emits an av1C plain Box whose body equals the supplied payload bytes', () => {
    // Per AV1 ISOBMFF §2.3, av1C is not a FullBox. Its body IS the AV1CodecConfigurationRecord,
    // whose first byte already carries the marker and version, so no outer FullBox header is written.
    // Box layout: size (u32) + fourcc "av1C" (4) + payload (N). Total = 8 + N bytes.
    const av1c = createAv1c(minimalAv1ConfigurationRecord)
    const boxWriter = new Writer()
    writeBox(boxWriter, av1c)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(8 + minimalAv1ConfigurationRecord.length)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('av1C')
    expect(bytes[8]).toBe(0x81)
    expect(bytes[9]).toBe(0x00)
    expect(bytes[10]).toBe(0x0c)
    expect(bytes[11]).toBe(0x00)
  })
})

describe('Av1Codec', () => {
  it('createSampleEntry produces an av01 box containing an av1C child', () => {
    const codec = new Av1Codec(minimalAv1ConfigurationRecord.buffer, 1920, 1080)
    expect(codec.kind).toBe('video')
    expect(codec.fourcc).toBe('av01')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('av01')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'av1C')).toBeGreaterThan(-1)
  })

  it('encodes width and height into the visual sample entry', () => {
    const codec = new Av1Codec(minimalAv1ConfigurationRecord.buffer, 1920, 1080)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Per ISO/IEC 14496-12 §12.1.3, a VisualSampleEntry places width at byte 32 and height
    // at byte 34 of the serialized box.
    expect(dataView.getUint16(32, false)).toBe(1920)
    expect(dataView.getUint16(34, false)).toBe(1080)
  })
})

function findFourcc(bytes: Uint8Array, fourcc: string): number {
  const codePoints = fourcc.split('').map((character) => character.charCodeAt(0))
  for (let byteIndex = 0; byteIndex <= bytes.length - 4; byteIndex++) {
    if (
      bytes[byteIndex] === codePoints[0] &&
      bytes[byteIndex + 1] === codePoints[1] &&
      bytes[byteIndex + 2] === codePoints[2] &&
      bytes[byteIndex + 3] === codePoints[3]
    ) {
      return byteIndex
    }
  }
  return -1
}

import { writeBox } from '@/boxes/box'
import { HevcCodec } from '@/codecs/video/hevc'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

// Minimal HEVCDecoderConfigurationRecord containing just the configurationVersion byte (0x01).
// This is structural scaffolding for testing box serialization. It is not a decodable HEVC stream.
const minimalHvcc = new Uint8Array([0x01])

describe('HevcCodec', () => {
  it('createSampleEntry produces hvc1 box containing hvcC child', () => {
    const codec = new HevcCodec(minimalHvcc.buffer, 1280, 720)
    expect(codec.kind).toBe('video')
    expect(codec.fourcc).toBe('hvc1')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('hvc1')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'hvcC')).toBeGreaterThan(-1)
  })

  it('encodes width and height into the visual sample entry', () => {
    const codec = new HevcCodec(minimalHvcc.buffer, 1280, 720)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // VisualSampleEntry layout, measured from the start of the serialized box
    // (ISO/IEC 14496-12 §12.1.3):
    //   size (u32) + fourcc (4) + reserved (6) + data_reference_index (u16) + pre_defined (u16)
    //   + reserved (u16) + pre_defined[3] (12) + width (u16) + height (u16).
    // Width therefore begins at byte 32, height at byte 34.
    expect(dataView.getUint16(32, false)).toBe(1280)
    expect(dataView.getUint16(34, false)).toBe(720)
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

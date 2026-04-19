import { writeBox } from '@/boxes/box'
import { Mp3Codec } from '@/codecs/audio/mp3'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('Mp3Codec', () => {
  it('kind is audio and fourcc is mp4a', () => {
    const codec = new Mp3Codec({ channels: 2, sampleRate: 44100 })
    expect(codec.kind).toBe('audio')
    expect(codec.fourcc).toBe('mp4a')
  })

  it('createSampleEntry emits an mp4a AudioSampleEntry with channelcount at byte 24 and samplerate at byte 32', () => {
    const codec = new Mp3Codec({ channels: 2, sampleRate: 44100 })
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('mp4a')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer, entryBytes.byteOffset, entryBytes.byteLength)
    // Per ISO/IEC 14496-12 §12.2.3, channelcount sits at byte 24 and samplerate
    // in 16.16 fixed-point sits at byte 32 of the serialized AudioSampleEntry box.
    expect(dataView.getUint16(24, false)).toBe(2)
    expect(dataView.getUint32(32, false)).toBe(44100 * 0x10000)
  })

  it('esds declares objectTypeIndication 0x6B (MPEG-1 Audio)', () => {
    const codec = new Mp3Codec({ channels: 2, sampleRate: 44100 })
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    // The esds FullBox nests an ES_Descriptor (tag 0x03) which contains a
    // DecoderConfigDescriptor (tag 0x04). Inside the DecoderConfigDescriptor, the first
    // body byte is objectTypeIndication. The tag sequence uniquely locates the byte,
    // so scan for tag 0x04 and verify the next byte after the 4-byte descriptor length
    // is 0x6B.
    const tagZeroFourPosition = findFirstByteValue(entryBytes, 0x04)
    expect(tagZeroFourPosition).toBeGreaterThan(-1)
    // DecoderConfigDescriptor layout after its tag: 4-byte extended length, then
    // objectTypeIndication (u8). So the OTI byte is at tagPosition + 1 + 4.
    expect(entryBytes[tagZeroFourPosition + 5]).toBe(0x6b)
  })

  it('esds omits the DecoderSpecificInfo descriptor (tag 0x05) entirely', () => {
    const codec = new Mp3Codec({ channels: 2, sampleRate: 44100 })
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    // A tag-0x05 byte would only ever appear inside the esds as a DecoderSpecificInfo
    // descriptor. mp4craft Mp3Codec must omit it because MP3 derives all decoder
    // parameters from the bitstream and carries no out-of-band configuration.
    expect(findFirstByteValue(entryBytes, 0x05)).toBe(-1)
  })
})

function findFirstByteValue(bytes: Uint8Array, value: number): number {
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    if (bytes[byteIndex] === value) return byteIndex
  }
  return -1
}

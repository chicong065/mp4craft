import { writeBox } from '@/boxes/box'
import { OpusCodec } from '@/codecs/audio/opus'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

// Minimal OpusSpecificBox payload (the `dOps` body, 11 bytes), per the Opus-in-ISOBMFF
// encapsulation specification (https://opus-codec.org/docs/opus_in_isobmff.html §4.3.2):
//   Version                      (u8)  = 0
//   OutputChannelCount           (u8)  = 2    (stereo)
//   PreSkip                      (u16) = 0
//   InputSampleRate              (u32) = 48000 (big-endian: 0x0000BB80)
//   OutputGain                   (i16) = 0
//   ChannelMappingFamily         (u8)  = 0    (RTP mapping, no extra fields follow)
const minimalDopsPayload = new Uint8Array([0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0xbb, 0x80, 0x00, 0x00, 0x00])

describe('OpusCodec', () => {
  it('createSampleEntry produces an Opus box containing a dOps child', () => {
    const codec = new OpusCodec({
      description: minimalDopsPayload.buffer,
      channels: 2,
      sampleRate: 48000,
    })
    expect(codec.kind).toBe('audio')
    expect(codec.fourcc).toBe('Opus')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('Opus')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'dOps')).toBeGreaterThan(-1)
  })

  it('hardcodes the samplerate field to 48000 Hz in 16.16 fixed-point, per ISO/IEC 23003-5', () => {
    const codec = new OpusCodec({
      description: minimalDopsPayload.buffer,
      channels: 2,
      sampleRate: 44100,
    })
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Per ISO/IEC 14496-12 §12.2.3, AudioSampleEntry places samplerate at byte 32, measured
    // from the start of the serialized box. 48000 encoded as 16.16 fixed-point is 0xBB800000.
    expect(dataView.getUint32(32, false)).toBe(0xbb800000)
  })

  it('writes the channel count into the audio sample entry', () => {
    const codec = new OpusCodec({
      description: minimalDopsPayload.buffer,
      channels: 2,
      sampleRate: 48000,
    })
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Per ISO/IEC 14496-12 §12.2.3, AudioSampleEntry places channelcount at byte 24 of the
    // serialized box (after size, fourcc, reserved, data_reference_index, and reserved).
    expect(dataView.getUint16(24, false)).toBe(2)
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

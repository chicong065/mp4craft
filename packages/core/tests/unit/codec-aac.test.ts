import { writeBox } from '@/boxes/box'
import { AacCodec } from '@/codecs/audio/aac'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('AacCodec', () => {
  it('creates mp4a entry containing esds with the supplied AudioSpecificConfig', () => {
    const audioSpecificConfig = new Uint8Array([0x12, 0x10])
    const codec = new AacCodec({
      description: audioSpecificConfig,
      channels: 2,
      sampleRate: 44100,
    })
    const outputWriter = new Writer()
    writeBox(outputWriter, codec.createSampleEntry())
    const bytes = outputWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mp4a')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('esds')).toBeGreaterThan(0)
    expect(indexOfBytes(bytes, audioSpecificConfig)).toBeGreaterThan(0)
  })

  it('writes channelcount and sampleRate at the correct byte offsets in AudioSampleEntry', () => {
    const audioSpecificConfig = new Uint8Array([0x12, 0x10])
    const codec = new AacCodec({
      description: audioSpecificConfig,
      channels: 6,
      sampleRate: 48000,
    })
    const outputWriter = new Writer()
    writeBox(outputWriter, codec.createSampleEntry())
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // Per ISO/IEC 14496-12 §12.2.3, the AudioSampleEntry layout places channelcount at byte 24:
    //   8 (box header) + 6 (reserved) + 2 (data_reference_index) + 8 (reserved) = 24.
    expect(dataView.getUint16(24, false)).toBe(6)
    // The samplerate field follows at byte 32:
    //   24 + 2 (channelcount) + 2 (samplesize) + 2 (pre_defined) + 2 (reserved) = 32.
    expect(dataView.getUint32(32, false)).toBe(48000 * 0x10000)
  })
})

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let haystackIndex = 0; haystackIndex + needle.length <= haystack.length; haystackIndex++) {
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex++) {
      if (haystack[haystackIndex + needleIndex] !== needle[needleIndex]) continue outer
    }
    return haystackIndex
  }
  return -1
}

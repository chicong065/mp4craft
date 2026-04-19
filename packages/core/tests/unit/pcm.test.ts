import { writeBox } from '@/boxes/box'
import { createPcmc } from '@/boxes/pcmc'
import { PcmCodec } from '@/codecs/audio/pcm'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('createPcmc', () => {
  it('emits a 14-byte pcmC FullBox with format_flags=1 and sample_size=16 for little-endian 16-bit', () => {
    // Per ISO/IEC 23003-5, the pcmC body is format_flags (u8) then PCM_sample_size (u8).
    // Little-endian sets bit 0 of format_flags, producing 0x01.
    // Box layout from start: size (u32) + fourcc "pcmC" (4) + version (u8) + flags (u24) + body (2).
    const pcmc = createPcmc({ endianness: 'little', bitsPerSample: 16 })
    const boxWriter = new Writer()
    writeBox(boxWriter, pcmc)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(14)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('pcmC')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(0)
    expect(bytes[12]).toBe(0x01)
    expect(bytes[13]).toBe(16)
  })

  it('emits format_flags=0 and sample_size=24 for big-endian 24-bit', () => {
    const pcmc = createPcmc({ endianness: 'big', bitsPerSample: 24 })
    const boxWriter = new Writer()
    writeBox(boxWriter, pcmc)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(14)
    expect(bytes[12]).toBe(0x00)
    expect(bytes[13]).toBe(24)
  })
})

describe('PcmCodec', () => {
  it('kind is audio and fourcc is ipcm', () => {
    const codec = new PcmCodec({
      channels: 2,
      sampleRate: 48000,
      bitsPerSample: 16,
      endianness: 'little',
    })
    expect(codec.kind).toBe('audio')
    expect(codec.fourcc).toBe('ipcm')
  })

  it('createSampleEntry emits an ipcm AudioSampleEntry containing a pcmC child', () => {
    const codec = new PcmCodec({
      channels: 2,
      sampleRate: 48000,
      bitsPerSample: 16,
      endianness: 'little',
    })
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('ipcm')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'pcmC')).toBeGreaterThan(-1)
    const dataView = new DataView(entryBytes.buffer)
    // Per ISO/IEC 14496-12 §12.2.3, channelcount sits at byte 24, samplesize sits at byte 26,
    // and samplerate in 16.16 fixed-point sits at byte 32 of the serialized AudioSampleEntry.
    expect(dataView.getUint16(24, false)).toBe(2)
    expect(dataView.getUint16(26, false)).toBe(16)
    expect(dataView.getUint32(32, false)).toBe(48000 * 0x10000)
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

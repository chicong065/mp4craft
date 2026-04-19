import { writeBox } from '@/boxes/box'
import { createDfla } from '@/boxes/dfla'
import { FlacCodec } from '@/codecs/audio/flac'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

// Minimal STREAMINFO metadata block for FLAC-in-ISOBMFF testing (38 bytes total).
// Per https://xiph.org/flac/format.html#metadata_block_streaminfo the block data is
// 34 bytes. Per https://github.com/xiph/flac/blob/master/doc/isoflac.txt the dfLa body
// is a sequence of metadata blocks, each prefixed with a 4-byte header.
//   byte 0: last-metadata-block flag (1 bit) = 1, BLOCK_TYPE (7 bits) = 0 (STREAMINFO) packed as 0x80.
//   bytes 1 through 3: LENGTH (u24) = 34 packed as 0x00 0x00 0x22.
//   bytes 4 through 37: 34 bytes of STREAMINFO block data, left as zeros (min/max block size,
//                       frame sizes, packed sample rate and channels and bit-depth, total samples,
//                       16-byte MD5 signature).
// This is structural scaffolding for testing box serialization. It is not a decodable FLAC stream.
const minimalFlacMetadataBlocks = new Uint8Array(38)
minimalFlacMetadataBlocks[0] = 0x80
minimalFlacMetadataBlocks[3] = 0x22

describe('createDfla', () => {
  it('emits a version-0 dfLa FullBox whose body equals the supplied metadata blocks', () => {
    // Per FLAC in ISOBMFF, dfLa is a FullBox. Serialized layout from the box start is
    // size (u32) + fourcc "dfLa" (4) + version (u8) + flags (u24) + metadata-block body.
    // Total = 12 + blocksByteLength.
    const dfla = createDfla(minimalFlacMetadataBlocks)
    const boxWriter = new Writer()
    writeBox(boxWriter, dfla)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(12 + minimalFlacMetadataBlocks.length)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('dfLa')
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dataView.getUint8(8)).toBe(0)
    expect(bytes[12]).toBe(0x80)
    expect(bytes[13]).toBe(0x00)
    expect(bytes[14]).toBe(0x00)
    expect(bytes[15]).toBe(0x22)
  })
})

describe('FlacCodec', () => {
  it('kind is audio and fourcc is fLaC', () => {
    const codec = new FlacCodec({
      description: minimalFlacMetadataBlocks.buffer,
      channels: 2,
      sampleRate: 48000,
    })
    expect(codec.kind).toBe('audio')
    expect(codec.fourcc).toBe('fLaC')
  })

  it('createSampleEntry emits an fLaC AudioSampleEntry containing a dfLa child', () => {
    const codec = new FlacCodec({
      description: minimalFlacMetadataBlocks.buffer,
      channels: 2,
      sampleRate: 48000,
    })
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('fLaC')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'dfLa')).toBeGreaterThan(-1)
    const dataView = new DataView(entryBytes.buffer, entryBytes.byteOffset, entryBytes.byteLength)
    // Per ISO/IEC 14496-12 §12.2.3, channelcount sits at byte 24 and samplerate in 16.16
    // fixed-point sits at byte 32 of the serialized AudioSampleEntry box.
    expect(dataView.getUint16(24, false)).toBe(2)
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

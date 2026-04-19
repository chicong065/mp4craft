import { writeBox } from '@/boxes/box'
import { Vp9Codec } from '@/codecs/video/vp9'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

// Minimal VPCodecConfigurationRecord payload (the vpcC box body, 8 bytes),
// per the VP9 ISOBMFF binding specification §2.2:
//   profile                   (u8)  = 0
//   level                     (u8)  = 41   (VP9 level 4.1)
//   bitDepth:4 | chromaSubsampling:3 | videoFullRangeFlag:1  packed into u8 = 0x10
//     (bitDepth = 8, chromaSubsampling = 1 (4:2:0 vertical), videoFullRangeFlag = 0)
//   colourPrimaries           (u8)  = 1    (BT.709)
//   transferCharacteristics   (u8)  = 1    (BT.709)
//   matrixCoefficients        (u8)  = 1    (BT.709)
//   codecInitializationDataSize (u16) = 0  (VP9 carries no inline init data).
const minimalVpccPayload = new Uint8Array([0x00, 0x29, 0x10, 0x01, 0x01, 0x01, 0x00, 0x00])

describe('Vp9Codec', () => {
  it('createSampleEntry produces vp09 box containing vpcC child FullBox', () => {
    const codec = new Vp9Codec(minimalVpccPayload.buffer, 1920, 1080)
    expect(codec.kind).toBe('video')
    expect(codec.fourcc).toBe('vp09')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('vp09')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'vpcC')).toBeGreaterThan(-1)
  })

  it('encodes width and height into the visual sample entry', () => {
    const codec = new Vp9Codec(minimalVpccPayload.buffer, 1920, 1080)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Per ISO/IEC 14496-12 §12.1.3, a VisualSampleEntry places width at byte 32 and height at byte 34,
    // measured from the start of the serialized box (the size field).
    expect(dataView.getUint16(32, false)).toBe(1920)
    expect(dataView.getUint16(34, false)).toBe(1080)
  })

  it('vpcC child is a FullBox (version=1, flags=0)', () => {
    const codec = new Vp9Codec(minimalVpccPayload.buffer, 1920, 1080)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const vpcCFourccPosition = findFourcc(entryBytes, 'vpcC')
    expect(vpcCFourccPosition).toBeGreaterThan(-1)
    const dataView = new DataView(entryBytes.buffer)
    // Per ISO/IEC 14496-12 §4.2, a FullBox places its version (u8) and flags (u24)
    // immediately after the 4-byte fourcc.
    const versionAndFlagsPosition = vpcCFourccPosition + 4
    expect(dataView.getUint8(versionAndFlagsPosition)).toBe(1)
    expect(dataView.getUint8(versionAndFlagsPosition + 1)).toBe(0)
    expect(dataView.getUint8(versionAndFlagsPosition + 2)).toBe(0)
    expect(dataView.getUint8(versionAndFlagsPosition + 3)).toBe(0)
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

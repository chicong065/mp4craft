import { writeBox, type Box } from '@/boxes/box'
import { AvcCodec } from '@/codecs/video/avc'
import { Writer } from '@/io/writer'
import { VideoTrack } from '@/tracks/video-track'
import { describe, expect, it } from 'vitest'

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640×480.
const avcc640x480 = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('VideoTrack', () => {
  it('uses width and height from TrackOptions rather than the codec', () => {
    // AvcCodec parses 640×480 from the avcC SPS. TrackOptions overrides those dimensions
    // with 1920×1080, which the test then verifies at the tkhd fixed-point fields.
    const track = new VideoTrack({
      trackId: 1,
      codec: new AvcCodec(avcc640x480.buffer),
      timescale: 90000,
      firstTimestampBehavior: 'offset',
      width: 1920,
      height: 1080,
    })
    track.appendSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 3000,
      isKeyFrame: true,
      chunkOffset: 0,
    })
    const { trak } = track.buildTrak({ movieTimescale: 1000 })
    const trakBytes = serializeBox(trak)
    const dataView = new DataView(trakBytes.buffer)
    // Per ISO/IEC 14496-12 §8.3.2, tkhd stores width and height as two consecutive u32 fields
    // in 16.16 fixed-point format, immediately after the 36-byte transformation matrix.
    const expectedWidth = 1920 * 0x10000
    const expectedHeight = 1080 * 0x10000
    let foundDimensionPair = false
    for (let byteOffset = 0; byteOffset <= trakBytes.length - 8; byteOffset++) {
      if (
        dataView.getUint32(byteOffset, false) === expectedWidth &&
        dataView.getUint32(byteOffset + 4, false) === expectedHeight
      ) {
        foundDimensionPair = true
        break
      }
    }
    expect(foundDimensionPair).toBe(true)
  })

  it('buildTrak shifts chunk offsets by chunkOffsetBase', () => {
    const track = new VideoTrack({
      trackId: 1,
      codec: new AvcCodec(avcc640x480.buffer),
      timescale: 90000,
      firstTimestampBehavior: 'offset',
      width: 640,
      height: 480,
    })
    track.appendSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 3000,
      isKeyFrame: true,
      chunkOffset: 50,
    })
    const { trak: trakNoBase } = track.buildTrak({ movieTimescale: 1000 })
    const { trak: trakWithBase } = track.buildTrak({ movieTimescale: 1000, chunkOffsetBase: 500 })
    expect(readFirstStcoOffset(serializeBox(trakNoBase))).toBe(50)
    expect(readFirstStcoOffset(serializeBox(trakWithBase))).toBe(550)
  })
})

function serializeBox(box: Box): Uint8Array {
  const boxWriter = new Writer()
  writeBox(boxWriter, box)
  return boxWriter.toBytes()
}

function readFirstStcoOffset(bytes: Uint8Array): number {
  // stco (ChunkOffsetBox) FullBox layout, per ISO/IEC 14496-12 §8.7.5, measured from the box start:
  //   size (u32) + fourcc "stco" (4) + version (u8) + flags (u24) + entry_count (u32) + offsets[] (u32 each).
  // The first offset entry therefore begins 16 bytes into the box.
  for (let index = 4; index < bytes.length - 3; index++) {
    if (bytes[index] === 0x73 && bytes[index + 1] === 0x74 && bytes[index + 2] === 0x63 && bytes[index + 3] === 0x6f) {
      const stcoBoxStart = index - 4
      return new DataView(bytes.buffer).getUint32(stcoBoxStart + 16, false)
    }
  }
  throw new Error('stco box not found')
}

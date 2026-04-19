import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { createFile, type Movie, MP4BoxBuffer } from 'mp4box'
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

describe('integration: MP4Box.js validates mp4craft AV1 in-memory output', () => {
  it('produces an AV1 file whose av01 sample entry parses back cleanly', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      video: {
        codec: 'av1',
        width: 320,
        height: 240,
        description: minimalAv1ConfigurationRecord,
      },
    })

    muxer.addVideoSample({
      data: new Uint8Array(32),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(32),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec.startsWith('av01')).toBe(true)
    expect(parsedInfo.tracks[0]!.nb_samples).toBe(2)
  })
})

/**
 * Parses an MP4 byte buffer with mp4box.js (v2.3.0) and resolves with the `Movie` info
 * returned by `onReady`.
 *
 * mp4box.js v2.3.0's `onError` signature takes `(module, message)` rather than a single
 * `Error`. This helper folds the two arguments into a single thrown `Error` so the caller
 * sees a standard promise rejection.
 *
 * @param mp4Bytes - The complete serialized MP4 container as an `ArrayBuffer`.
 * @returns A promise that resolves to the parsed `Movie` metadata.
 */
function parseWithMp4Box(mp4Bytes: ArrayBuffer): Promise<Movie> {
  return new Promise<Movie>((promiseResolve, promiseReject) => {
    const mp4File = createFile()
    mp4File.onReady = promiseResolve
    mp4File.onError = (errorModule: string, errorMessage: string) =>
      promiseReject(new Error(`mp4box parse error [${errorModule}]: ${errorMessage}`))
    const inputBuffer = MP4BoxBuffer.fromArrayBuffer(mp4Bytes, 0)
    mp4File.appendBuffer(inputBuffer)
    mp4File.flush()
  })
}

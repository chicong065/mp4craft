import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { createFile, type Movie, MP4BoxBuffer } from 'mp4box'
import { describe, expect, it } from 'vitest'

describe('integration: MP4Box.js validates mp4craft MP3 in-memory output', () => {
  it('produces an MP3 file whose mp4a sample entry parses back cleanly', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      audio: { codec: 'mp3', channels: 2, sampleRate: 44100 },
    })

    // Two samples of 417 zero bytes each, matching a typical 128 kbps 44100 Hz MP3 frame size.
    muxer.addAudioSample({
      data: new Uint8Array(417),
      timestamp: 0,
      duration: 26_122,
      isKeyFrame: true,
    })
    muxer.addAudioSample({
      data: new Uint8Array(417),
      timestamp: 26_122,
      duration: 26_122,
      isKeyFrame: true,
    })
    await muxer.finalize()

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec.startsWith('mp4a')).toBe(true)
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

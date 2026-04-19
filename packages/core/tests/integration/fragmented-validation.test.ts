import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'
import { createFile, type Movie, MP4BoxBuffer } from 'mp4box'
import { describe, expect, it } from 'vitest'

const fixturesDirectory = resolve(fileURLToPath(new URL('../fixtures', import.meta.url)))

const keyFrameBytes = readFileSync(resolve(fixturesDirectory, 'avc-key-frame.bin'))
const deltaFrameBytes = readFileSync(resolve(fixturesDirectory, 'avc-delta-frame.bin'))
const avccBytes = readFileSync(resolve(fixturesDirectory, 'avcc.bin'))

describe('integration: MP4Box.js validates mp4craft fragmented output', () => {
  it('parses a fragmented AVC file with the expected track and sample counts', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 320, height: 240, description: avccBytes, timescale: 90000 },
    })

    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrameBytes),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(deltaFrameBytes),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrameBytes),
      timestamp: 66_666,
      duration: 33_333,
      isKeyFrame: true,
    })

    await muxer.finalize()

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec).toMatch(/^avc1/)
    expect(parsedInfo.isFragmented).toBe(true)
    expect(parsedInfo.tracks[0]!.nb_samples).toBeGreaterThanOrEqual(3)
  })
})

/**
 * Parses an MP4 byte buffer with mp4box.js (v2.3.0) and resolves with the `Movie` info
 * returned by `onReady`. mp4box v2.3.0's `onError` signature is `(module, message)`. This
 * helper folds the two arguments into a single thrown `Error`.
 *
 * @param mp4Bytes - The serialized MP4 bytes to parse.
 * @returns A promise that resolves with the parsed `Movie` metadata.
 * @throws Error When mp4box.js reports a parse error via `onError`.
 *
 * @see {@link https://github.com/gpac/mp4box.js/blob/master/README.md | mp4box.js README}
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

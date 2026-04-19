import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'
import { createFile, type Movie, MP4BoxBuffer } from 'mp4box'
import { describe, expect, it } from 'vitest'

const fixturesDir = resolve(fileURLToPath(new URL('../fixtures', import.meta.url)))

const keyFrameBytes = readFileSync(resolve(fixturesDir, 'avc-key-frame.bin'))
const deltaFrameBytes = readFileSync(resolve(fixturesDir, 'avc-delta-frame.bin'))
const avccBytes = readFileSync(resolve(fixturesDir, 'avcc.bin'))

describe('integration: MP4Box.js validates mp4craft output', () => {
  it('parses a progressive AVC file back without errors', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
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
    await muxer.finalize()

    const parsedInfo = await new Promise<Movie>((promiseResolve, promiseReject) => {
      const mp4File = createFile()
      mp4File.onReady = promiseResolve
      // mp4box v2.3.0 passes two arguments (module, message) to onError. Fold them into a
      // single Error so the caller sees a standard promise rejection.
      mp4File.onError = (errorModule: string, errorMessage: string) =>
        promiseReject(new Error(`mp4box parse error [${errorModule}]: ${errorMessage}`))
      const outputBuffer = MP4BoxBuffer.fromArrayBuffer(target.buffer, 0)
      mp4File.appendBuffer(outputBuffer)
      mp4File.flush()
    })

    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec).toMatch(/^avc1/)
    expect(parsedInfo.tracks[0]!.nb_samples).toBe(2)
  })
})

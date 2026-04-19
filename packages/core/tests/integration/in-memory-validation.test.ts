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

describe('integration: MP4Box.js validates mp4craft in-memory output', () => {
  it('produces an AVC file where moov precedes mdat and parses back cleanly', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
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

    // An in-memory file has layout ftyp + moov + mdat, so moov must appear at a lower byte
    // offset than mdat in the raw stream.
    const outputBytes = new Uint8Array(target.buffer)
    const latin1Text = new TextDecoder('latin1').decode(outputBytes)
    const moovPosition = latin1Text.indexOf('moov')
    const mdatPosition = latin1Text.indexOf('mdat')
    expect(moovPosition).toBeGreaterThan(0)
    expect(mdatPosition).toBeGreaterThan(0)
    expect(moovPosition).toBeLessThan(mdatPosition)

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec).toMatch(/^avc1/)
    expect(parsedInfo.tracks[0]!.nb_samples).toBe(2)
  })

  it('produces an audio-only in-memory file that parses as one mp4a track', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      audio: {
        codec: 'aac',
        description: new Uint8Array([0x12, 0x10]),
        channels: 2,
        sampleRate: 44100,
      },
    })

    muxer.addAudioSample({
      data: new Uint8Array(500),
      timestamp: 0,
      duration: 23_000,
      isKeyFrame: true,
    })
    muxer.addAudioSample({
      data: new Uint8Array(500),
      timestamp: 23_000,
      duration: 23_000,
      isKeyFrame: true,
    })
    await muxer.finalize()

    const outputBytes = new Uint8Array(target.buffer)
    const latin1Text = new TextDecoder('latin1').decode(outputBytes)
    expect(latin1Text.indexOf('moov')).toBeLessThan(latin1Text.indexOf('mdat'))

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec).toMatch(/^mp4a/)
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

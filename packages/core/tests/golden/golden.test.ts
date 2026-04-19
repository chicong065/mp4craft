import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'
import { describe, expect, it } from 'vitest'

describe('golden: avc-2frame.mp4', () => {
  it('byte-for-byte matches the checked-in golden file', async () => {
    const goldenDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
    const fixturesDir = resolve(goldenDir, '../fixtures')

    const keyFrameBytes = readFileSync(resolve(fixturesDir, 'avc-key-frame.bin'))
    const deltaFrameBytes = readFileSync(resolve(fixturesDir, 'avc-delta-frame.bin'))
    const avccBytes = readFileSync(resolve(fixturesDir, 'avcc.bin'))
    const goldenBytes = readFileSync(resolve(goldenDir, 'avc-2frame.mp4'))

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

    const producedBytes = Buffer.from(target.buffer)
    expect(producedBytes.length).toBe(goldenBytes.length)
    expect(producedBytes.equals(goldenBytes)).toBe(true)
  })
})

// Generates avc-2frame.mp4 from the checked-in fixture files.
// Run once when the muxer output format changes intentionally; commit the result.
// Usage: pnpm dlx tsx packages/core/tests/golden/build-golden.mts
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Mp4Muxer, ArrayBufferTarget } from '../../src/index.ts'
import { annexBToLengthPrefixed } from '../../src/io/nalu.ts'

const goldenDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(goldenDir, '../fixtures')

const keyFrameBytes = readFileSync(resolve(fixturesDir, 'avc-key-frame.bin'))
const deltaFrameBytes = readFileSync(resolve(fixturesDir, 'avc-delta-frame.bin'))
const avccBytes = readFileSync(resolve(fixturesDir, 'avcc.bin'))

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

writeFileSync(resolve(goldenDir, 'avc-2frame.mp4'), Buffer.from(target.buffer))
console.log(`Written: avc-2frame.mp4 (${target.buffer.byteLength} bytes)`)

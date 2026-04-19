import { Mp4Muxer } from '@/muxer/mp4-muxer'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { StreamTarget } from '@/targets/stream-target'
import { StateError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640x480.
const avcc = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('Mp4Muxer (fragmented)', () => {
  it('writes ftyp, then an empty moov with an mvex child, and emits a moof per flush', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 66_666,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const outputBytes = new Uint8Array(target.buffer)
    const latin1Text = new TextDecoder('latin1').decode(outputBytes)
    expect(latin1Text.indexOf('ftyp')).toBe(4)
    const moovPosition = latin1Text.indexOf('moov')
    expect(moovPosition).toBeGreaterThan(0)
    expect(latin1Text.indexOf('mvex', moovPosition)).toBeGreaterThan(moovPosition)
    const firstMoof = latin1Text.indexOf('moof')
    expect(firstMoof).toBeGreaterThan(moovPosition)
    const secondMoof = latin1Text.indexOf('moof', firstMoof + 4)
    expect(secondMoof).toBeGreaterThan(firstMoof)
  })

  it('works with StreamTarget because every write is sequential', async () => {
    const receivedChunks: Uint8Array[] = []
    const muxer = new Mp4Muxer({
      target: new StreamTarget({
        onData: ({ data }) => {
          receivedChunks.push(new Uint8Array(data))
        },
      }),
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const totalBytes = receivedChunks.reduce((runningTotal, chunk) => runningTotal + chunk.length, 0)
    const mergedBytes = new Uint8Array(totalBytes)
    let writePosition = 0
    for (const chunk of receivedChunks) {
      mergedBytes.set(chunk, writePosition)
      writePosition += chunk.length
    }
    const latin1Text = new TextDecoder('latin1').decode(mergedBytes)
    expect(latin1Text.indexOf('ftyp')).toBe(4)
    expect(latin1Text.indexOf('moov')).toBeGreaterThan(0)
    expect(latin1Text.indexOf('moof')).toBeGreaterThan(latin1Text.indexOf('moov'))
  })

  it('flushes remaining samples on finalize even if no new keyframe arrived', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 10_000_000,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    await muxer.finalize()
    const outputBytes = new Uint8Array(target.buffer)
    const latin1Text = new TextDecoder('latin1').decode(outputBytes)
    expect(latin1Text.indexOf('moof')).toBeGreaterThan(0)
  })

  it('blocks addSample calls after finalize', async () => {
    const muxer = new Mp4Muxer({
      target: new ArrayBufferTarget(),
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    expect(() =>
      muxer.addVideoSample({
        data: new Uint8Array(100),
        timestamp: 33_333,
        duration: 33_333,
        isKeyFrame: false,
      })
    ).toThrow(StateError)
  })
})

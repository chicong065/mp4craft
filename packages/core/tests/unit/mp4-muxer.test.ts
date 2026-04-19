import { Mp4Muxer } from '@/muxer/mp4-muxer'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { StreamTarget } from '@/targets/stream-target'
import { ConfigError, StateError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640×480, matching the dimensions
// that AvcCodec parses from the SPS inside this record.
const avcc = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('Mp4Muxer (progressive)', () => {
  it('throws ConfigError on StreamTarget + fastStart:false (requires seek)', () => {
    expect(
      () =>
        new Mp4Muxer({
          target: new StreamTarget({ onData: () => undefined }),
          fastStart: false,
          video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
        })
    ).toThrow(ConfigError)
  })

  it('produces a non-empty buffer for a 2-frame video-only file', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(200),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(150),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    await muxer.finalize()
    const bytes = new Uint8Array(target.buffer)
    expect(bytes.length).toBeGreaterThan(500)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('mdat')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeGreaterThan(text.indexOf('mdat'))
  })

  it('blocks addSample after finalize', async () => {
    const muxer = new Mp4Muxer({
      target: new ArrayBufferTarget(),
      fastStart: false,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(10),
      timestamp: 0,
      duration: 1000,
      isKeyFrame: true,
    })
    await muxer.finalize()
    expect(() =>
      muxer.addVideoSample({
        data: new Uint8Array(10),
        timestamp: 2000,
        duration: 1000,
        isKeyFrame: true,
      })
    ).toThrow(StateError)
  })

  it('supports audio-only files', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
      audio: {
        codec: 'aac',
        description: new Uint8Array([0x12, 0x10]),
        channels: 2,
        sampleRate: 44100,
        timescale: 44100,
      },
    })
    muxer.addAudioSample({
      data: new Uint8Array(500),
      timestamp: 0,
      duration: 23000,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const bytes = new Uint8Array(target.buffer)
    expect(bytes.length).toBeGreaterThan(0)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('mdat')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeGreaterThan(text.indexOf('mdat'))
  })
})

describe('Mp4Muxer (in-memory)', () => {
  it('places moov before mdat', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(200),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const bytes = new Uint8Array(target.buffer)
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('ftyp')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeGreaterThan(-1)
    expect(text.indexOf('mdat')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
  })

  it('works with StreamTarget (sequential writes only)', async () => {
    const collectedChunks: Uint8Array[] = []
    const muxer = new Mp4Muxer({
      target: new StreamTarget({
        onData: ({ data }) => {
          collectedChunks.push(new Uint8Array(data))
        },
      }),
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(200),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const totalBytes = collectedChunks.reduce((runningTotal, chunk) => runningTotal + chunk.length, 0)
    const mergedBytes = new Uint8Array(totalBytes)
    let writePosition = 0
    for (const chunk of collectedChunks) {
      mergedBytes.set(chunk, writePosition)
      writePosition += chunk.length
    }
    const text = new TextDecoder('latin1').decode(mergedBytes)
    expect(text.indexOf('ftyp')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeGreaterThan(-1)
    expect(text.indexOf('mdat')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
  })

  it('blocks addSample after finalize', async () => {
    const muxer = new Mp4Muxer({
      target: new ArrayBufferTarget(),
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(10),
      timestamp: 0,
      duration: 1000,
      isKeyFrame: true,
    })
    await muxer.finalize()
    expect(() =>
      muxer.addVideoSample({
        data: new Uint8Array(10),
        timestamp: 2000,
        duration: 1000,
        isKeyFrame: true,
      })
    ).toThrow(StateError)
  })
})

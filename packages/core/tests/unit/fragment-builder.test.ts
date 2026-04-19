import { FragmentBuilder } from '@/muxer/fragment-builder'
import { describe, expect, it } from 'vitest'

describe('FragmentBuilder', () => {
  const trackSpecs = [
    { trackId: 1, timescale: 90000, isVideo: true },
    { trackId: 2, timescale: 48000, isVideo: false },
  ]

  it('does not flush before the minimum duration has elapsed', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 1_000_000,
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 0,
        durationMicroseconds: 33_333,
        isKeyFrame: true,
        dataByteLength: 100,
      })
    ).toBe(false)
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 500_000,
        durationMicroseconds: 33_333,
        isKeyFrame: true,
        dataByteLength: 100,
      })
    ).toBe(false)
  })

  it('flushes on a keyframe after the minimum duration has elapsed', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 1_000_000,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 1_000_001,
        durationMicroseconds: 33_333,
        isKeyFrame: true,
        dataByteLength: 100,
      })
    ).toBe(true)
  })

  it('does not flush on a non-keyframe even after the minimum duration elapsed', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 1_000_000,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 2_000_000,
        durationMicroseconds: 33_333,
        isKeyFrame: false,
        dataByteLength: 100,
      })
    ).toBe(false)
  })

  it('for audio-only files every sample is treated as a keyframe and flushes after min duration', () => {
    const audioOnlyTracks = [{ trackId: 1, timescale: 48000, isVideo: false }]
    const builder = new FragmentBuilder({
      tracks: audioOnlyTracks,
      minimumFragmentDurationMicroseconds: 500_000,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 21_333,
      isKeyFrame: true,
      data: new Uint8Array(50),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 600_000,
        durationMicroseconds: 21_333,
        isKeyFrame: true,
        dataByteLength: 50,
      })
    ).toBe(true)
  })

  it('assigns strictly increasing sequence numbers to consecutive flushes', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 0,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    const firstFlush = builder.flush()
    expect(firstFlush).not.toBeNull()
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 33_333,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    const secondFlush = builder.flush()
    expect(secondFlush).not.toBeNull()
    expect(secondFlush!.sequenceNumber).toBe(firstFlush!.sequenceNumber + 1)
  })

  it('emits an moof followed by mdat with sample bytes for a single-sample flush', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 0,
    })
    const payloadBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: payloadBytes,
    })
    const flushResult = builder.flush()
    expect(flushResult).not.toBeNull()
    const latin1Text = new TextDecoder('latin1').decode(flushResult!.bytes)
    expect(latin1Text.indexOf('moof')).toBe(4)
    const mdatTypePosition = latin1Text.indexOf('mdat')
    expect(mdatTypePosition).toBeGreaterThan(0)
    const payloadStart = mdatTypePosition + 4
    expect(flushResult!.bytes[payloadStart]).toBe(0xde)
    expect(flushResult!.bytes[payloadStart + 1]).toBe(0xad)
    expect(flushResult!.bytes[payloadStart + 2]).toBe(0xbe)
    expect(flushResult!.bytes[payloadStart + 3]).toBe(0xef)
  })

  it('returns null from flush when no samples have been appended', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 0,
    })
    expect(builder.flush()).toBeNull()
  })
})

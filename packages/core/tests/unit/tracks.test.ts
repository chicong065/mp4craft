import { writeBox } from '@/boxes/box'
import { AacCodec } from '@/codecs/audio/aac'
import { AvcCodec } from '@/codecs/video/avc'
import { Writer } from '@/io/writer'
import { AudioTrack } from '@/tracks/audio-track'
import { VideoTrack } from '@/tracks/video-track'
import { describe, expect, it } from 'vitest'

const avccBytes = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x09, 0x67, 0x42, 0xc0, 0x1e, 0xe5, 0x40, 0x50, 0x1e, 0x88, 0x01, 0x00,
  0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('Track', () => {
  it('VideoTrack records samples and produces a valid trak', () => {
    const codec = new AvcCodec(avccBytes)
    const track = new VideoTrack({
      trackId: 1,
      codec,
      timescale: 90000,
      firstTimestampBehavior: 'offset',
    })
    track.appendSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33333,
      isKeyFrame: true,
      chunkOffset: 48,
    })
    track.appendSample({
      data: new Uint8Array(80),
      timestamp: 33333,
      duration: 33333,
      isKeyFrame: false,
      chunkOffset: 148,
    })
    const { trak, durationInTimescale } = track.buildTrak({ movieTimescale: 1000 })
    expect(durationInTimescale).toBeGreaterThan(0)
    const outputWriter = new Writer()
    writeBox(outputWriter, trak)
    const bytes = outputWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trak')
  })

  it('AudioTrack records samples and produces a valid trak (no stss)', () => {
    const audioSpecificConfig = new Uint8Array([0x12, 0x10])
    const codec = new AacCodec({
      description: audioSpecificConfig,
      channels: 2,
      sampleRate: 44100,
    })
    const track = new AudioTrack({
      trackId: 2,
      codec,
      timescale: 44100,
      firstTimestampBehavior: 'offset',
    })
    track.appendSample({
      data: new Uint8Array(500),
      timestamp: 0,
      duration: 23220,
      isKeyFrame: true,
      chunkOffset: 48,
    })
    const { trak } = track.buildTrak({ movieTimescale: 1000 })
    const outputWriter = new Writer()
    writeBox(outputWriter, trak)
    const bytes = outputWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trak')
    expect(new TextDecoder('latin1').decode(bytes).indexOf('stss')).toBe(-1)
  })
})

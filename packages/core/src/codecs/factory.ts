import { AacCodec } from '@/codecs/audio/aac'
import { FlacCodec } from '@/codecs/audio/flac'
import { Mp3Codec } from '@/codecs/audio/mp3'
import { OpusCodec } from '@/codecs/audio/opus'
import { PcmCodec } from '@/codecs/audio/pcm'
import { Av1Codec } from '@/codecs/video/av1'
import { AvcCodec } from '@/codecs/video/avc'
import { HevcCodec } from '@/codecs/video/hevc'
import { Vp9Codec } from '@/codecs/video/vp9'
import { copyToOwnedArrayBuffer } from '@/io/bytes'
import type { AudioTrackConfig, MuxerOptions, VideoCodec, VideoTrackConfig } from '@/types/config'
import { assertNever } from '@/types/errors'

/**
 * Lookup from a {@link VideoCodec} discriminant to the `ftyp` compatible
 * brand the codec contributes. See MP4RA for the canonical brand strings.
 *
 * @see {@link https://mp4ra.org/registered-types/brands | MP4 Registration Authority brand registry}
 */
const VIDEO_CODEC_BRAND: Record<VideoCodec, string> = {
  avc: 'avc1',
  hevc: 'hvc1',
  vp9: 'vp09',
  av1: 'av01',
}

/**
 * Constructs the video codec adapter for the supplied track configuration.
 * Each case allocates a fresh `ArrayBuffer` for the decoder configuration
 * record so the adapter holds bytes that the caller can no longer mutate.
 *
 * @param config - Video track descriptor from {@link MuxerOptions.video}.
 * @returns The concrete codec adapter whose sample entry the muxer emits
 *   inside `stsd`.
 * @throws {@link ConfigError} When `config.codec` is a runtime value that
 *   does not match any known {@link VideoCodec} variant.
 */
export function createVideoCodec(config: VideoTrackConfig): AvcCodec | HevcCodec | Vp9Codec | Av1Codec {
  switch (config.codec) {
    case 'avc':
      return new AvcCodec(copyToOwnedArrayBuffer(config.description))
    case 'hevc':
      return new HevcCodec(copyToOwnedArrayBuffer(config.description), config.width, config.height)
    case 'vp9':
      return new Vp9Codec(copyToOwnedArrayBuffer(config.description), config.width, config.height)
    case 'av1':
      return new Av1Codec(copyToOwnedArrayBuffer(config.description), config.width, config.height)
    default:
      return assertNever(config.codec, `Unsupported video codec: ${String(config.codec)}`)
  }
}

/**
 * Constructs the audio codec adapter for the supplied track configuration.
 * Variants that carry a `description` field copy those bytes into a fresh
 * `ArrayBuffer`; codecs without a description (`mp3`, `pcm`) pass their
 * parameters through unchanged.
 *
 * @param config - Audio track descriptor from {@link MuxerOptions.audio}.
 * @returns The concrete codec adapter whose sample entry the muxer emits
 *   inside `stsd`.
 * @throws {@link ConfigError} When `config.codec` is a runtime value that
 *   does not match any known audio-codec variant.
 */
export function createAudioCodec(config: AudioTrackConfig): AacCodec | OpusCodec | Mp3Codec | FlacCodec | PcmCodec {
  const codecTag: string = config.codec
  switch (config.codec) {
    case 'aac':
      return new AacCodec({
        description: copyToOwnedArrayBuffer(config.description),
        channels: config.channels,
        sampleRate: config.sampleRate,
      })
    case 'opus':
      return new OpusCodec({
        description: copyToOwnedArrayBuffer(config.description),
        channels: config.channels,
        sampleRate: config.sampleRate,
      })
    case 'mp3':
      return new Mp3Codec({
        channels: config.channels,
        sampleRate: config.sampleRate,
      })
    case 'flac':
      return new FlacCodec({
        description: copyToOwnedArrayBuffer(config.description),
        channels: config.channels,
        sampleRate: config.sampleRate,
      })
    case 'pcm':
      return new PcmCodec({
        channels: config.channels,
        sampleRate: config.sampleRate,
        bitsPerSample: config.bitsPerSample,
        endianness: config.endianness,
      })
    default:
      return assertNever(config, `Unsupported audio codec: ${codecTag}`)
  }
}

/**
 * Builds the `ftyp` compatible-brand list for the supplied muxer options.
 * Every file carries the baseline `isom` and `iso2` brands; a configured
 * video codec contributes its corresponding MP4RA brand; the list closes
 * with `mp41` to advertise ISO BMFF version 4 compatibility.
 *
 * @param options - Muxer options carrying the video track descriptor.
 * @returns An ordered list of 4-character brand fourccs.
 */
export function computeCompatibleBrands(options: MuxerOptions): readonly string[] {
  const compatibleBrands: string[] = ['isom', 'iso2']
  if (options.video) {
    compatibleBrands.push(VIDEO_CODEC_BRAND[options.video.codec])
  }
  compatibleBrands.push('mp41')
  return compatibleBrands
}

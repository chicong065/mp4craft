/**
 * Public API barrel for `mp4craft`, a zero-dependency MP4 / ISO BMFF muxer for browsers and
 * Node.js.
 *
 * @remarks
 * Primary entry points:
 *
 * - {@link Mp4Muxer}, the orchestrator that accepts WebCodecs `EncodedVideoChunk` and
 *   `EncodedAudioChunk` inputs (or raw {@link VideoSampleInput} / {@link AudioSampleInput}
 *   samples) and produces an MP4 container.
 * - {@link ArrayBufferTarget}, an in-memory sink returning the completed file as an
 *   `ArrayBuffer` after `finalize()`.
 * - {@link StreamTarget}, a callback-driven sink for writing to arbitrary sequential
 *   destinations such as Node.js streams, Fetch request bodies, or browser download streams.
 * - {@link Target}, the minimal interface any custom sink must satisfy, including the optional
 *   `seek` method that gates progressive (non-fast-start) output.
 *
 * Error surface:
 *
 * - {@link Mp4CraftError}, the common base type for every error thrown from this package.
 * - {@link ConfigError}, {@link StateError}, {@link CodecError}, and {@link TargetError},
 *   more specific subclasses that narrow the failure mode.
 *
 * Configuration types:
 *
 * - {@link MuxerOptions}, {@link VideoTrackConfig}, {@link AudioTrackConfig}, describing the
 *   tracks and container mode.
 * - {@link VideoCodec}, {@link AudioCodec}, {@link FastStart}, narrow string-literal aliases
 *   used inside the options.
 * - {@link FirstTimestampBehavior}, the policy applied to the first sample timestamp of each
 *   track (declared in `tracks/timestamp-tracker` and re-exported here for convenience).
 *
 * @see {@link https://mp4ra.org/ | MP4 Registration Authority}
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 */

export { Mp4Muxer } from '@/muxer/mp4-muxer'
export { ArrayBufferTarget } from '@/targets/array-buffer-target'
export { StreamTarget, type StreamTargetOptions } from '@/targets/stream-target'
export { Mp4CraftError, ConfigError, StateError, CodecError, TargetError } from '@/types/errors'
export type { CodecTag } from '@/types/errors'
export type {
  MuxerOptions,
  VideoTrackConfig,
  AudioTrackConfig,
  AacAudioTrackConfig,
  OpusAudioTrackConfig,
  Mp3AudioTrackConfig,
  FlacAudioTrackConfig,
  PcmAudioTrackConfig,
  VideoCodec,
  AudioCodec,
  FastStart,
} from '@/types/config'
export type { VideoSampleInput, AudioSampleInput } from '@/types/chunk'
export type { Target } from '@/targets/target'
export type { FirstTimestampBehavior } from '@/tracks/timestamp-tracker'

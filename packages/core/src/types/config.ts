import type { Target } from '@/targets/target'
import type { FirstTimestampBehavior } from '@/tracks/timestamp-tracker'

/**
 * Supported video codec tags for {@link VideoTrackConfig.codec}.
 *
 * @remarks
 * The tag selects both the ISO BMFF sample entry fourcc written into `stsd` and the decoder
 * configuration parser applied to {@link VideoTrackConfig.description}:
 *
 * - `"avc"`, AVC / H.264. Sample entry fourcc `avc1`. Description format is
 *   `AVCDecoderConfigurationRecord` per ISO/IEC 14496-15 §5.3.3.
 * - `"hevc"`, HEVC / H.265. Sample entry fourcc `hvc1`. Description format is
 *   `HEVCDecoderConfigurationRecord` per ISO/IEC 14496-15 §8.3.3.
 * - `"vp9"`, VP9. Sample entry fourcc `vp09`. Description format is the
 *   `VP Codec Configuration Record` defined by the VP codec ISO BMFF carriage spec.
 * - `"av1"`, AV1. Sample entry fourcc `av01` with a child `av1C` box per the AV1 ISOBMFF
 *   binding §2.3. Description format is the full `AV1CodecConfigurationRecord` payload
 *   starting at the marker-and-version byte (typically `0x81`), followed by the packed
 *   profile, level, tier, bit-depth, and chroma-subsampling bits, and ending with the
 *   optional variable-length `configOBUs` section.
 */
export type VideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1'

/**
 * Supported audio codec tags.
 *
 * @remarks
 * - `"aac"` uses the `mp4a` sample entry with an `esds` descriptor wrapping the
 *   AudioSpecificConfig defined in ISO/IEC 14496-3 §1.6.2.1.
 * - `"opus"` uses the `Opus` sample entry with a `dOps` child. `description` is the
 *   OpusSpecificBox payload defined in the Opus-in-ISOBMFF spec §4.3.2.
 * - `"mp3"` uses the `mp4a` sample entry with an `esds` descriptor carrying
 *   `objectTypeIndication: 0x6B` (MPEG-1 Audio). No `description` is required because
 *   MP3 decoders derive every parameter from the bitstream.
 * - `"flac"` uses the `fLaC` sample entry with a `dfLa` child FullBox carrying one or
 *   more FLAC metadata blocks (STREAMINFO at minimum). Callers must strip the native
 *   "fLaC" magic signature that begins a standalone `.flac` file, because that magic
 *   is not part of the ISOBMFF encapsulation. See FLAC in ISOBMFF for the full layout.
 * - `"pcm"` uses the `ipcm` sample entry with a `pcmC` child FullBox declaring the
 *   endianness and bit depth of the raw integer PCM samples per ISO/IEC 23003-5. No
 *   `description` is required because PCM has no decoder configuration record. The
 *   sample rate and channel count live in the standard AudioSampleEntry fields, and
 *   the bit depth also populates the `samplesize` field there.
 *
 * @see {@link https://mp4ra.org/registered-types/mp4ra/object-types | MP4 Registration Authority Object Type Indications}
 * @see {@link https://github.com/xiph/flac/blob/master/doc/isoflac.txt | FLAC in ISOBMFF}
 * @see ISO/IEC 23003-5 for the `ipcm` sample entry and `pcmC` configuration box.
 */
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm'

/**
 * Container layout strategy passed as {@link MuxerOptions.fastStart}.
 *
 * @remarks
 * Three layouts are currently supported:
 *
 * - `false`, progressive mode. The file is written in order: `ftyp`, an `mdat` with a
 *   placeholder size, sample bytes appended as they arrive, and finally `moov`. The `mdat`
 *   size is patched in place at finalize time, so the target MUST provide a working
 *   {@link Target.seek}. This layout streams sample bytes to disk without buffering but
 *   yields a file whose `moov` lives at the end, which defers playback start until the
 *   player has read the whole file.
 * - `"in-memory"`, fast-start layout with `moov` before `mdat`. All sample bytes are
 *   buffered until `finalize()`, then a two-pass `moov` build computes absolute chunk
 *   offsets and the final byte stream is emitted as `ftyp` + `moov` + `mdat`. This layout
 *   requires enough memory to hold the full media payload but produces a file that players
 *   can start decoding as soon as they have read `moov`. It works with sequential-only
 *   targets such as {@link StreamTarget} because no in-place patching is needed.
 * - `"fragmented"`, fragmented MP4 layout suitable for live-streaming and multi-hour
 *   recordings. The muxer writes `ftyp` followed by an empty `moov` carrying `mvex` up
 *   front, then emits one `moof` plus `mdat` pair per fragment. Each fragment is
 *   self-contained and bounded by {@link MuxerOptions.minimumFragmentDuration}, so memory
 *   use stays bounded regardless of total duration. This layout works with sequential-only
 *   targets such as {@link StreamTarget} because every write is append-only.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link https://w3c.github.io/mse-byte-stream-format-isobmff/ | MSE byte stream format for ISO BMFF}
 */
export type FastStart = false | 'in-memory' | 'fragmented'

/**
 * Configuration for the video track of an {@link Mp4Muxer} instance.
 */
export type VideoTrackConfig = {
  /** The video codec used for the track. See {@link VideoCodec}. */
  codec: VideoCodec
  /** Coded picture width in pixels, written into the `tkhd` and `stsd` entries. */
  width: number
  /** Coded picture height in pixels, written into the `tkhd` and `stsd` entries. */
  height: number
  /**
   * Codec-specific decoder configuration bytes. The expected format depends on
   * {@link VideoTrackConfig.codec}:
   *
   * - `"avc"`, an `AVCDecoderConfigurationRecord` (ISO/IEC 14496-15 §5.3.3). When sourced
   *   from WebCodecs, this is the value of `VideoDecoderConfig.description` produced by a
   *   configured `VideoEncoder`.
   * - `"hevc"`, an `HEVCDecoderConfigurationRecord` (ISO/IEC 14496-15 §8.3.3). When sourced
   *   from WebCodecs, this is the value of `VideoDecoderConfig.description`.
   * - `"vp9"`, a `VP Codec Configuration Record` as defined by the VP codec ISO BMFF
   *   carriage specification.
   * - `"av1"`, an `AV1CodecConfigurationRecord` per the AV1 ISOBMFF binding §2.3 (the full
   *   payload that goes inside the `av1C` box, starting at the marker-and-version byte and
   *   running through the optional `configOBUs`). When sourced from WebCodecs, this is the
   *   value of `VideoDecoderConfig.description`.
   *
   * @see {@link https://w3c.github.io/webcodecs/#dom-videodecoderconfig-description | VideoDecoderConfig.description}
   */
  description: ArrayBuffer | ArrayBufferView
  /**
   * Media timescale (ticks per second) recorded in the track `mdhd`. Sample timestamps and
   * durations expressed in microseconds are converted to this timescale when written into
   * `stts` and `ctts`. Defaults to `90000` when omitted, the conventional value for video.
   */
  timescale?: number
}

/**
 * Describes an AAC audio track. The `description` bytes are the AudioSpecificConfig
 * defined in ISO/IEC 14496-3 §1.6.2.1, typically obtained from
 * `AudioDecoderConfig.description` when using WebCodecs.
 *
 * @see ISO/IEC 14496-3 §1.6.2.1
 */
export type AacAudioTrackConfig = {
  /** Discriminator identifying this variant. */
  codec: 'aac'
  /**
   * AudioSpecificConfig payload bytes. See ISO/IEC 14496-3 §1.6.2.1 for the layout.
   * Typically obtained from `AudioDecoderConfig.description` when using WebCodecs.
   */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, as declared by the decoder configuration. */
  channels: number
  /** Source sample rate in Hz. */
  sampleRate: number
  /** Track timescale in ticks per second. Defaults to `sampleRate` when omitted. */
  timescale?: number
}

/**
 * Describes an Opus audio track. The `description` bytes are the OpusSpecificBox payload
 * defined in the Opus-in-ISOBMFF encapsulation spec §4.3.2.
 *
 * @see {@link https://opus-codec.org/docs/opus_in_isobmff.html | Opus in ISOBMFF}
 */
export type OpusAudioTrackConfig = {
  /** Discriminator identifying this variant. */
  codec: 'opus'
  /**
   * OpusSpecificBox payload bytes. See the Opus-in-ISOBMFF spec §4.3.2 for the layout.
   * Typically obtained from `AudioDecoderConfig.description` when using WebCodecs.
   */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, as declared by the OpusSpecificBox. */
  channels: number
  /**
   * Source sample rate in Hz. The MP4 AudioSampleEntry samplerate field is always written
   * as 48 kHz per ISO/IEC 23003-5 regardless of this value.
   */
  sampleRate: number
  /** Track timescale in ticks per second. Defaults to `sampleRate` when omitted. */
  timescale?: number
}

/**
 * Describes an MP3 audio track. MP3 decoders derive every parameter from the bitstream,
 * so no `description` field is carried. The emitted `esds` descriptor sets
 * `objectTypeIndication: 0x6B` (MPEG-1 Audio) and omits the DecoderSpecificInfo.
 *
 * @see {@link https://mp4ra.org/registered-types/mp4ra/object-types | MP4 Registration Authority Object Type Indications}
 */
export type Mp3AudioTrackConfig = {
  /** Discriminator identifying this variant. */
  codec: 'mp3'
  /** Output channel count declared on the emitted `mp4a` AudioSampleEntry. */
  channels: number
  /** Source sample rate in Hz. */
  sampleRate: number
  /** Track timescale in ticks per second. Defaults to `sampleRate` when omitted. */
  timescale?: number
}

/**
 * Describes a FLAC audio track. The `description` bytes are the `dfLa` metadata-block
 * payload as specified by FLAC in ISOBMFF §3. The payload MUST include the STREAMINFO
 * block and MUST NOT include the native "fLaC" magic that begins a standalone `.flac`
 * file.
 *
 * @see {@link https://github.com/xiph/flac/blob/master/doc/isoflac.txt | FLAC in ISOBMFF}
 */
export type FlacAudioTrackConfig = {
  /** Discriminator identifying this variant. */
  codec: 'flac'
  /**
   * FLAC metadata-block bytes (STREAMINFO at minimum) that populate the child `dfLa`
   * FullBox. See the FLAC in ISOBMFF encapsulation for the expected layout.
   */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, as declared by the STREAMINFO block. */
  channels: number
  /** Source sample rate in Hz, written into the AudioSampleEntry samplerate field. */
  sampleRate: number
  /** Track timescale in ticks per second. Defaults to `sampleRate` when omitted. */
  timescale?: number
}

/**
 * Describes an integer PCM audio track. Carries no `description` because PCM has no
 * decoder configuration record. The codec parameters live inside the `pcmC` child and
 * the standard AudioSampleEntry fields.
 *
 * @see ISO/IEC 23003-5 for the `ipcm` sample entry and `pcmC` configuration box.
 */
export type PcmAudioTrackConfig = {
  /** Discriminator identifying this variant. */
  codec: 'pcm'
  /** Output channel count, written into the AudioSampleEntry channelcount field. */
  channels: number
  /** Source sample rate in Hz, written into the AudioSampleEntry samplerate field. */
  sampleRate: number
  /**
   * Bit depth of each PCM sample. Constrained to 16, 24, or 32 because those are the
   * widths mp4craft supports for raw integer PCM in the `pcmC` configuration.
   */
  bitsPerSample: 16 | 24 | 32
  /** Byte order of each PCM sample in the accompanying `mdat`. */
  endianness: 'little' | 'big'
  /** Track timescale in ticks per second. Defaults to `sampleRate` when omitted. */
  timescale?: number
}

/**
 * Configuration for a single audio track. Variants are discriminated by the `codec` field.
 *
 * @see ISO/IEC 14496-3 for AAC decoder configuration.
 * @see ISO/IEC 23003-5 for Opus and raw integer PCM in ISOBMFF.
 * @see ISO/IEC 14496-1 §7.2.6 for the ES descriptor chain used by AAC and MP3.
 * @see {@link https://github.com/xiph/flac/blob/master/doc/isoflac.txt | FLAC in ISOBMFF}
 */
export type AudioTrackConfig =
  | AacAudioTrackConfig
  | OpusAudioTrackConfig
  | Mp3AudioTrackConfig
  | FlacAudioTrackConfig
  | PcmAudioTrackConfig

/**
 * Options accepted by the {@link Mp4Muxer} constructor.
 *
 * @typeParam T - The concrete {@link Target} type. Preserving this on the muxer lets
 *   built-in targets such as `ArrayBufferTarget` expose their specific accessors (for
 *   example `target.buffer`) without casts.
 */
export type MuxerOptions<T extends Target = Target> = {
  /**
   * Destination sink that receives the serialized MP4 bytes. Built-in implementations are
   * {@link ArrayBufferTarget} and {@link StreamTarget}. Custom sinks implement the
   * {@link Target} type directly.
   */
  target: T
  /**
   * Descriptor of the video track to include. Omit to produce an audio-only file. At least
   * one of `video` or `audio` must be provided.
   */
  video?: VideoTrackConfig
  /**
   * Descriptor of the audio track to include. Omit to produce a video-only file. At least
   * one of `video` or `audio` must be provided.
   */
  audio?: AudioTrackConfig
  /**
   * Container layout strategy. See {@link FastStart}. Defaults to `false` (progressive
   * layout with `moov` at end of file), which requires a seekable target.
   */
  fastStart?: FastStart
  /**
   * Policy applied to the first presentation timestamp of each track. See
   * {@link FirstTimestampBehavior} for the accepted values and their semantics. Defaults to
   * `"offset"`, which subtracts the first timestamp of each track so that each track starts
   * at zero.
   */
  firstTimestampBehavior?: FirstTimestampBehavior
  /**
   * Minimum elapsed microseconds between fragment flushes, applied only when
   * {@link MuxerOptions.fastStart} is `"fragmented"`. A fragment boundary is placed at the
   * next keyframe after at least this much media has accumulated since the previous flush.
   * Lower values shrink memory use and startup latency at the cost of more `moof` overhead.
   * Defaults to `1_000_000` microseconds (one second) when omitted. Ignored by the
   * progressive and in-memory layouts.
   *
   * @see {@link https://w3c.github.io/webcodecs/#timestamps | WebCodecs timestamps}
   */
  minimumFragmentDuration?: number
}

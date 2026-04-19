/*
 * Shared synthetic codec configuration shared by every playground scenario that
 * drives mp4craft with hand-authored samples (StressTest, CodecMatrix, and any
 * future sweep or benchmark). The module centralises the decoder configuration
 * record bytes, the FLAC metadata block builder, and the
 * `VideoTrackConfig` / `AudioTrackConfig` factory functions so the scenarios
 * cannot drift out of sync.
 *
 * Every byte constant cites the ISO/IEC or W3C specification that defines the
 * field layout. The builders consume those byte constants through
 * `Record<Union, builder>` dispatch tables, keeping the call sites free of
 * if/else-if chains on the codec discriminant.
 */

import type { AudioTrackConfig, VideoTrackConfig } from 'mp4craft'

/**
 * Every video codec tag accepted by {@link VideoTrackConfig}. Playground
 * scenarios pick one value per muxer instance; the sweep scenarios iterate the
 * full set.
 */
export type SyntheticVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1'

/**
 * Every audio codec tag accepted by {@link AudioTrackConfig}. Matches the
 * discriminated union exported by the mp4craft public API.
 */
export type SyntheticAudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm'

/**
 * Fast-start modes exercised by the synthetic scenarios. Progressive mode
 * (`fastStart: false`) is intentionally omitted because `ArrayBufferTarget.seek`
 * is a documented no-op, so a progressive run against `ArrayBufferTarget` only
 * retraces the append path. Real seekable targets exercise the progressive path
 * in the ScreenRecorder scenario instead.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 */
export type SyntheticFastStart = 'in-memory' | 'fragmented'

/**
 * AVCDecoderConfigurationRecord bytes for baseline profile 3.1 at 320 by 240
 * with a real sequence parameter set and picture parameter set. The payload is
 * derived from `packages/core/tests/fixtures/avcc.bin` and matches the
 * AVCDecoderConfigurationRecord layout defined by ISO/IEC 14496-15 §5.3.3.
 */
export const AVC_DECODER_CONFIGURATION_RECORD_BYTES = new Uint8Array([
  0x01, 0x42, 0xc0, 0x0d, 0xff, 0xe1, 0x00, 0x18, 0x67, 0x42, 0xc0, 0x0d, 0xd9, 0x01, 0x41, 0xfb, 0x01, 0x10, 0x00,
  0x00, 0x03, 0x00, 0x10, 0x00, 0x00, 0x03, 0x03, 0xc0, 0xf1, 0x42, 0xa4, 0x80, 0x01, 0x00, 0x05, 0x68, 0xcb, 0x83,
  0xcb, 0x20,
])

/**
 * Minimal HEVCDecoderConfigurationRecord bytes. mp4craft stores the payload
 * verbatim as the `hvcC` body without parsing, so a one-byte sentinel is
 * sufficient for synthetic scenarios that never decode the resulting MP4.
 *
 * @see ISO/IEC 14496-15 §8.3.3.
 */
export const HEVC_DECODER_CONFIGURATION_RECORD_BYTES = new Uint8Array([0x01])

/**
 * VP9 `vpcC` payload bytes. The eight bytes encode profile 0, level 3.0, 8-bit
 * depth with 4:2:0 colocated chroma, BT.709 colour primaries, transfer, and
 * matrix coefficients, and an empty codec initialization data size.
 *
 * @see VP9 ISOBMFF binding §2.2 for the field layout.
 */
export const VP9_VPCC_PAYLOAD_BYTES = new Uint8Array([0x00, 0x1e, 0x82, 0x01, 0x01, 0x01, 0x00, 0x00])

/**
 * AV1 codec configuration record bytes. The four bytes encode the marker and
 * version sentinel, sequence profile and level index, chroma subsampling bits,
 * and the reserved trailing delay field.
 *
 * @see AV1 ISOBMFF binding §2.3 for the field layout.
 */
export const AV1_CONFIGURATION_RECORD_BYTES = new Uint8Array([0x81, 0x00, 0x0c, 0x00])

/**
 * AudioSpecificConfig bytes for AAC-LC at 48 kHz, mono. The payload populates
 * the `esds` descriptor emitted by the `mp4a` sample entry.
 *
 * @see ISO/IEC 14496-3 §1.6.2.1 for the AudioSpecificConfig layout.
 */
export const AAC_AUDIO_SPECIFIC_CONFIG_BYTES = new Uint8Array([0x12, 0x10])

/**
 * OpusSpecificBox body bytes for stereo at 48 kHz. The eleven bytes encode
 * version, output channel count, pre-skip, input sample rate, output gain, and
 * channel mapping family zero.
 *
 * @see Opus-in-ISOBMFF encapsulation §4.3.2 for the field layout.
 */
export const OPUS_SPECIFIC_BOX_BYTES = new Uint8Array([
  0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0xbb, 0x80, 0x00, 0x00, 0x00,
])

/**
 * Builds the 38-byte FLAC metadata block payload for a 48 kHz stereo 16-bit
 * stream. The block populates the `dfLa` FullBox child of the `fLaC` sample
 * entry and contains exactly one STREAMINFO metadata block with the last-block
 * flag set.
 *
 * @returns A freshly allocated `Uint8Array` holding the STREAMINFO block.
 *
 * @see FLAC-in-ISOBMFF encapsulation for the STREAMINFO field layout.
 */
export function buildFlacMetadataBlockBytes(): Uint8Array {
  const metadataBlockBytes = new Uint8Array(38)
  metadataBlockBytes[0] = 0x80
  metadataBlockBytes[3] = 0x22
  metadataBlockBytes[14] = 0x0b
  metadataBlockBytes[15] = 0xb8
  metadataBlockBytes[16] = 0x02
  metadataBlockBytes[17] = 0xf0
  return metadataBlockBytes
}

/**
 * Dispatch table that maps a {@link SyntheticVideoCodec} to the builder that
 * produces the matching {@link VideoTrackConfig}. Using a `Record` keeps the
 * string-to-config transformation branch-free at every call site.
 */
const SYNTHETIC_VIDEO_TRACK_CONFIG_BUILDERS: Record<
  SyntheticVideoCodec,
  (codedWidth: number, codedHeight: number) => VideoTrackConfig
> = {
  avc: (codedWidth, codedHeight) => ({
    codec: 'avc',
    width: codedWidth,
    height: codedHeight,
    description: AVC_DECODER_CONFIGURATION_RECORD_BYTES,
  }),
  hevc: (codedWidth, codedHeight) => ({
    codec: 'hevc',
    width: codedWidth,
    height: codedHeight,
    description: HEVC_DECODER_CONFIGURATION_RECORD_BYTES,
  }),
  vp9: (codedWidth, codedHeight) => ({
    codec: 'vp9',
    width: codedWidth,
    height: codedHeight,
    description: VP9_VPCC_PAYLOAD_BYTES,
  }),
  av1: (codedWidth, codedHeight) => ({
    codec: 'av1',
    width: codedWidth,
    height: codedHeight,
    description: AV1_CONFIGURATION_RECORD_BYTES,
  }),
}

/**
 * Builds the {@link VideoTrackConfig} for the selected synthetic codec at the
 * supplied coded geometry. Every returned object reuses the module-level byte
 * constants so repeated calls share the same decoder configuration record.
 *
 * @param codec - The video codec tag to emit.
 * @param codedWidth - Coded video frame width in pixels.
 * @param codedHeight - Coded video frame height in pixels.
 * @returns A ready-to-use `VideoTrackConfig` for the supplied codec.
 */
export function buildSyntheticVideoTrackConfig(
  codec: SyntheticVideoCodec,
  codedWidth: number,
  codedHeight: number
): VideoTrackConfig {
  return SYNTHETIC_VIDEO_TRACK_CONFIG_BUILDERS[codec](codedWidth, codedHeight)
}

/**
 * Bit depth emitted when the caller selects PCM audio. mp4craft's PCM sample
 * entry requires an explicit bit depth because the codec has no decoder
 * configuration record.
 */
const SYNTHETIC_PCM_BITS_PER_SAMPLE = 16

/**
 * Dispatch table that maps a {@link SyntheticAudioCodec} to the builder that
 * produces the matching {@link AudioTrackConfig}. The `mp3` and `pcm` builders
 * omit `description`:
 *
 * - MP3 decoders derive every parameter from the bitstream so the emitted
 *   `esds` descriptor carries no DecoderSpecificInfo.
 * - PCM has no decoder configuration record. The codec parameters live in the
 *   `pcmC` child and the standard AudioSampleEntry fields per ISO/IEC 23003-5.
 */
const SYNTHETIC_AUDIO_TRACK_CONFIG_BUILDERS: Record<
  SyntheticAudioCodec,
  (channelCount: number, sampleRateHertz: number) => AudioTrackConfig
> = {
  aac: (channelCount, sampleRateHertz) => ({
    codec: 'aac',
    description: AAC_AUDIO_SPECIFIC_CONFIG_BYTES,
    channels: channelCount,
    sampleRate: sampleRateHertz,
  }),
  opus: (channelCount, sampleRateHertz) => ({
    codec: 'opus',
    description: OPUS_SPECIFIC_BOX_BYTES,
    channels: channelCount,
    sampleRate: sampleRateHertz,
  }),
  mp3: (channelCount, sampleRateHertz) => ({
    codec: 'mp3',
    channels: channelCount,
    sampleRate: sampleRateHertz,
  }),
  flac: (channelCount, sampleRateHertz) => ({
    codec: 'flac',
    description: buildFlacMetadataBlockBytes(),
    channels: channelCount,
    sampleRate: sampleRateHertz,
  }),
  pcm: (channelCount, sampleRateHertz) => ({
    codec: 'pcm',
    channels: channelCount,
    sampleRate: sampleRateHertz,
    bitsPerSample: SYNTHETIC_PCM_BITS_PER_SAMPLE,
    endianness: 'little',
  }),
}

/**
 * Builds the {@link AudioTrackConfig} for the selected synthetic codec at the
 * supplied channel count and sample rate. Every returned object reuses the
 * module-level byte constants so repeated calls share the same decoder
 * configuration record.
 *
 * @param codec - The audio codec tag to emit.
 * @param channelCount - Number of audio channels in the synthetic track.
 * @param sampleRateHertz - Sample rate of the synthetic track in Hertz.
 * @returns A ready-to-use `AudioTrackConfig` for the supplied codec.
 */
export function buildSyntheticAudioTrackConfig(
  codec: SyntheticAudioCodec,
  channelCount: number,
  sampleRateHertz: number
): AudioTrackConfig {
  return SYNTHETIC_AUDIO_TRACK_CONFIG_BUILDERS[codec](channelCount, sampleRateHertz)
}

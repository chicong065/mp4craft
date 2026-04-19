import type { Box } from '@/boxes/box'

/**
 * Discriminant identifying whether a codec produces a video or audio sample entry.
 *
 * @remarks
 * Each concrete codec implementation fixes this value as a class field and uses it to pair
 * with the matching handler type (`vide` or `soun`) when the track builds its `hdlr` box.
 */
export type CodecKind = 'video' | 'audio'

/**
 * Four-character sample entry code emitted for each supported video codec.
 * Matches the `avc1` / `hvc1` / `vp09` / `av01` entries registered by the
 * corresponding ISOBMFF codec bindings.
 */
export type VideoSampleEntryFourCC = 'avc1' | 'hvc1' | 'vp09' | 'av01'

/**
 * Four-character sample entry code emitted for each supported audio codec.
 * Matches the `mp4a` / `Opus` / `fLaC` / `ipcm` entries registered by the
 * corresponding ISOBMFF codec bindings. Both AAC and MP3 use the `mp4a`
 * entry, distinguished by the `objectTypeIndication` inside the `esds`
 * descriptor.
 */
export type AudioSampleEntryFourCC = 'mp4a' | 'Opus' | 'fLaC' | 'ipcm'

/**
 * Contract implemented by every video codec adapter in the muxer. Paired
 * with {@link AudioCodecAdapter} under the {@link Codec} union so a
 * discriminator check on `kind` narrows `fourcc` to the matching sample-entry
 * type.
 *
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4RA sample entries registry}
 */
export interface VideoCodecAdapter {
  /** Video track discriminant. */
  readonly kind: 'video'
  /** Sample entry fourcc produced by {@link VideoCodecAdapter.createSampleEntry}. */
  readonly fourcc: VideoSampleEntryFourCC
  /**
   * Builds the codec-specific video sample entry box to be placed inside
   * `stsd`. Called once per track during `moov` serialization.
   *
   * @returns A `Box` whose serializer emits the visual sample entry with its
   *   configuration child box (for example, `avcC`, `hvcC`, `vpcC`, `av1C`).
   */
  createSampleEntry(): Box
}

/**
 * Contract implemented by every audio codec adapter in the muxer. Paired
 * with {@link VideoCodecAdapter} under the {@link Codec} union.
 */
export interface AudioCodecAdapter {
  /** Audio track discriminant. */
  readonly kind: 'audio'
  /** Sample entry fourcc produced by {@link AudioCodecAdapter.createSampleEntry}. */
  readonly fourcc: AudioSampleEntryFourCC
  /**
   * Builds the codec-specific audio sample entry box to be placed inside
   * `stsd`. Called once per track during `moov` serialization.
   *
   * @returns A `Box` whose serializer emits the audio sample entry with its
   *   configuration child box (for example, `esds`, `dOps`, `dfLa`, `pcmC`).
   */
  createSampleEntry(): Box
}

/**
 * Discriminated union of every codec adapter kind. Functions that operate on
 * either video or audio adapters accept this union; a narrowing check on
 * `kind` resolves to the concrete adapter interface.
 */
export type Codec = VideoCodecAdapter | AudioCodecAdapter

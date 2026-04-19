import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTrex}. Every field corresponds one-to-one with a u32 in the
 * `TrackExtendsBox` payload defined in ISO/IEC 14496-12 §8.8.3.
 */
export type TrexOptions = {
  /** Track identifier this `trex` applies to. Must match an existing `tkhd.trackId`. */
  trackId: number
  /**
   * Index (1-based) into the track's `stsd` sample description list used by default
   * for samples in this track's fragments. mp4craft emits one sample entry per track,
   * so this is always 1.
   */
  defaultSampleDescriptionIndex: number
  /**
   * Default duration applied to each sample in a fragment when `trun` does not override
   * it. Setting this to 0 defers the value to each `trun` entry, which is what mp4craft
   * does to support variable frame rates.
   */
  defaultSampleDuration: number
  /**
   * Default sample size applied to each sample in a fragment when `trun` does not
   * override it. Setting this to 0 defers the value to each `trun` entry.
   */
  defaultSampleSize: number
  /**
   * Default sample flags applied to each sample in a fragment when `trun` does not
   * override them. Setting this to 0 defers the value to each `trun` entry. The bit
   * layout is defined by ISO/IEC 14496-12 §8.6.4.3.
   */
  defaultSampleFlags: number
}

/**
 * Builds a `TrackExtendsBox` (`trex`), a FullBox inside `mvex` that declares the default
 * sample parameters used by subsequent `moof` fragments for the given track.
 *
 * Per ISO/IEC 14496-12 §8.8.3, `trex` carries five u32 fields after the FullBox header.
 * mp4craft sets most defaults to zero and writes per-sample overrides inside each `trun`,
 * trading a few extra bytes per sample for consistent handling of variable frame rate.
 *
 * @param options - Track identifier plus the five default-value fields.
 * @returns A {@link FullBox} that serializes to a 32-byte `trex` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTrex(options: TrexOptions): FullBox {
  return {
    type: 'trex',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.trackId)
      writer.u32(options.defaultSampleDescriptionIndex)
      writer.u32(options.defaultSampleDuration)
      writer.u32(options.defaultSampleSize)
      writer.u32(options.defaultSampleFlags)
    },
  }
}

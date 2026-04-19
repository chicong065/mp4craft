import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMehd}.
 */
export type MehdOptions = {
  /**
   * Total fragment duration in the movie timescale. Expressed as `bigint` because the
   * version-1 encoding uses u64. A value of 0 is legal for live-streaming cases where the
   * duration is unknown.
   */
  fragmentDurationInMovieTimescale: bigint
}

/**
 * Builds a `MovieExtendsHeaderBox` (`mehd`) declaring the total duration of all fragments
 * in the movie timescale. Optional inside `mvex`.
 *
 * mp4craft always emits version 1 (`u64` duration) to avoid the 32-bit overflow that
 * version 0 would impose on long recordings.
 *
 * @param options - The fragment duration in movie-timescale ticks.
 * @returns A {@link FullBox} that serializes to a 20-byte `mehd` box.
 *
 * @see ISO/IEC 14496-12 §8.8.2 for the `mehd` payload layout.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMehd(options: MehdOptions): FullBox {
  return {
    type: 'mehd',
    version: 1,
    flags: 0,
    write: (writer) => {
      writer.u64(options.fragmentDurationInMovieTimescale)
    },
  }
}

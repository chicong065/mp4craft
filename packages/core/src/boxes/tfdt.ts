import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTfdt}.
 */
export type TfdtOptions = {
  /**
   * Base media decode time for the first sample of this fragment, expressed as `bigint`
   * in the track's media timescale. The value is the running sum of the durations of all
   * samples emitted for this track in prior fragments, starting at 0 for the first fragment.
   */
  baseMediaDecodeTimeInTrackTimescale: bigint
}

/**
 * Builds a `TrackFragmentBaseMediaDecodeTimeBox` (`tfdt`) declaring the decode time of the
 * first sample in the parent `traf`.
 *
 * mp4craft always emits version 1 (`u64` decode time) to avoid the 32-bit overflow that
 * version 0 would impose on multi-hour recordings.
 *
 * @param options - The base media decode time in the track timescale.
 * @returns A {@link FullBox} that serializes to a 20-byte `tfdt` box.
 *
 * @see ISO/IEC 14496-12 §8.8.12 for the `tfdt` payload layout.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTfdt(options: TfdtOptions): FullBox {
  return {
    type: 'tfdt',
    version: 1,
    flags: 0,
    write: (writer) => {
      writer.u64(options.baseMediaDecodeTimeInTrackTimescale)
    },
  }
}

import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTfhd}.
 */
export type TfhdOptions = {
  /** Track identifier for this fragment's samples. Must match an existing `tkhd.trackId`. */
  trackId: number
}

/**
 * The `default-base-is-moof` flag defined in ISO/IEC 14496-12 §8.8.7. When set, the
 * `data_offset` values carried by subsequent `trun` boxes are interpreted as offsets
 * relative to the start of the enclosing `moof`, which makes every fragment self-contained
 * and removes the need for forward-looking sample-data addressing.
 */
const DEFAULT_BASE_IS_MOOF_FLAG = 0x020000

/**
 * Builds a `TrackFragmentHeaderBox` (`tfhd`) carrying only the track identifier.
 *
 * mp4craft sets the `default-base-is-moof` flag and leaves every per-track default value
 * unset, which delegates sample duration, size, and flags to each `trun`. This trades a
 * few bytes per sample for uniform handling of variable frame rate.
 *
 * Per ISO/IEC 14496-12 §8.8.7, `tfhd` is a FullBox whose body always begins with a u32
 * `track_ID` and is followed by optional fields controlled by the flags field. With the
 * `default-base-is-moof` flag alone the payload is just the four `track_ID` bytes.
 *
 * @param options - The track identifier for this fragment's samples.
 * @returns A {@link FullBox} that serializes to a 16-byte `tfhd` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTfhd(options: TfhdOptions): FullBox {
  return {
    type: 'tfhd',
    version: 0,
    flags: DEFAULT_BASE_IS_MOOF_FLAG,
    write: (writer) => {
      writer.u32(options.trackId)
    },
  }
}

import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTraf}.
 */
export type TrafOptions = {
  /** Track fragment header produced by `createTfhd`. */
  tfhd: FullBox
  /** Base media decode time produced by `createTfdt`. */
  tfdt: FullBox
  /** Sample run produced by `createTrun`. */
  trun: FullBox
}

/**
 * Builds a `TrackFragmentBox` (`traf`), one per track with samples in the parent `moof`.
 *
 * Per ISO/IEC 14496-12 §8.8.6, `traf` is a container that begins with a `tfhd`, optionally
 * followed by `tfdt`, and concluded by one or more `trun` boxes. mp4craft uses exactly
 * one `trun` per fragment per track, matching the single-run-per-fragment approach that
 * keeps each fragment self-describing.
 *
 * @param options - The three child boxes in their spec-mandated order.
 * @returns A {@link Box} that serializes a `traf` container with `tfhd`, `tfdt`, `trun`.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTraf(options: TrafOptions): Box {
  return {
    type: 'traf',
    write: (writer) => {
      writeBox(writer, options.tfhd)
      writeBox(writer, options.tfdt)
      writeBox(writer, options.trun)
    },
  }
}

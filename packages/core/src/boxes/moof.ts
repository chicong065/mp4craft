import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMoof}.
 */
export type MoofOptions = {
  /** Fragment header box produced by `createMfhd`. */
  mfhd: FullBox
  /**
   * One `traf` box per track that has samples in this fragment. A track with no samples
   * in the current fragment is omitted rather than included with an empty `trun`, an
   * invariant the fragment builder in Task 4 relies on when iterating track state.
   */
  trafs: Box[]
}

/**
 * Builds a `MovieFragmentBox` (`moof`), the top-level container for each fragment.
 *
 * Per ISO/IEC 14496-12 §8.8.4, `moof` contains exactly one `mfhd` followed by one or more
 * `traf` boxes. The serializer writes `mfhd` first, then every `traf` in the order given.
 *
 * @param options - The child `mfhd` and the per-track `traf` list.
 * @returns A {@link Box} whose serializer emits an `moof` container with the listed children.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMoof(options: MoofOptions): Box {
  return {
    type: 'moof',
    write: (writer) => {
      writeBox(writer, options.mfhd)
      for (const trafBox of options.trafs) writeBox(writer, trafBox)
    },
  }
}

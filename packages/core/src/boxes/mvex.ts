import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMvex}.
 */
export type MvexOptions = {
  /**
   * Optional `mehd` box declaring the total fragment duration. Omit for live-streaming
   * cases where the duration is unknown up front.
   */
  mehd?: FullBox
  /**
   * One `trex` box per track. Each track defined in the `moov.trak[]` list must have a
   * corresponding `trex` entry, or parsers will refuse to play the file's fragments.
   */
  trex: FullBox[]
}

/**
 * Builds a `MovieExtendsBox` (`mvex`), a container box inside `moov` that declares the
 * file to be fragmented and lists the default sample parameters for each track.
 *
 * Per ISO/IEC 14496-12 §8.8.1, the `mvex` box may contain an optional `mehd` followed by
 * one `trex` per track. mp4craft writes `mehd` first when supplied, then every `trex` in
 * the order given.
 *
 * @param options - Optional `mehd` and the per-track `trex` list.
 * @returns A {@link Box} that serializes an `mvex` container with the listed children.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMvex(options: MvexOptions): Box {
  return {
    type: 'mvex',
    write: (writer) => {
      if (options.mehd) {
        writeBox(writer, options.mehd)
      }
      for (const trexBox of options.trex) writeBox(writer, trexBox)
    },
  }
}

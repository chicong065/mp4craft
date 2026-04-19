import { writeBox, type Box } from '@/boxes/box'

/**
 * Builds a `MovieBox` (`moov`) container aggregating the movie header, per-track boxes,
 * and an optional `mvex` declaration that marks the file as fragmented.
 *
 * Per ISO/IEC 14496-12 §8.2.1, `moov` is the top-level container for the movie's metadata.
 * It must contain exactly one `mvhd` (movie header) and one `trak` per track. For
 * fragmented files, `moov` also carries an `mvex` per ISO/IEC 14496-12 §8.8.1 that lists
 * the per-track sample defaults. The serializer writes `mvhd` first, then each `trak` in
 * order, and finally `mvex` when supplied.
 *
 * @param children - The pre-built child boxes for the movie.
 * @param children.mvhd - The `mvhd` movie-header box (see `createMvhd`).
 * @param children.traks - One `trak` box per track, in declaration order.
 * @param children.mvex - Optional `mvex` box declaring the file as fragmented.
 * @returns A {@link Box} whose serializer emits the `moov` body as `mvhd`, every `trak`
 *   in order, and the optional `mvex` at the end.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createMoov(children: { mvhd: Box; traks: Box[]; mvex?: Box }): Box {
  return {
    type: 'moov',
    write: (writer) => {
      writeBox(writer, children.mvhd)
      for (const trakBox of children.traks) writeBox(writer, trakBox)
      if (children.mvex) {
        writeBox(writer, children.mvex)
      }
    },
  }
}

import { writeBox, type Box } from '@/boxes/box'
import { createDref } from '@/boxes/dref'

/**
 * Builds a `DataInformationBox` (`dinf`) per ISO/IEC 14496-12 §8.7.1.
 *
 * `dinf` is a plain container `Box` (not a FullBox) that lives inside `minf`.
 * Its sole child is a `DataReferenceBox` (`dref`) declaring where the media data
 * resides. The muxer always emits a single self-contained `dref` because the
 * produced MP4 embeds its media data in the same file.
 *
 * @returns A `Box` whose serializer writes a single `dref` child.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createDinf(): Box {
  return {
    type: 'dinf',
    write: (writer) => writeBox(writer, createDref()),
  }
}

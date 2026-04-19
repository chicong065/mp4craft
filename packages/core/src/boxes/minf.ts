import { writeBox, type Box } from '@/boxes/box'
import { createDinf } from '@/boxes/dinf'

/**
 * Builds a `MediaInformationBox` (`minf`) container aggregating the per-media-type header,
 * data information, and sample table.
 *
 * Per ISO/IEC 14496-12 §8.4.4, `minf` contains the media-specific header (`vmhd` for video,
 * `smhd` for audio), a `dinf` data-information container, and the `stbl` sample table, in
 * that order. This builder injects a default `dinf` between the media header and `stbl` via
 * `createDinf`.
 *
 * @param children - The pre-built child boxes for the media information.
 * @param children.mediaHeader - The media-specific header box (`vmhd` for video, `smhd` for
 *   audio).
 * @param children.stbl - The `stbl` sample-table container.
 * @returns A {@link Box} whose serializer emits the `minf` body as `mediaHeader` then `dinf`
 *   then `stbl`.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createMinf(children: { mediaHeader: Box; stbl: Box }): Box {
  return {
    type: 'minf',
    write: (writer) => {
      writeBox(writer, children.mediaHeader)
      writeBox(writer, createDinf())
      writeBox(writer, children.stbl)
    },
  }
}

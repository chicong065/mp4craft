import { writeBox, type Box } from '@/boxes/box'

/**
 * Builds a `MediaBox` (`mdia`) container wrapping the media-level boxes of a track.
 *
 * Per ISO/IEC 14496-12 §8.4.1, `mdia` groups the media declaration inside a `trak` and must
 * contain exactly one `mdhd` (media header), one `hdlr` (handler), and one `minf` (media
 * information) child, in that order.
 *
 * @param children - The pre-built child boxes for the media.
 * @param children.mdhd - The `mdhd` media-header box (see `createMdhd`).
 * @param children.hdlr - The `hdlr` handler-reference box (see `createHdlr`).
 * @param children.minf - The `minf` media-information container (see `createMinf`).
 * @returns A {@link Box} whose serializer emits the `mdia` body as `mdhd` then `hdlr` then
 *   `minf`.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createMdia(children: { mdhd: Box; hdlr: Box; minf: Box }): Box {
  return {
    type: 'mdia',
    write: (writer) => {
      writeBox(writer, children.mdhd)
      writeBox(writer, children.hdlr)
      writeBox(writer, children.minf)
    },
  }
}

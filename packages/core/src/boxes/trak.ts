import { writeBox, type Box } from '@/boxes/box'

/**
 * Builds a `TrackBox` (`trak`) container wrapping one track's header and media boxes.
 *
 * Per ISO/IEC 14496-12 §8.3.1, `trak` is a container for a single track and must appear once
 * per track inside the `moov` box. It contains exactly one `tkhd` (track header) followed by
 * one `mdia` (media), plus optional boxes (edit lists, user data) not emitted by this builder.
 *
 * @param children - The pre-built child boxes for the track.
 * @param children.tkhd - The `tkhd` track-header box (see `createTkhd`).
 * @param children.mdia - The `mdia` media box (see `createMdia`).
 * @returns A {@link Box} whose serializer emits the `trak` body as `tkhd` followed by `mdia`.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createTrak(children: { tkhd: Box; mdia: Box }): Box {
  return {
    type: 'trak',
    write: (writer) => {
      writeBox(writer, children.tkhd)
      writeBox(writer, children.mdia)
    },
  }
}

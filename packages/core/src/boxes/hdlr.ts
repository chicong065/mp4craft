import type { FullBox } from '@/boxes/full-box'

/**
 * Options for constructing a `HandlerBox` (`hdlr`).
 *
 * The handler type selects the media category, which in turn determines the media header
 * child of the enclosing `minf` (`vmhd` for video, `smhd` for audio), per ISO/IEC 14496-12
 * §8.4.3.
 */
export type HdlrOptions = {
  /**
   * The media handler fourcc. `"vide"` marks a visual track (requiring a `vmhd` media header)
   * and `"soun"` marks an audio track (requiring a `smhd` media header). Other registered
   * handlers such as `"text"` and `"subt"` exist in the MP4RA registry but are not produced
   * by this builder.
   */
  handlerType: 'vide' | 'soun'
  /**
   * Human-readable handler name, written as ASCII with a trailing null terminator. May be an
   * empty string, in which case the box ends with the single terminator byte.
   */
  name: string
}

/**
 * Builds a `HandlerBox` (`hdlr`) declaring the media category of a track.
 *
 * Per ISO/IEC 14496-12 §8.4.3, `hdlr` is a FullBox written at version 0 with a `pre_defined`
 * 32-bit zero, the 4-character `handler_type` fourcc, 12 bytes of reserved zeros, and a
 * null-terminated ASCII `name` string.
 *
 * @param options - Handler type and descriptive name (see {@link HdlrOptions}).
 * @returns A {@link FullBox} whose serializer emits the `hdlr` body per §8.4.3 version 0.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://mp4ra.org/registered-types/handler | MP4 Registration Authority handler-type registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createHdlr(options: HdlrOptions): FullBox {
  return {
    type: 'hdlr',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(0) // pre_defined
      writer.fourcc(options.handlerType)
      writer.zeros(12) // reserved[3]
      writer.ascii(options.name)
      writer.u8(0) // null terminator
    },
  }
}

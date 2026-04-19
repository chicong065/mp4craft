import type { Box } from '@/boxes/box'

/**
 * ISOBMFF FullBox value: a {@link Box} extended with a 1-byte `version` and a 3-byte `flags`
 * header that follow the fourcc.
 *
 * Per ISO/IEC 14496-12 §4.2, a FullBox inherits the plain Box header (4-byte `size`, 4-byte
 * `type` fourcc) and adds two fields immediately after the fourcc: a 1-byte `version` and a
 * 3-byte `flags` field. The `writeBox` serializer emits those 4 bytes automatically whenever
 * a `Box` value exposes numeric `version` and `flags` properties, so a FullBox body writer
 * should start at the byte after the flags.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export type FullBox = Box & {
  /**
   * The 1-byte version that selects the field layout of the FullBox body. Most boxes support
   * `0` (32-bit times and sizes) and `1` (64-bit times and sizes).
   */
  version: number
  /**
   * The 3-byte flags field, bit-packed per the owning box's specification (for example, the
   * `track_enabled` bit in `tkhd`).
   */
  flags: number
}

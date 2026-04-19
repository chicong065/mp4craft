import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a `SoundMediaHeaderBox` (`smhd`) per ISO/IEC 14496-12 §12.2.2.
 *
 * `smhd` is a FullBox (version 0, flags 0) that lives inside `minf` for audio
 * tracks. The payload is a 16-bit stereo `balance` field in 8.8 fixed-point
 * format (0 for center balance) followed by a 16-bit reserved field.
 *
 * @returns A `FullBox` whose serializer writes the fixed sound media header payload.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createSmhd(): FullBox {
  return {
    type: 'smhd',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u16(0) // balance (0 = center)
      writer.u16(0) // reserved
    },
  }
}

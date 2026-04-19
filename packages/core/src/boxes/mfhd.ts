import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMfhd}.
 */
export type MfhdOptions = {
  /**
   * Monotonically increasing fragment sequence number, starting at 1. Each `moof` in the
   * file must carry a unique, strictly increasing value. Parsers use the sequence number
   * to detect missing or out-of-order fragments.
   */
  sequenceNumber: number
}

/**
 * Builds a `MovieFragmentHeaderBox` (`mfhd`), the first child of every `moof`.
 *
 * Per ISO/IEC 14496-12 §8.8.5, `mfhd` is a FullBox whose body is a single u32
 * `sequence_number`. mp4craft emits a new `mfhd` with an incremented value on every
 * fragment flush.
 *
 * @param options - The fragment sequence number for this `moof`.
 * @returns A {@link FullBox} that serializes to a 16-byte `mfhd` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMfhd(options: MfhdOptions): FullBox {
  return {
    type: 'mfhd',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.sequenceNumber)
    },
  }
}

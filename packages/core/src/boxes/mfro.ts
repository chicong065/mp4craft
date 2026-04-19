import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMfro}.
 */
export type MfroOptions = {
  /**
   * Total byte length of the enclosing `mfra` box, including the `mfro` itself. Parsers
   * read this value from the last four bytes of the file and seek backward by the same
   * amount to locate `mfra`.
   */
  mfraByteLength: number
}

/**
 * Builds a `MovieFragmentRandomAccessOffsetBox` (`mfro`), the tail marker of every `mfra`.
 *
 * Per ISO/IEC 14496-12 §8.8.11, `mfro` carries a u32 value equal to the total size of the
 * enclosing `mfra` box. Parsers seek to the final four bytes of the file to read the
 * value and then seek backward by the same amount to locate `mfra`.
 *
 * @param options - The total byte length of the enclosing `mfra`.
 * @returns A {@link FullBox} that serializes to a 16-byte `mfro` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMfro(options: MfroOptions): FullBox {
  return {
    type: 'mfro',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.mfraByteLength)
    },
  }
}

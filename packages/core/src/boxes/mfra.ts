import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'
import { createMfro } from '@/boxes/mfro'

/**
 * Options for {@link createMfra}.
 */
export type MfraOptions = {
  /** One `tfra` box per track, in declaration order. */
  tfras: FullBox[]
  /**
   * Total byte length of the enclosing `mfra` box as serialized to disk, used to populate
   * the tail `mfro`. Because `mfro` has a fixed 16-byte size regardless of the value it
   * carries, callers compute `totalByteLength` in two passes: a first pass with a
   * placeholder value to measure the serialized length, then a second pass with the
   * measured value written into the final output.
   */
  totalByteLength: number
}

/**
 * Builds a `MovieFragmentRandomAccessBox` (`mfra`), an optional tail container that lists
 * per-track random-access information for every fragment in the file.
 *
 * Per ISO/IEC 14496-12 §8.8.9, `mfra` contains zero or more `tfra` boxes followed by
 * exactly one `mfro`. mp4craft emits one `tfra` per track plus the closing `mfro`.
 *
 * @param options - Per-track `tfra` list and the pre-computed total `mfra` byte length.
 * @returns A {@link Box} that serializes `mfra` with every `tfra` in order followed by `mfro`.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMfra(options: MfraOptions): Box {
  return {
    type: 'mfra',
    write: (writer) => {
      for (const tfraBox of options.tfras) writeBox(writer, tfraBox)
      writeBox(writer, createMfro({ mfraByteLength: options.totalByteLength }))
    },
  }
}

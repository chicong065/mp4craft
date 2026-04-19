import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a `SyncSampleBox` (`stss`) per ISO/IEC 14496-12 §8.6.2.
 *
 * `stss` is a FullBox (version 0, flags 0) listing the 1-based sample numbers
 * that are sync samples (keyframes). The presence of this box implies that not
 * every sample is a sync sample, so any sample number absent from the table is
 * treated as a non-sync sample. Audio tracks typically omit `stss` entirely
 * because every audio frame is independently decodable, in which case every
 * sample is implicitly a sync sample.
 *
 * @param syncSamples - 1-based sample numbers, in ascending order, of the samples
 *   that are keyframes. Zero-based indices are not permitted by the spec.
 * @returns A `FullBox` whose serializer writes the entry count followed by one
 *   32-bit sample number per keyframe.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStss(syncSamples: number[]): FullBox {
  return {
    type: 'stss',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(syncSamples.length)
      for (const sampleNumber of syncSamples) writer.u32(sampleNumber)
    },
  }
}

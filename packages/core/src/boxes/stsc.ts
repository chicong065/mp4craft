import type { FullBox } from '@/boxes/full-box'

/**
 * A single run-length entry of the `SampleToChunkBox` (`stsc`).
 *
 * Each entry declares that the chunk numbered `firstChunk` and every subsequent chunk,
 * up to but not including the `firstChunk` of the next entry, holds exactly
 * `samplesPerChunk` samples and uses sample description index `descIndex`. The final
 * entry extends to the last chunk in the track.
 */
export type StscEntry = {
  /** 1-based chunk number at which this run begins. */
  firstChunk: number
  /** Number of samples packed into each chunk in this run. */
  samplesPerChunk: number
  /**
   * 1-based index into the `SampleDescriptionBox` entry list for the samples in
   * this run. Typically 1 because the muxer emits exactly one sample entry per track.
   */
  descIndex: number
}

/**
 * Builds a `SampleToChunkBox` (`stsc`) per ISO/IEC 14496-12 §8.7.4.
 *
 * `stsc` is a FullBox (version 0, flags 0) carrying a run-length-encoded map from
 * chunks to their samples-per-chunk count and sample description index. Consecutive
 * runs of chunks that share the same `(samplesPerChunk, descIndex)` pair are
 * collapsed into one entry.
 *
 * @param entries - Run-length entries covering every chunk in the track. The first
 *   entry must have `firstChunk` equal to 1.
 * @returns A `FullBox` whose serializer writes the entry count followed by each
 *   `(firstChunk, samplesPerChunk, descIndex)` triple as three 32-bit unsigned integers.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStsc(entries: StscEntry[]): FullBox {
  return {
    type: 'stsc',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(entries.length)
      for (const entry of entries) {
        writer.u32(entry.firstChunk)
        writer.u32(entry.samplesPerChunk)
        writer.u32(entry.descIndex)
      }
    },
  }
}

import type { FullBox } from '@/boxes/full-box'

/**
 * A single run-length entry of the `DecodingTimeToSampleBox` (`stts`).
 *
 * Each entry compresses `count` consecutive samples that share the same decode-time
 * delta, so an entry of `{ count: 30, delta: 1000 }` encodes 30 samples in a row
 * whose decode times advance by 1000 media-timescale ticks per sample.
 */
export type SttsEntry = {
  /** Number of consecutive samples, starting at the next unassigned sample number, that share `delta`. */
  count: number
  /** Decode-time increment, in media-timescale units, applied to each of the `count` samples. */
  delta: number
}

/**
 * Builds a `DecodingTimeToSampleBox` (`stts`) per ISO/IEC 14496-12 §8.6.1.2.
 *
 * `stts` is a FullBox (version 0, flags 0) carrying a run-length-encoded table of
 * (sample-count, sample-delta) pairs. Summing `count * delta` across all entries
 * yields the track duration in media-timescale units.
 *
 * @param entries - Run-length entries covering every sample in the track in
 *   decoding order. Consecutive samples that share the same delta should be
 *   merged into a single entry for compactness.
 * @returns A `FullBox` whose serializer writes the entry count followed by each
 *   `(count, delta)` pair as a pair of 32-bit unsigned integers.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStts(entries: SttsEntry[]): FullBox {
  return {
    type: 'stts',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(entries.length)
      for (const entry of entries) {
        writer.u32(entry.count)
        writer.u32(entry.delta)
      }
    },
  }
}

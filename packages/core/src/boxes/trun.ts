import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTrun}.
 */
export type TrunOptions = {
  /**
   * Byte offset from the start of the enclosing `moof` to the first sample in this run.
   * Used because `tfhd.flags` sets `default-base-is-moof`. The value is typed as a signed
   * 32-bit integer in the spec.
   */
  dataOffset: number
  /** Per-sample metadata for every sample in the run. */
  samples: TrunSample[]
}

/**
 * Metadata for a single sample inside a `trun`. Each field is written as a u32.
 */
export type TrunSample = {
  /** Sample duration in the track timescale. */
  duration: number
  /** Sample size in bytes. */
  size: number
  /** Sample flags, encoded with {@link encodeTrunSampleFlags}. */
  flags: number
}

/**
 * Flag combination used by mp4craft: data_offset plus per-sample duration, size, and
 * flags. Defined in ISO/IEC 14496-12 §8.8.8.
 *
 * - `0x000001` data_offset_present
 * - `0x000100` sample_duration_present
 * - `0x000200` sample_size_present
 * - `0x000400` sample_flags_present
 */
const TRUN_FLAGS_MP4CRAFT = 0x000001 | 0x000100 | 0x000200 | 0x000400

/**
 * Encodes a sample-flags u32 for {@link TrunSample.flags}. The bit layout is defined by
 * ISO/IEC 14496-12 §8.6.4.3.
 *
 * A keyframe uses `sample_depends_on = 2` (no prior samples are referenced) with
 * `sample_is_non_sync_sample = 0`. Every other sample uses `sample_depends_on = 1`
 * (depends on prior samples) with `sample_is_non_sync_sample = 1`. All other fields in
 * the bitfield remain zero.
 *
 * @param isKeyFrame - Whether this sample is a sync (random-access) sample.
 * @returns The encoded 32-bit sample-flags value.
 *
 * @see ISO/IEC 14496-12 §8.6.4.3 for the full bitfield layout.
 */
export function encodeTrunSampleFlags(isKeyFrame: boolean): number {
  if (isKeyFrame) {
    // sample_depends_on = 2 at bits 25-24.
    return 0x02000000
  }
  // sample_depends_on = 1 at bits 25-24 and sample_is_non_sync_sample = 1 at bit 16.
  return 0x01010000
}

/**
 * Builds a `TrackRunBox` (`trun`) listing every sample in a fragment's track.
 *
 * Per ISO/IEC 14496-12 §8.8.8, `trun` is a FullBox whose body begins with a u32
 * `sample_count`, followed by optional leading fields controlled by the `flags` bitfield,
 * then per-sample records. mp4craft uses `flags = 0x000701` so every `trun` carries a
 * `data_offset` and per-sample `duration`, `size`, and `flags`.
 *
 * @param options - `dataOffset` from the start of the parent `moof` to the first sample
 *   byte, plus the per-sample list.
 * @returns A {@link FullBox} that serializes a `trun` box with one record per sample.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTrun(options: TrunOptions): FullBox {
  return {
    type: 'trun',
    version: 0,
    flags: TRUN_FLAGS_MP4CRAFT,
    write: (writer) => {
      writer.u32(options.samples.length)
      writer.i32(options.dataOffset)
      for (const sample of options.samples) {
        writer.u32(sample.duration)
        writer.u32(sample.size)
        writer.u32(sample.flags)
      }
    },
  }
}

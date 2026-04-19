import type { FullBox } from '@/boxes/full-box'

/**
 * Per-fragment random-access entry inside a `tfra` box. Every numeric field describes the
 * state of the file at the time the corresponding `moof` was written.
 */
export type TfraEntry = {
  /** First-sample decode time of the referenced fragment in the track's timescale. */
  timeInTrackTimescale: bigint
  /** Absolute byte offset of the referenced `moof` from the start of the file. */
  moofOffsetFromFileStart: bigint
  /**
   * One-based index of the `traf` inside the `moof`. Always 1 for mp4craft because each
   * `moof` contains one `traf` per track.
   */
  trafNumber: number
  /**
   * One-based index of the `trun` inside the `traf`. Always 1 for mp4craft because each
   * `traf` contains a single sample run.
   */
  trunNumber: number
  /**
   * One-based index of the first sync sample inside the `trun`. Always 1 for mp4craft
   * because every fragment begins at a keyframe.
   */
  sampleNumber: number
}

/**
 * Options for {@link createTfra}.
 */
export type TfraOptions = {
  /** Track identifier this `tfra` belongs to. Must match an existing `tkhd.trackId`. */
  trackId: number
  /** One entry per fragment, in declaration order. */
  entries: TfraEntry[]
}

/**
 * Builds a `TrackFragmentRandomAccessBox` (`tfra`).
 *
 * Per ISO/IEC 14496-12 §8.8.10, `tfra` maps decode times to `moof` byte offsets for a
 * single track. mp4craft emits version 1 (`u64` time and `moof_offset`) plus the minimum
 * one-byte encodings for `traf`, `trun`, and sample indexes because each fragment contains
 * exactly one `traf` per track, one `trun` per `traf`, and its first sample is a sync sample.
 *
 * @param options - Track identifier and per-fragment entry list.
 * @returns A {@link FullBox} whose serializer writes the spec-mandated layout.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTfra(options: TfraOptions): FullBox {
  return {
    type: 'tfra',
    version: 1,
    flags: 0,
    write: (writer) => {
      writer.u32(options.trackId)
      // Reserved (26 bits) plus three 2-bit length fields for traf_number, trun_number, and
      // sample_number. Each length is encoded as 0, meaning one byte per field in every entry.
      writer.u32(0)
      writer.u32(options.entries.length)
      for (const entry of options.entries) {
        writer.u64(entry.timeInTrackTimescale)
        writer.u64(entry.moofOffsetFromFileStart)
        writer.u8(entry.trafNumber)
        writer.u8(entry.trunNumber)
        writer.u8(entry.sampleNumber)
      }
    },
  }
}

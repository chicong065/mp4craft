import type { StscEntry } from '@/boxes/stsc'
import type { SttsEntry } from '@/boxes/stts'

/**
 * Per-sample metadata stored in the sample table as each encoded sample arrives.
 */
export type SampleInfo = {
  /** Sample payload size in bytes, used to populate `stsz`. */
  size: number
  /** Sample duration in the track's media timescale, used to populate `stts`. */
  duration: number
  /** True when the sample is a random-access point, used to populate `stss` (video only). */
  isKeyFrame: boolean
  /**
   * Byte offset of the chunk containing this sample, used to populate `stco` or `co64`. The
   * muxer stores the value as provided, which may be file-absolute (progressive mode) or
   * relative to the in-memory sample buffer (`fastStart: "in-memory"` mode).
   */
  chunkOffset: number
}

/**
 * Aggregated sample-table data returned by {@link SampleTable#build}, ready to be fed into
 * the per-box builders inside `stbl`.
 */
export type SampleTableBuildResult = {
  /** Total number of samples recorded. */
  sampleCount: number
  /** Sum of all sample durations in the track's media timescale. */
  totalDuration: number
  /** Run-length-encoded sample durations for `stts`. */
  sttsEntries: SttsEntry[]
  /** Chunk-to-sample mapping for `stsc`. The muxer emits one sample per chunk. */
  stscEntries: StscEntry[]
  /** Per-sample sizes for `stsz`. */
  sampleSizes: number[]
  /** Per-chunk offsets for `stco` or `co64`. */
  chunkOffsets: number[]
  /** 1-based sync sample indices for `stss`. Present only for video tracks. */
  syncSamples?: number[]
  /** Whether any chunk offset exceeds `0xFFFFFFFF`, signaling the need for `co64`. */
  needs64Bit: boolean
}

/**
 * Accumulates per-sample entries as samples arrive and emits the final sample-table payloads
 * (`stts`, `stsc`, `stsz`, `stco` or `co64`, and `stss`) at finalize time.
 *
 * @remarks
 * The muxer currently emits one sample per chunk, so the `stsc` table always collapses to a
 * single entry. The `stts` run-length encoding is built incrementally: consecutive samples
 * with identical durations extend the current run, otherwise a new run is started.
 */
export class SampleTable {
  private totalSampleCount = 0
  private totalDurationAccumulator = 0
  private readonly sttsRuns: SttsEntry[] = []
  private readonly sampleSizes: number[] = []
  private readonly chunkOffsets: number[] = []
  private readonly keyframeSampleNumbers: number[] = []
  private requires64BitOffsets = false

  /**
   * Constructs an empty sample table.
   *
   * @param config - Static configuration. `isVideo` controls whether a sync-sample list is
   *   accumulated for `stss`.
   */
  constructor(private readonly config: { isVideo: boolean }) {}

  /**
   * Records one sample, updating the sample count, duration accumulator, sizes, chunk offsets,
   * the `stts` run-length buffer, and (for video) the keyframe list.
   *
   * @param sampleInfo - Metadata describing the sample just committed to the container.
   */
  addSample(sampleInfo: SampleInfo): void {
    this.totalSampleCount += 1
    this.totalDurationAccumulator += sampleInfo.duration
    this.sampleSizes.push(sampleInfo.size)
    this.chunkOffsets.push(sampleInfo.chunkOffset)

    const lastRun = this.sttsRuns[this.sttsRuns.length - 1]
    if (lastRun && lastRun.delta === sampleInfo.duration) {
      lastRun.count += 1
    } else {
      this.sttsRuns.push({ count: 1, delta: sampleInfo.duration })
    }

    if (this.config.isVideo && sampleInfo.isKeyFrame) {
      this.keyframeSampleNumbers.push(this.totalSampleCount)
    }

    if (sampleInfo.chunkOffset > 0xffffffff) {
      this.requires64BitOffsets = true
    }
  }

  /**
   * Emits the accumulated payloads for the `stbl` child boxes. Returns fresh copies of the
   * internal arrays so that subsequent {@link SampleTable#addSample} calls cannot mutate an
   * already-returned result.
   *
   * @returns A {@link SampleTableBuildResult} containing everything needed to build `stts`,
   *   `stsc`, `stsz`, `stco` or `co64`, and (for video) `stss`.
   */
  build(): SampleTableBuildResult {
    return {
      sampleCount: this.totalSampleCount,
      totalDuration: this.totalDurationAccumulator,
      sttsEntries: this.sttsRuns.map((run) => ({ ...run })),
      stscEntries: [{ firstChunk: 1, samplesPerChunk: 1, descIndex: 1 }],
      sampleSizes: [...this.sampleSizes],
      chunkOffsets: [...this.chunkOffsets],
      ...(this.config.isVideo ? { syncSamples: [...this.keyframeSampleNumbers] } : {}),
      needs64Bit: this.requires64BitOffsets,
    }
  }
}

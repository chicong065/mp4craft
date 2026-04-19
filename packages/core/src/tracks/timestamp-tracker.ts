import { StateError } from '@/types/errors'

/**
 * Policy that controls how the very first observed sample timestamp on a track is handled.
 *
 * @remarks
 * - `"strict"`: the first sample must already be at timestamp `0`. Any other value throws a
 *   {@link StateError}. Useful for callers that pre-normalize their encoder output.
 * - `"offset"`: the first timestamp is subtracted from every subsequent timestamp so the track
 *   begins at `0`. This is the default in the muxer and matches typical WebCodecs pipelines
 *   where the first encoded frame carries a non-zero wall-clock-derived timestamp.
 * - `"permissive"`: timestamps are used verbatim. The MP4 edit list mechanism is left to the
 *   caller (or an upstream player) to compensate for a non-zero start time.
 */
export type FirstTimestampBehavior = 'strict' | 'offset' | 'permissive'

/**
 * Applies a {@link FirstTimestampBehavior} policy to a stream of incoming timestamps.
 *
 * A new instance is constructed per track. The first call to {@link TimestampTracker#adjust}
 * records the reference timestamp, and subsequent calls apply the chosen policy.
 */
export class TimestampTracker {
  private firstObservedTimestamp: number | null = null

  /**
   * Constructs a tracker bound to a specific policy.
   *
   * @param mode - The first-timestamp policy to apply.
   */
  constructor(private readonly mode: FirstTimestampBehavior) {}

  /**
   * Applies the policy to one timestamp and returns the value the caller should use for
   * sample timing.
   *
   * On the first invocation, the supplied `timestamp` is recorded as the reference. In
   * `"strict"` mode the first timestamp must equal `0`. In `"offset"` mode every returned
   * timestamp is shifted by subtracting the reference, so the track starts at `0`. In
   * `"permissive"` mode timestamps pass through unchanged.
   *
   * @param timestamp - Presentation timestamp of the current sample, in microseconds.
   * @returns The timestamp after policy adjustment, in microseconds.
   * @throws {@link StateError} When `mode` is `"strict"` and the first observed timestamp is
   *   not `0`.
   */
  adjust(timestamp: number): number {
    if (this.firstObservedTimestamp === null) {
      this.firstObservedTimestamp = timestamp
      if (this.mode === 'strict' && timestamp !== 0) {
        throw new StateError(`firstTimestampBehavior='strict' but first timestamp was ${timestamp}; expected 0`)
      }
    }
    if (this.mode === 'offset') {
      return timestamp - this.firstObservedTimestamp
    }
    return timestamp
  }
}

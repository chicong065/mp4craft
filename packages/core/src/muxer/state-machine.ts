import { StateError } from '@/types/errors'

/**
 * Lifecycle phase of an {@link Mp4Muxer} instance, tracked by {@link StateMachine}.
 *
 * @remarks
 * Transitions: `"idle"` moves to `"writing"` on the first sample, `"writing"` moves to
 * `"finalized"` on `finalize()`. No other transitions are legal.
 */
export type MuxerState = 'idle' | 'writing' | 'finalized'

/**
 * Internal helper that enforces the muxer lifecycle ordering.
 *
 * @remarks
 * Not part of the public API surface (it is not re-exported from `index.ts`), documented here
 * to aid readers of the muxer source. The state machine raises {@link StateError} whenever an
 * operation is invoked in the wrong phase, which {@link Mp4Muxer} then surfaces to callers.
 */
export class StateMachine {
  private currentState: MuxerState = 'idle'

  /** Current lifecycle phase. See {@link MuxerState}. */
  get state(): MuxerState {
    return this.currentState
  }

  /**
   * Records that a sample is being appended. Transitions from `"idle"` to `"writing"` on
   * the first call, remains in `"writing"` thereafter.
   *
   * @throws {@link StateError} When called after `onFinalize()`.
   */
  onSample(): void {
    if (this.currentState === 'finalized') {
      throw new StateError('Cannot add samples after finalize()')
    }
    if (this.currentState === 'idle') {
      this.currentState = 'writing'
    }
  }

  /**
   * Records that `finalize()` has been invoked. Transitions from `"writing"` to
   * `"finalized"`.
   *
   * @throws {@link StateError} When called in `"idle"` (no samples appended) or after a
   *   previous `onFinalize()` call.
   */
  onFinalize(): void {
    if (this.currentState === 'idle') {
      throw new StateError('Cannot finalize() before any samples were added')
    }
    if (this.currentState === 'finalized') {
      throw new StateError('finalize() was already called')
    }
    this.currentState = 'finalized'
  }
}

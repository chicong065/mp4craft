import { TimestampTracker } from '@/tracks/timestamp-tracker'
import { StateError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('TimestampTracker', () => {
  it('offset mode subtracts the first timestamp', () => {
    const tracker = new TimestampTracker('offset')
    expect(tracker.adjust(1_000)).toBe(0)
    expect(tracker.adjust(4_000)).toBe(3_000)
    expect(tracker.adjust(7_000)).toBe(6_000)
  })

  it('strict mode throws on non-zero first timestamp', () => {
    const tracker = new TimestampTracker('strict')
    expect(() => tracker.adjust(1_000)).toThrowError(StateError)
  })

  it('strict mode passes zero-first through', () => {
    const tracker = new TimestampTracker('strict')
    expect(tracker.adjust(0)).toBe(0)
    expect(tracker.adjust(3_000)).toBe(3_000)
  })

  it('permissive mode does not rewrite', () => {
    const tracker = new TimestampTracker('permissive')
    expect(tracker.adjust(5_000)).toBe(5_000)
  })
})

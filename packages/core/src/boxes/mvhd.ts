import type { FullBox } from '@/boxes/full-box'
import { UNITY_MATRIX_3X3 } from '@/boxes/matrix'

/**
 * Options for constructing a `MovieHeaderBox` (`mvhd`).
 *
 * Times and duration are expressed in units of `timescale` per second, per ISO/IEC 14496-12
 * §8.2.2. This builder emits the version 0 layout (32-bit times and duration).
 */
export type MvhdOptions = {
  /**
   * Seconds since 1904-01-01 UTC at which the movie was created. Defaults to `0` when omitted.
   */
  creationTime?: number
  /**
   * Seconds since 1904-01-01 UTC at which the movie was last modified. Defaults to `0` when
   * omitted.
   */
  modificationTime?: number
  /**
   * Number of time units that pass per second in the movie's timeline, used to interpret
   * `duration` and per-track composition times.
   */
  timescale: number
  /**
   * The movie duration expressed in `timescale` units. Should equal the longest track duration
   * converted into the movie timescale.
   */
  duration: number
  /**
   * The value to place in the movie header's `next_track_ID` field, one greater than the
   * largest `track_ID` used so far. A value of `0` is not permitted per §8.2.2.
   */
  nextTrackId: number
}

/**
 * Builds a `MovieHeaderBox` (`mvhd`) describing the movie's global timing and transformation.
 *
 * Per ISO/IEC 14496-12 §8.2.2, `mvhd` is a FullBox written at version 0 with:
 *   - 32-bit creation and modification times (seconds since 1904-01-01 UTC),
 *   - the movie timescale and duration,
 *   - a fixed preferred rate of `1.0` (16.16 fixed-point, `0x00010000`),
 *   - a fixed preferred volume of `1.0` (8.8 fixed-point, `0x0100`),
 *   - the 9-entry {@link UNITY_MATRIX_3X3} transformation matrix,
 *   - 24 bytes of reserved `pre_defined` zeros,
 *   - and the `next_track_ID` field.
 *
 * @param options - Movie timing and next-track-ID values (see {@link MvhdOptions}).
 * @returns A {@link FullBox} whose serializer emits the `mvhd` body per §8.2.2 version 0.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createMvhd(options: MvhdOptions): FullBox {
  return {
    type: 'mvhd',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.creationTime ?? 0)
      writer.u32(options.modificationTime ?? 0)
      writer.u32(options.timescale)
      writer.u32(options.duration)
      writer.u32(0x00010000) // rate = 1.0 in 16.16 fixed-point
      writer.u16(0x0100) // volume = 1.0 in 8.8 fixed-point
      writer.zeros(2) // reserved
      writer.zeros(8) // reserved
      for (const matrixEntry of UNITY_MATRIX_3X3) writer.u32(matrixEntry)
      writer.zeros(24) // pre_defined
      writer.u32(options.nextTrackId)
    },
  }
}

import type { FullBox } from '@/boxes/full-box'
import { UNITY_MATRIX_3X3 } from '@/boxes/matrix'

/**
 * Options for constructing a `TrackHeaderBox` (`tkhd`).
 *
 * Times and duration are in movie-timescale units per ISO/IEC 14496-12 §8.3.2. This builder
 * emits the version 0 layout (32-bit times and duration).
 */
export type TkhdOptions = {
  /**
   * The track's `track_ID`, a non-zero integer unique within the enclosing movie. Per §8.3.2,
   * `track_ID` values must not be reused and must not be `0`.
   */
  trackId: number
  /**
   * The track duration expressed in movie-timescale units (the timescale from `mvhd`, not the
   * per-track media timescale from `mdhd`).
   */
  duration: number
  /**
   * Visual presentation width in pixels. Encoded as a 16.16 fixed-point integer via
   * `(width | 0) * 0x10000`, so only the integer part is preserved. Set to `0` on audio tracks.
   */
  width: number
  /**
   * Visual presentation height in pixels. Encoded as a 16.16 fixed-point integer via
   * `(height | 0) * 0x10000`, so only the integer part is preserved. Set to `0` on audio tracks.
   */
  height: number
  /**
   * Whether this track carries audio. When `true`, the `volume` field is written as `1.0` in
   * 8.8 fixed-point (`0x0100`), otherwise it is written as `0` per §8.3.2.
   */
  isAudio: boolean
  /**
   * Seconds since 1904-01-01 UTC at which the track was created. Defaults to `0` when omitted.
   */
  creationTime?: number
  /**
   * Seconds since 1904-01-01 UTC at which the track was last modified. Defaults to `0` when
   * omitted.
   */
  modificationTime?: number
}

/**
 * Builds a `TrackHeaderBox` (`tkhd`) describing one track's identity, duration, and visual
 * presentation.
 *
 * Per ISO/IEC 14496-12 §8.3.2, `tkhd` is a FullBox written at version 0 with the
 * `track_enabled` bit (`0x000001`) set in its flags. The body carries creation and
 * modification times, the unique `track_ID`, reserved fields, the duration, the layer and
 * alternate-group integers, the volume, the 9-entry {@link UNITY_MATRIX_3X3} transform, and
 * the 16.16 fixed-point width and height.
 *
 * @remarks
 * Width and height are truncated to integers before the 16.16 conversion (`(v | 0) * 0x10000`).
 * Fractional pixel dimensions are not supported by this builder.
 *
 * @param options - Track identity, duration, geometry, and audio flag (see {@link TkhdOptions}).
 * @returns A {@link FullBox} whose serializer emits the `tkhd` body per §8.3.2 version 0.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createTkhd(options: TkhdOptions): FullBox {
  return {
    type: 'tkhd',
    version: 0,
    flags: 0x000001, // track_enabled
    write: (writer) => {
      writer.u32(options.creationTime ?? 0)
      writer.u32(options.modificationTime ?? 0)
      writer.u32(options.trackId)
      writer.zeros(4) // reserved
      writer.u32(options.duration)
      writer.zeros(8) // reserved
      writer.u16(0) // layer
      writer.u16(0) // alternate_group
      writer.u16(options.isAudio ? 0x0100 : 0) // volume: 1.0 for audio, 0 for video
      writer.zeros(2) // reserved
      for (const matrixEntry of UNITY_MATRIX_3X3) writer.u32(matrixEntry)
      writer.u32((options.width | 0) * 0x10000) // width in 16.16 fixed-point
      writer.u32((options.height | 0) * 0x10000) // height in 16.16 fixed-point
    },
  }
}

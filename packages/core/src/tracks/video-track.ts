import type { Box } from '@/boxes/box'
import { createVmhd } from '@/boxes/vmhd'
import { Track, type TrackOptions } from '@/tracks/track'

/**
 * Concrete {@link Track} subclass for video. Uses the `vide` handler type and a `vmhd` media
 * header, and exposes the displayed picture dimensions from {@link TrackOptions} (`width` and
 * `height`) into the `tkhd` box.
 *
 * @remarks
 * The displayed dimensions are decoupled from the codec's internal coded dimensions on
 * purpose. AVC derives its coded size from the SPS, but HEVC and VP9 do not parse their
 * configuration records, so the caller provides the displayed size explicitly. This avoids
 * HEVC SPS and VP9 uncompressed-header parsing while still producing a correctly-populated
 * `tkhd`.
 */
export class VideoTrack extends Track {
  /**
   * Constructs a video track.
   *
   * @param options - Shared track configuration. `width` and `height` should be populated for
   *   any track that will be played back.
   */
  constructor(options: TrackOptions) {
    super(options, true)
  }

  /** Always `"vide"` for video tracks, written into the `hdlr` box. */
  override get handlerType(): 'vide' {
    return 'vide'
  }
  /** Returns a freshly built `vmhd` media header box. */
  override get mediaHeader(): Box {
    return createVmhd()
  }
  /** Always `true` for video tracks. */
  override get isVideo(): true {
    return true
  }

  /** Displayed width from {@link TrackOptions.width}, or `0` when not supplied. */
  protected override get videoWidth(): number {
    return this.options.width ?? 0
  }
  /** Displayed height from {@link TrackOptions.height}, or `0` when not supplied. */
  protected override get videoHeight(): number {
    return this.options.height ?? 0
  }
}

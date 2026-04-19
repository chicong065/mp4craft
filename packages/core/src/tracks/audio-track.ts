import type { Box } from '@/boxes/box'
import { createSmhd } from '@/boxes/smhd'
import { Track, type TrackOptions } from '@/tracks/track'

/**
 * Concrete {@link Track} subclass for audio. Uses the `soun` handler type and a `smhd` media
 * header, and reports zero displayed dimensions (audio tracks have no visual region in `tkhd`).
 */
export class AudioTrack extends Track {
  /**
   * Constructs an audio track.
   *
   * @param options - Shared track configuration. `width` and `height` are ignored for audio.
   */
  constructor(options: TrackOptions) {
    super(options, false)
  }

  /** Always `"soun"` for audio tracks, written into the `hdlr` box. */
  override get handlerType(): 'soun' {
    return 'soun'
  }
  /** Returns a freshly built `smhd` media header box. */
  override get mediaHeader(): Box {
    return createSmhd()
  }
  /** Always `false` for audio tracks. */
  override get isVideo(): false {
    return false
  }
}

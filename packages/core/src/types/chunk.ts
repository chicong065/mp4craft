/**
 * A raw encoded video sample appended via {@link Mp4Muxer.addVideoSample}.
 *
 * @remarks
 * Intended for Node.js pipelines and custom encoders that produce encoded bytes directly
 * without going through WebCodecs. Browser code that already holds an `EncodedVideoChunk`
 * should prefer {@link Mp4Muxer.addVideoChunk}, which forwards to this shape internally.
 *
 * @see {@link https://w3c.github.io/webcodecs/#encodedvideochunk | EncodedVideoChunk}
 */
export type VideoSampleInput = {
  /**
   * Encoded sample bytes in the codec's native bitstream format (for example
   * length-prefixed NAL units for AVC / HEVC). The view must be backed by a
   * regular `ArrayBuffer`. The buffer is read synchronously by the muxer and
   * may be reused by the caller on return.
   */
  data: Uint8Array<ArrayBuffer>
  /**
   * Presentation timestamp of the sample, in microseconds. Matches the WebCodecs convention
   * where `EncodedVideoChunk.timestamp` is also microseconds.
   */
  timestamp: number
  /**
   * Sample duration in microseconds. Matches the WebCodecs convention where
   * `EncodedVideoChunk.duration` is microseconds.
   */
  duration: number
  /**
   * Whether the sample is a keyframe (sync sample). Keyframes are recorded in the track's
   * `stss` box so players can seek to them without scanning from the start.
   */
  isKeyFrame: boolean
}

/**
 * A raw encoded audio sample appended via {@link Mp4Muxer.addAudioSample}.
 *
 * @remarks
 * Intended for Node.js pipelines and custom encoders that produce encoded bytes directly
 * without going through WebCodecs. Browser code that already holds an `EncodedAudioChunk`
 * should prefer {@link Mp4Muxer.addAudioChunk}, which forwards to this shape internally.
 *
 * @see {@link https://w3c.github.io/webcodecs/#encodedaudiochunk | EncodedAudioChunk}
 */
export type AudioSampleInput = {
  /**
   * Encoded sample bytes in the codec's native bitstream format (for example
   * a raw AAC access unit, or an Opus packet). The view must be backed by a
   * regular `ArrayBuffer`. The buffer is read synchronously by the muxer and
   * may be reused by the caller on return.
   */
  data: Uint8Array<ArrayBuffer>
  /** Presentation timestamp of the sample, in microseconds. */
  timestamp: number
  /** Sample duration in microseconds. */
  duration: number
  /**
   * Whether the sample is a keyframe (sync sample). Defaults to `true` when omitted, which
   * matches the common case of lossy audio codecs where every frame is independently
   * decodable.
   */
  isKeyFrame?: boolean
}

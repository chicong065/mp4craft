/*
 * Thin WebCodecs helpers used by the mp4craft playground scenarios. Each factory
 * wires up a `VideoEncoder` or `AudioEncoder`, captures the first emitted decoder
 * configuration into a promise, and exposes a uniform `close` helper so scenarios
 * can flush and release the encoder with a single await.
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 */

/**
 * Copies the bytes of an `AllowSharedBufferSource` into a fresh `ArrayBuffer`-backed
 * `Uint8Array`. The mp4craft public `VideoTrackConfig.description` and
 * `AudioTrackConfig.description` fields accept `ArrayBuffer | ArrayBufferView`, which
 * excludes `SharedArrayBuffer`. Normalizing here keeps the scenario code free of
 * buffer-kind casts.
 *
 * @param sharedOrOwnedBuffer - The decoder configuration bytes emitted by WebCodecs.
 * @returns A fresh `Uint8Array` whose backing store is a regular `ArrayBuffer`.
 */
function copyToArrayBufferBackedBytes(sharedOrOwnedBuffer: AllowSharedBufferSource): Uint8Array<ArrayBuffer> {
  const sourceView =
    sharedOrOwnedBuffer instanceof ArrayBuffer || sharedOrOwnedBuffer instanceof SharedArrayBuffer
      ? new Uint8Array(sharedOrOwnedBuffer)
      : new Uint8Array(sharedOrOwnedBuffer.buffer, sharedOrOwnedBuffer.byteOffset, sharedOrOwnedBuffer.byteLength)
  const ownedBytes = new Uint8Array(new ArrayBuffer(sourceView.byteLength))
  ownedBytes.set(sourceView)
  return ownedBytes
}

/**
 * Codec-specific configuration hints that can be spread into the underlying
 * `VideoEncoder.configure` call. Excludes the mandatory fields the pipeline
 * always provides so callers cannot accidentally overwrite them.
 *
 * Used by scenarios that need to pass through codec-specific directives such
 * as `{avc: {format: "avc"}}` to keep Chrome emitting length-prefixed NAL
 * units rather than AnnexB. Keeping the field optional preserves backward
 * compatibility for scenarios that do not need codec-specific hints.
 */
export type VideoEncoderExtraConfigureOptions = Partial<
  Omit<VideoEncoderConfig, 'codec' | 'width' | 'height' | 'framerate' | 'bitrate'>
>

/**
 * Options accepted by {@link createVideoEncoderPipeline}.
 */
export type VideoEncoderPipelineOptions = {
  /** WebCodecs codec string, for example `"avc1.42001f"` (AVC Baseline 3.1). */
  codec: string
  /** Output frame width in pixels. */
  width: number
  /** Output frame height in pixels. */
  height: number
  /** Target frame rate in frames per second. */
  framerate: number
  /** Target bitrate in bits per second. */
  bitrate: number
  /** Called once per encoded chunk. */
  onChunk: (chunk: EncodedVideoChunk, metadata: EncodedVideoChunkMetadata | undefined) => void
  /** Called when the encoder surfaces a fatal error. */
  onError: (reason: Error) => void
  /**
   * Codec-specific configuration hints spread into the `configure` call. AVC
   * callers typically pass `{avc: {format: "avc"}}`. Omitting this field keeps
   * the encoder on whichever defaults the WebCodecs implementation chooses,
   * which is appropriate for VP9, HEVC, and AV1.
   */
  extraConfigureOptions?: VideoEncoderExtraConfigureOptions
}

/**
 * Handle returned by {@link createVideoEncoderPipeline}.
 */
export type VideoEncoderPipelineHandle = {
  /** The configured `VideoEncoder`. Callers push frames via `encoder.encode`. */
  encoder: VideoEncoder
  /**
   * Resolves with the AVCDecoderConfigurationRecord bytes surfaced on the first
   * encoded chunk's `metadata.decoderConfig.description`. Rejects if the encoder
   * finishes producing chunks without ever supplying a decoder configuration.
   */
  firstDescription: Promise<ArrayBuffer | ArrayBufferView>
  /**
   * Flushes any pending output, closes the encoder, and resolves once the native
   * `close()` call has completed.
   */
  close(): Promise<void>
}

/**
 * Creates a {@link VideoEncoder} whose first emitted chunk supplies the decoder
 * configuration record via `metadata.decoderConfig.description`. The helper
 * captures the description through the returned `firstDescription` promise so
 * the scenario can construct a `VideoTrackConfig` without touching the encoder
 * output callback directly.
 *
 * Codec-specific configuration directives reach the encoder through
 * `options.extraConfigureOptions`, which spreads into the underlying
 * `VideoEncoder.configure` call. AVC callers pass `{avc: {format: "avc"}}` so
 * Chrome emits length-prefixed NAL units rather than AnnexB. VP9, HEVC, and
 * AV1 callers omit the field because those codecs do not accept an `avc`
 * options object. The helper configures the encoder synchronously before
 * returning so the caller can queue frames immediately.
 *
 * @param options - Encoder configuration plus the per-chunk output handler.
 * @returns A handle exposing the encoder, the first-description promise, and a close method.
 *
 * @see {@link https://w3c.github.io/webcodecs/#videoencoder-interface | WebCodecs VideoEncoder}
 */
export function createVideoEncoderPipeline(options: VideoEncoderPipelineOptions): VideoEncoderPipelineHandle {
  let resolveFirstDescription: ((description: ArrayBuffer | ArrayBufferView) => void) | null = null
  let rejectFirstDescription: ((reason: Error) => void) | null = null
  let descriptionResolved = false

  const firstDescription = new Promise<ArrayBuffer | ArrayBufferView>((resolve, reject) => {
    resolveFirstDescription = resolve
    rejectFirstDescription = reject
  })

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (!descriptionResolved) {
        const decoderDescription = metadata?.decoderConfig?.description
        if (decoderDescription !== undefined && resolveFirstDescription !== null) {
          descriptionResolved = true
          resolveFirstDescription(copyToArrayBufferBackedBytes(decoderDescription))
        }
      }
      options.onChunk(chunk, metadata)
    },
    error: (nativeError) => {
      const wrappedError = new Error(`VideoEncoder error: ${nativeError.message}`)
      options.onError(wrappedError)
    },
  })

  encoder.configure({
    codec: options.codec,
    width: options.width,
    height: options.height,
    framerate: options.framerate,
    bitrate: options.bitrate,
    /*
     * The mandatory fields above stay fixed. Any codec-specific hints such as
     * the AVC bitstream format selector arrive through `extraConfigureOptions`
     * and spread last so scenario-supplied keys override nothing the pipeline
     * guarantees.
     */
    ...options.extraConfigureOptions,
  })

  const close = async (): Promise<void> => {
    try {
      await encoder.flush()
    } finally {
      if (encoder.state !== 'closed') {
        encoder.close()
      }
      if (!descriptionResolved && rejectFirstDescription !== null) {
        descriptionResolved = true
        rejectFirstDescription(new Error('VideoEncoder closed before emitting a decoder configuration'))
      }
    }
  }

  return { encoder, firstDescription, close }
}

/**
 * Options accepted by {@link createAudioEncoderPipeline}.
 */
export type AudioEncoderPipelineOptions = {
  /** WebCodecs audio codec string, for example `"mp4a.40.2"` (AAC-LC). */
  codec: string
  /** Output channel count. */
  numberOfChannels: number
  /** Output sample rate in Hz. */
  sampleRate: number
  /** Target bitrate in bits per second. */
  bitrate: number
  /** Called once per encoded chunk. */
  onChunk: (chunk: EncodedAudioChunk, metadata: EncodedAudioChunkMetadata | undefined) => void
  /** Called when the encoder surfaces a fatal error. */
  onError: (reason: Error) => void
}

/**
 * Handle returned by {@link createAudioEncoderPipeline}.
 */
export type AudioEncoderPipelineHandle = {
  /** The configured `AudioEncoder`. Callers push samples via `encoder.encode`. */
  encoder: AudioEncoder
  /**
   * Resolves with the AudioSpecificConfig bytes surfaced on the first encoded
   * chunk's `metadata.decoderConfig.description`. Rejects if the encoder finishes
   * producing chunks without ever supplying a decoder configuration.
   */
  firstDescription: Promise<ArrayBuffer | ArrayBufferView>
  /**
   * Flushes any pending output, closes the encoder, and resolves once the native
   * `close()` call has completed.
   */
  close(): Promise<void>
}

/**
 * Creates an {@link AudioEncoder} whose first emitted chunk supplies the
 * AudioSpecificConfig via `metadata.decoderConfig.description`. The helper captures
 * the description through the returned `firstDescription` promise so the scenario
 * can construct an `AudioTrackConfig` without touching the encoder output callback
 * directly.
 *
 * @param options - Encoder configuration plus the per-chunk output handler.
 * @returns A handle exposing the encoder, the first-description promise, and a close method.
 *
 * @see {@link https://w3c.github.io/webcodecs/#audioencoder-interface | WebCodecs AudioEncoder}
 */
export function createAudioEncoderPipeline(options: AudioEncoderPipelineOptions): AudioEncoderPipelineHandle {
  let resolveFirstDescription: ((description: ArrayBuffer | ArrayBufferView) => void) | null = null
  let rejectFirstDescription: ((reason: Error) => void) | null = null
  let descriptionResolved = false

  const firstDescription = new Promise<ArrayBuffer | ArrayBufferView>((resolve, reject) => {
    resolveFirstDescription = resolve
    rejectFirstDescription = reject
  })

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      if (!descriptionResolved) {
        const decoderDescription = metadata?.decoderConfig?.description
        if (decoderDescription !== undefined && resolveFirstDescription !== null) {
          descriptionResolved = true
          resolveFirstDescription(copyToArrayBufferBackedBytes(decoderDescription))
        }
      }
      options.onChunk(chunk, metadata)
    },
    error: (nativeError) => {
      const wrappedError = new Error(`AudioEncoder error: ${nativeError.message}`)
      options.onError(wrappedError)
    },
  })

  encoder.configure({
    codec: options.codec,
    numberOfChannels: options.numberOfChannels,
    sampleRate: options.sampleRate,
    bitrate: options.bitrate,
  })

  const close = async (): Promise<void> => {
    try {
      await encoder.flush()
    } finally {
      if (encoder.state !== 'closed') {
        encoder.close()
      }
      if (!descriptionResolved && rejectFirstDescription !== null) {
        descriptionResolved = true
        rejectFirstDescription(new Error('AudioEncoder closed before emitting a decoder configuration'))
      }
    }
  }

  return { encoder, firstDescription, close }
}

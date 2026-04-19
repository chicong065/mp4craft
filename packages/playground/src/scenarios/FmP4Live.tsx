import { Card } from '@/components/Card'
import { DarkButton } from '@/components/DarkButton'
import { PillButton } from '@/components/PillButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { createVideoEncoderPipeline } from '@/lib/encoders'
import type { VideoEncoderPipelineHandle } from '@/lib/encoders'
import fmp4LiveStyles from '@/scenarios/FmP4Live.module.css'
import { Mp4Muxer } from 'mp4craft'
import type { Target } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phases of the fragmented live session. The UI renders a different layout
 * per phase and only the legal transitions are reachable from each.
 */
type LivePhase = 'idle' | 'preparing' | 'live' | 'stopping' | 'stopped' | 'error'

/**
 * Target capture resolution. 1280x720 at 30 fps stays within AVC Baseline 3.1
 * (`42001f`), which is the profile MSE announces acceptance for in the
 * `video/mp4; codecs="avc1.42001f"` type string below.
 */
const TARGET_VIDEO_WIDTH = 1280
const TARGET_VIDEO_HEIGHT = 720
const TARGET_VIDEO_FRAMERATE = 30
const TARGET_VIDEO_BITRATE = 4_000_000

/**
 * WebCodecs AVC codec string and the matching MIME announced to MSE. Keeping
 * the two identifiers aligned is load-bearing: if MSE does not recognise the
 * byte stream as the announced codec the SourceBuffer rejects every append.
 */
const AVC_WEBCODECS_CODEC = 'avc1.42001f'
const MEDIA_SOURCE_MIME = 'video/mp4; codecs="avc1.42001f"'

/**
 * Insert a keyframe roughly every second at 30 fps. Fragmented MP4 places a
 * fragment boundary at the next keyframe after the configured minimum
 * fragment duration, so aligning the keyframe cadence with that duration
 * keeps fragments bounded without wasteful frequency.
 */
const KEYFRAME_INTERVAL_FRAMES = 30

/** UI telemetry refresh cadence in milliseconds. */
const UI_REFRESH_INTERVAL_MS = 100

/**
 * Fallback duration in microseconds applied to any video chunk whose
 * successor is unavailable (typically the final flushed chunk). Derived from
 * the target framerate so the tail sample reads as one frame long.
 */
const DEFAULT_VIDEO_FRAME_DURATION_US = Math.round(1_000_000 / TARGET_VIDEO_FRAMERATE)

/**
 * Formats a byte count as a short human-readable string, for example
 * `1.42 MB`.
 *
 * @param byteCount - Raw byte count.
 * @returns The formatted string.
 */
function formatBytes(byteCount: number): string {
  if (byteCount < 1024) {
    return `${byteCount} B`
  }
  const kilobytes = byteCount / 1024
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`
  }
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) {
    return `${megabytes.toFixed(2)} MB`
  }
  const gigabytes = megabytes / 1024
  return `${gigabytes.toFixed(2)} GB`
}

/**
 * Formats an elapsed millisecond count as `m:ss`. Minutes grow without bound
 * so long sessions still render cleanly.
 *
 * @param elapsedMilliseconds - Elapsed time in milliseconds.
 * @returns The formatted string.
 */
function formatElapsed(elapsedMilliseconds: number): string {
  const totalSeconds = Math.floor(elapsedMilliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Encoded video chunk plus the metadata that arrived with it. Held in the
 * pending slot until the next chunk arrives so the sample duration can be
 * derived from the delta between the two timestamps.
 */
type VideoChunkEntry = {
  chunk: EncodedVideoChunk
  metadata: EncodedVideoChunkMetadata | undefined
}

/**
 * Emits a video chunk into the muxer with an explicit duration computed from
 * the supplied next-chunk timestamp. When no successor timestamp is
 * available (the trailing flushed chunk), the framerate-derived default
 * applies so the sample table still reports a non-zero length.
 *
 * @param muxer - The live muxer receiving the sample.
 * @param entry - The buffered chunk and its metadata.
 * @param nextTimestampMicroseconds - Timestamp of the chunk that follows the
 *   supplied entry, or `null` when `entry` is the final flushed chunk.
 */
function emitVideoChunkToMuxer(
  muxer: Mp4Muxer<MediaSourceTarget>,
  entry: VideoChunkEntry,
  nextTimestampMicroseconds: number | null
): void {
  const computedDuration =
    nextTimestampMicroseconds !== null
      ? Math.max(1, nextTimestampMicroseconds - entry.chunk.timestamp)
      : DEFAULT_VIDEO_FRAME_DURATION_US
  const sampleBytes = new Uint8Array(entry.chunk.byteLength)
  entry.chunk.copyTo(sampleBytes)
  muxer.addVideoSample({
    data: sampleBytes,
    timestamp: entry.chunk.timestamp,
    duration: computedDuration,
    isKeyFrame: entry.chunk.type === 'key',
  })
}

/**
 * Custom {@link Target} that forwards every muxer write to a Media Source
 * Extensions {@link SourceBuffer} via `appendBuffer`. `Target.seek` is
 * optional per the interface; {@link Mp4Muxer} only invokes it when
 * `fastStart: false` patches the `mdat` header during finalize. Fragmented
 * mode is append-only and never seeks, so the method is implemented as a
 * documented no-op purely so that a future caller swapping this target into
 * a progressive pipeline for experimentation still receives a conforming
 * object.
 *
 * `appendBuffer` is asynchronous: the SourceBuffer emits `updateend` when
 * each append finishes, and it cannot accept another append in the meantime.
 * The target therefore serializes incoming writes through an internal queue
 * and awaits the matching `updateend` before processing the next entry.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link https://w3c.github.io/media-source/ | Media Source Extensions}
 */
type MediaSourceTarget = Target

/**
 * Internal state held by the {@link createMediaSourceTarget} closure. The
 * queue drives a single-consumer, single-producer pipeline: every `write`
 * appends to the queue, and `pumpQueue` drains one entry at a time as the
 * SourceBuffer finishes each append.
 */
type MediaSourceTargetQueueEntry = {
  bytes: Uint8Array<ArrayBuffer>
  resolve: () => void
  reject: (reason: Error) => void
}

/**
 * Builds a {@link MediaSourceTarget} wrapping the supplied MediaSource and
 * its active SourceBuffer. Every byte the muxer emits is forwarded to
 * `sourceBuffer.appendBuffer`, serialized so concurrent writes do not
 * overlap. `finish` resolves once the MediaSource has been signalled that no
 * more segments are coming, which flips the `<video>` element into the
 * "ended" ready state and lets the browser render the final frame.
 *
 * @param mediaSource - MediaSource instance backing the `<video>` element.
 * @param sourceBuffer - SourceBuffer created from `mediaSource.addSourceBuffer`
 *   for the fragmented MP4 MIME string.
 * @param onError - Invoked with a wrapped error whenever the SourceBuffer
 *   emits an error event or an append rejects. The scenario routes this to
 *   the `error` phase.
 * @returns A muxer-compatible target that appends every byte to the supplied
 *   SourceBuffer.
 */
function createMediaSourceTarget(
  mediaSource: MediaSource,
  sourceBuffer: SourceBuffer,
  onError: (reason: Error) => void
): MediaSourceTarget {
  const appendQueue: MediaSourceTargetQueueEntry[] = []
  let isPumping = false
  let hasFailed = false

  /**
   * Rejects every entry still waiting in {@link appendQueue} with the supplied
   * failure reason. Called from every code path that transitions the target
   * into the failed state so that stored `resolve` / `reject` callbacks are
   * never orphaned. Without this drain, a later `muxer.finalize()` would hang
   * forever awaiting a Promise whose settlement handlers were abandoned.
   *
   * @param failureReason - Error surfaced to each queued entry's `reject` callback.
   */
  const drainAppendQueueWithFailure = (failureReason: Error): void => {
    while (true) {
      const queuedEntry = appendQueue.shift()
      if (queuedEntry === undefined) {
        return
      }
      queuedEntry.reject(failureReason)
    }
  }

  const pumpQueue = (): void => {
    if (isPumping || hasFailed) {
      return
    }
    const nextEntry = appendQueue.shift()
    if (nextEntry === undefined) {
      return
    }
    isPumping = true
    const handleUpdateEnd = (): void => {
      sourceBuffer.removeEventListener('updateend', handleUpdateEnd)
      sourceBuffer.removeEventListener('error', handleError)
      isPumping = false
      nextEntry.resolve()
      pumpQueue()
    }
    const handleError = (): void => {
      sourceBuffer.removeEventListener('updateend', handleUpdateEnd)
      sourceBuffer.removeEventListener('error', handleError)
      isPumping = false
      hasFailed = true
      const appendError = new Error(
        'SourceBuffer rejected a fragmented MP4 append. The MSE decoder considered the segment unsupported.'
      )
      nextEntry.reject(appendError)
      drainAppendQueueWithFailure(appendError)
      onError(appendError)
    }
    sourceBuffer.addEventListener('updateend', handleUpdateEnd)
    sourceBuffer.addEventListener('error', handleError)
    try {
      sourceBuffer.appendBuffer(nextEntry.bytes)
    } catch (appendReason) {
      sourceBuffer.removeEventListener('updateend', handleUpdateEnd)
      sourceBuffer.removeEventListener('error', handleError)
      isPumping = false
      hasFailed = true
      const appendError = appendReason instanceof Error ? appendReason : new Error(String(appendReason))
      nextEntry.reject(appendError)
      drainAppendQueueWithFailure(appendError)
      onError(appendError)
    }
  }

  return {
    async write(_byteOffset: number, data: Uint8Array): Promise<void> {
      /*
       * Reject incoming writes up front once the target has failed. The
       * write never reaches the queue in that case, so the caller's Promise
       * rejects with a fresh error that describes the permanent-failure
       * contract rather than piggybacking on whichever append tripped the
       * failure first. Any entries already sitting in the queue when the
       * failure occurred are rejected by `drainAppendQueueWithFailure`,
       * which keeps finalize from hanging on orphaned promises.
       */
      if (hasFailed) {
        throw new Error('MediaSource target is no longer accepting writes because a previous append failed.')
      }
      /*
       * Copy the muxer-owned bytes into a freshly allocated buffer that the
       * target owns. `appendBuffer` retains a reference to the buffer until
       * `updateend` fires, while the muxer reuses its internal staging
       * buffer immediately after `write` returns. The copy detaches the two
       * lifetimes. Typing the `Uint8Array` over a concrete `ArrayBuffer`
       * rather than the broader `ArrayBufferLike` satisfies the
       * `BufferSource` parameter of `SourceBuffer.appendBuffer`.
       */
      const ownedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(data.byteLength))
      ownedBytes.set(data)
      await new Promise<void>((resolve, reject) => {
        appendQueue.push({ bytes: ownedBytes, resolve, reject })
        pumpQueue()
      })
    },
    seek(_byteOffset: number): void {
      /*
       * `Target.seek` is optional per the interface. Mp4Muxer only calls it
       * when `fastStart: false` patches the `mdat` header during finalize,
       * and fragmented mode is append-only, so this scenario never triggers
       * that call path. The no-op remains so that if a future caller swaps
       * this target into a progressive pipeline for experimentation the
       * object still conforms ergonomically.
       */
    },
    async finish(): Promise<void> {
      /*
       * Wait for any in-flight append to drain so the MediaSource does not
       * see an `endOfStream` call before the final segment commits. A
       * spin-lock on `isPumping` and `appendQueue.length` handles the case
       * where `finalize` is called before the last `updateend` fires.
       */
      while (!hasFailed && (isPumping || appendQueue.length > 0)) {
        await new Promise<void>((resolveTick) => setTimeout(resolveTick, 10))
      }
      if (mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream()
        } catch {
          /*
           * `endOfStream` throws if the MediaSource was already closed by
           * the browser, for example because the `<video>` element was
           * torn down. Ignoring keeps finalize idempotent.
           */
        }
      }
    },
  }
}

/**
 * Mutable state that survives React renders without triggering them. Held
 * inside a single ref so teardown iterates one object instead of chasing
 * several independent fields.
 */
type LiveSessionState = {
  muxer: Mp4Muxer<MediaSourceTarget> | null
  target: MediaSourceTarget | null
  videoPipeline: VideoEncoderPipelineHandle | null
  mediaStream: MediaStream | null
  videoReader: ReadableStreamDefaultReader<VideoFrame> | null
  mediaSource: MediaSource | null
  sourceBuffer: SourceBuffer | null
  mediaSourceObjectUrl: string | null
  /**
   * Video chunks that arrived before the muxer was constructed. Drained
   * once the muxer exists, with per-sample durations derived from adjacent
   * timestamps.
   */
  earlyVideoChunks: VideoChunkEntry[]
  /**
   * The most recently observed video chunk, held until the next chunk
   * arrives so the sample duration can be computed from the delta between
   * timestamps. Flushed during stop with the framerate-derived fallback.
   */
  pendingVideoChunk: VideoChunkEntry | null
  frameCounter: number
  videoSampleCount: number
  bytesStreamed: number
  startTimestampMs: number
}

/**
 * Readable telemetry snapshot rendered by the `Stats` component during the
 * `live` phase.
 */
type LiveTelemetry = {
  elapsedMs: number
  videoSampleCount: number
  bytesStreamed: number
}

const INITIAL_TELEMETRY: LiveTelemetry = {
  elapsedMs: 0,
  videoSampleCount: 0,
  bytesStreamed: 0,
}

/**
 * Fragmented live scenario. Captures a user-granted `MediaStream` via
 * `getUserMedia`, encodes the frames with WebCodecs AVC (`avc1.42001f`),
 * muxes them into a fragmented MP4 via {@link Mp4Muxer} with
 * `fastStart: "fragmented"`, and streams the resulting bytes directly into
 * a Media Source Extensions {@link SourceBuffer}. The `<video>` element
 * starts playing as soon as the initialization segment (`ftyp` + `moov`) and
 * the first `moof` + `mdat` pair land in the source buffer.
 *
 * The scenario is video-only to keep the MediaSource wiring straightforward;
 * MSE accepts a video-only MP4 byte stream under the standard
 * `video/mp4; codecs="avc1.42001f"` MIME. Adding audio would require both
 * tracks inside a single fragment and a combined MIME string, which is out
 * of scope for this scenario's marquee purpose of showing the fragmented
 * path end-to-end.
 *
 * Stop semantics: the user clicks "Stop Live" to end the session. The
 * scenario flushes the encoder, finalizes the muxer, and the custom target's
 * `finish` method signals `endOfStream` on the MediaSource so the `<video>`
 * element knows the buffer is complete.
 *
 * Compatibility: the scenario requires `MediaSource`,
 * `MediaStreamTrackProcessor`, `getUserMedia`, and `VideoEncoder`. When any
 * of those is missing the scenario surfaces an error state up front so the
 * user can switch to a supported browser without starting capture.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 * @see {@link https://w3c.github.io/mediacapture-transform/ | MediaStreamTrack Insertable Streams}
 * @see {@link https://w3c.github.io/media-source/ | Media Source Extensions}
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function FmP4Live() {
  const [phase, setPhase] = useState<LivePhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [telemetry, setTelemetry] = useState<LiveTelemetry>(INITIAL_TELEMETRY)
  const [liveMediaSourceObjectUrl, setLiveMediaSourceObjectUrl] = useState<string | null>(null)

  const liveVideoElementRef = useRef<HTMLVideoElement | null>(null)
  const sessionRef = useRef<LiveSessionState | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const animationFrameRef = useRef<number | null>(null)
  const lastTelemetryFlushRef = useRef<number>(0)

  /*
   * Schedules a throttled UI refresh pulling the latest counters from the
   * mutable session state. Keeps React from re-rendering on every chunk.
   */
  const scheduleTelemetryRefresh = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }
    animationFrameRef.current = requestAnimationFrame((nowMs) => {
      animationFrameRef.current = null
      const session = sessionRef.current
      if (session === null) {
        return
      }
      if (nowMs - lastTelemetryFlushRef.current < UI_REFRESH_INTERVAL_MS) {
        scheduleTelemetryRefresh()
        return
      }
      lastTelemetryFlushRef.current = nowMs
      if (!isMountedRef.current) {
        return
      }
      setTelemetry({
        elapsedMs: performance.now() - session.startTimestampMs,
        videoSampleCount: session.videoSampleCount,
        bytesStreamed: session.bytesStreamed,
      })
      scheduleTelemetryRefresh()
    })
  }, [])

  /*
   * Teardown every resource held by the session. Safe to call in any phase.
   */
  const releaseSessionResources = useCallback(async (): Promise<void> => {
    const session = sessionRef.current
    if (session === null) {
      return
    }
    sessionRef.current = null
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (session.videoReader !== null) {
      try {
        await session.videoReader.cancel()
      } catch {
        /* Reader cancellation errors do not affect teardown correctness. */
      }
    }
    if (session.videoPipeline !== null) {
      try {
        await session.videoPipeline.close()
      } catch {
        /* The encoder may already be closed if finalize ran first. */
      }
    }
    if (session.mediaStream !== null) {
      for (const mediaTrack of session.mediaStream.getTracks()) {
        mediaTrack.stop()
      }
    }
    if (session.mediaSource !== null && session.mediaSource.readyState === 'open') {
      try {
        session.mediaSource.endOfStream()
      } catch {
        /* `endOfStream` throws if the MediaSource has already closed. */
      }
    }
    if (session.mediaSourceObjectUrl !== null) {
      URL.revokeObjectURL(session.mediaSourceObjectUrl)
    }
  }, [])

  /*
   * Drives the `getUserMedia` handshake, the MediaSource/SourceBuffer
   * construction, the encoder and muxer wiring, and the frame-loop launch.
   * Any thrown error routes into the `error` phase.
   */
  const beginLiveSession = useCallback(async (): Promise<void> => {
    setPhase('preparing')
    setErrorMessage('')
    setTelemetry(INITIAL_TELEMETRY)

    /*
     * Each capability is checked with a direct `typeof` guard rather than
     * through an accumulator so the TypeScript compiler can narrow the
     * remaining references to their non-`undefined` forms after the guards
     * return early. All four APIs are required for the fragmented live
     * pipeline to run, so a single missing capability routes the scenario
     * straight into the `error` phase with a specific message.
     */
    if (typeof MediaSource === 'undefined') {
      setErrorMessage(
        'This browser is missing MediaSource Extensions. Use Chrome 94 or newer to run the Fragmented Live scenario.'
      )
      setPhase('error')
      return
    }
    if (typeof MediaStreamTrackProcessor === 'undefined') {
      setErrorMessage(
        'This browser is missing MediaStreamTrackProcessor. Use Chrome 94 or newer to run the Fragmented Live scenario.'
      )
      setPhase('error')
      return
    }
    if (typeof VideoEncoder === 'undefined') {
      setErrorMessage(
        'This browser is missing WebCodecs VideoEncoder. Use Chrome 94 or newer to run the Fragmented Live scenario.'
      )
      setPhase('error')
      return
    }
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.mediaDevices === 'undefined' ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setErrorMessage(
        'This browser is missing getUserMedia. Use Chrome 94 or newer to run the Fragmented Live scenario.'
      )
      setPhase('error')
      return
    }
    if (!MediaSource.isTypeSupported(MEDIA_SOURCE_MIME)) {
      setErrorMessage(
        `This browser reports no MSE support for ${MEDIA_SOURCE_MIME}. Use Chrome or a Chromium-based browser.`
      )
      setPhase('error')
      return
    }

    const session: LiveSessionState = {
      muxer: null,
      target: null,
      videoPipeline: null,
      mediaStream: null,
      videoReader: null,
      mediaSource: null,
      sourceBuffer: null,
      mediaSourceObjectUrl: null,
      earlyVideoChunks: [],
      pendingVideoChunk: null,
      frameCounter: 0,
      videoSampleCount: 0,
      bytesStreamed: 0,
      startTimestampMs: 0,
    }
    sessionRef.current = session

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: TARGET_VIDEO_WIDTH },
          height: { ideal: TARGET_VIDEO_HEIGHT },
          frameRate: { ideal: TARGET_VIDEO_FRAMERATE },
        },
        audio: false,
      })
      session.mediaStream = mediaStream

      const videoTrack = mediaStream.getVideoTracks()[0]
      if (videoTrack === undefined) {
        throw new Error('The granted media stream is missing a video track.')
      }

      const videoSettings = videoTrack.getSettings()
      const capturedWidth = videoSettings.width ?? TARGET_VIDEO_WIDTH
      const capturedHeight = videoSettings.height ?? TARGET_VIDEO_HEIGHT
      const capturedFramerate = videoSettings.frameRate ?? TARGET_VIDEO_FRAMERATE

      /*
       * Build the MediaSource before the encoder so its object URL can be
       * bound to the live `<video>` element as soon as the phase flips to
       * `live`. The SourceBuffer cannot be created until the
       * `sourceopen` event has fired, which the promise below awaits.
       */
      const mediaSource = new MediaSource()
      session.mediaSource = mediaSource
      const mediaSourceObjectUrl = URL.createObjectURL(mediaSource)
      session.mediaSourceObjectUrl = mediaSourceObjectUrl
      const sourceOpenPromise = new Promise<void>((resolveSourceOpen) => {
        mediaSource.addEventListener(
          'sourceopen',
          () => {
            resolveSourceOpen()
          },
          { once: true }
        )
      })
      /*
       * Publish the object URL so the `<video>` element in the `live` phase
       * can mount with `src` already pointing at the MediaSource. Attaching
       * the URL is what eventually drives `sourceopen`.
       */
      setLiveMediaSourceObjectUrl(mediaSourceObjectUrl)
      setPhase('live')
      await sourceOpenPromise

      const sourceBuffer = mediaSource.addSourceBuffer(MEDIA_SOURCE_MIME)
      /*
       * `sequence` mode ignores the `tfdt` decode timestamp inside each
       * fragment and plays fragments back-to-back in the order they arrive.
       * This matches live capture where the first sample's timestamp is
       * near zero but downstream fragments should not reset the timeline.
       */
      sourceBuffer.mode = 'sequence'
      session.sourceBuffer = sourceBuffer

      const target = createMediaSourceTarget(mediaSource, sourceBuffer, (targetError) => {
        if (!isMountedRef.current) {
          return
        }
        setErrorMessage(targetError.message)
        setPhase('error')
        void releaseSessionResources()
      })
      session.target = target

      const videoPipeline = createVideoEncoderPipeline({
        codec: AVC_WEBCODECS_CODEC,
        width: capturedWidth,
        height: capturedHeight,
        framerate: capturedFramerate,
        bitrate: TARGET_VIDEO_BITRATE,
        /*
         * Chrome defaults AVC output to AnnexB. mp4craft expects
         * length-prefixed NAL units so the bytes can flow into sample
         * storage without a size-prefix rewrite. See CameraRecorder for
         * the full justification.
         */
        extraConfigureOptions: { avc: { format: 'avc' } },
        onChunk: (chunk, metadata) => {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          activeSession.videoSampleCount += 1
          activeSession.bytesStreamed += chunk.byteLength
          const incomingEntry: VideoChunkEntry = { chunk, metadata }
          if (activeSession.muxer === null) {
            activeSession.earlyVideoChunks.push(incomingEntry)
            return
          }
          if (activeSession.pendingVideoChunk !== null) {
            emitVideoChunkToMuxer(activeSession.muxer, activeSession.pendingVideoChunk, chunk.timestamp)
          }
          activeSession.pendingVideoChunk = incomingEntry
        },
        onError: (encoderError) => {
          if (!isMountedRef.current) {
            return
          }
          setErrorMessage(encoderError.message)
          setPhase('error')
          void releaseSessionResources()
        },
      })
      session.videoPipeline = videoPipeline

      const videoProcessor = new MediaStreamTrackProcessor<VideoFrame>({
        track: videoTrack,
      })
      const videoReader = videoProcessor.readable.getReader()
      session.videoReader = videoReader

      /*
       * Video frame loop. Matches the cadence of the source track and
       * inserts a keyframe every KEYFRAME_INTERVAL_FRAMES frames so the
       * fragmented muxer can emit a fragment boundary at each keyframe.
       */
      const videoLoop = async (): Promise<void> => {
        let isFirstFrame = true
        while (true) {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          const nextFrameResult = await videoReader.read()
          if (nextFrameResult.done || nextFrameResult.value === undefined) {
            return
          }
          activeSession.frameCounter += 1
          /*
           * Force the very first encoded frame to be a keyframe so the
           * decoder configuration arrives immediately and the first
           * fragment can begin at sample index zero.
           */
          const shouldInsertKeyframe = isFirstFrame || activeSession.frameCounter % KEYFRAME_INTERVAL_FRAMES === 0
          videoPipeline.encoder.encode(nextFrameResult.value, {
            keyFrame: shouldInsertKeyframe,
          })
          nextFrameResult.value.close()
          isFirstFrame = false
        }
      }
      void videoLoop()

      /*
       * Guard against the encoder never emitting a decoder configuration.
       */
      const DESCRIPTION_TIMEOUT_MS = 8000
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for the AVC decoder configuration after ${DESCRIPTION_TIMEOUT_MS}ms. Check the browser DevTools console for encoder errors.`
            )
          )
        }, DESCRIPTION_TIMEOUT_MS)
      })
      const videoDescription = await Promise.race([videoPipeline.firstDescription, timeoutPromise])

      const muxer = new Mp4Muxer<MediaSourceTarget>({
        target,
        fastStart: 'fragmented',
        video: {
          codec: 'avc',
          width: capturedWidth,
          height: capturedHeight,
          description: videoDescription,
        },
      })
      session.muxer = muxer

      /*
       * Drain the chunks that arrived before the muxer existed. Each
       * drained entry borrows its duration from the timestamp of the chunk
       * that follows it, and the trailing drained chunk is promoted to
       * `pendingVideoChunk` so the next live arrival computes its duration
       * as usual.
       */
      const bufferedReplayEntries = session.earlyVideoChunks
      session.earlyVideoChunks = []
      for (let replayIndex = 0; replayIndex < bufferedReplayEntries.length; replayIndex += 1) {
        const replayEntry = bufferedReplayEntries[replayIndex]
        if (replayEntry === undefined) {
          continue
        }
        const successorEntry = bufferedReplayEntries[replayIndex + 1]
        if (successorEntry !== undefined) {
          emitVideoChunkToMuxer(muxer, replayEntry, successorEntry.chunk.timestamp)
        } else {
          session.pendingVideoChunk = replayEntry
        }
      }

      session.startTimestampMs = performance.now()
      scheduleTelemetryRefresh()
    } catch (unknownReason) {
      const reasonMessage = unknownReason instanceof Error ? unknownReason.message : String(unknownReason)
      if (isMountedRef.current) {
        setErrorMessage(reasonMessage)
        setPhase('error')
      }
      await releaseSessionResources()
    }
  }, [releaseSessionResources, scheduleTelemetryRefresh])

  /*
   * Drains the encoder, flushes the final pending chunk, and finalizes the
   * muxer. The custom target's `finish` method signals `endOfStream` on the
   * MediaSource so the `<video>` element knows the last segment has
   * arrived.
   */
  const stopLiveSession = useCallback(async (): Promise<void> => {
    const session = sessionRef.current
    if (session === null) {
      return
    }
    setPhase('stopping')

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (session.videoReader !== null) {
      try {
        await session.videoReader.cancel()
      } catch {
        /* Ignored: a cancel on an already-closed reader is not an error. */
      }
    }

    try {
      if (session.videoPipeline !== null) {
        await session.videoPipeline.close()
      }
      if (session.muxer === null) {
        throw new Error('Muxer was not constructed before stop was requested.')
      }
      if (session.pendingVideoChunk !== null) {
        emitVideoChunkToMuxer(session.muxer, session.pendingVideoChunk, null)
        session.pendingVideoChunk = null
      }
      await session.muxer.finalize()

      if (session.mediaStream !== null) {
        for (const mediaTrack of session.mediaStream.getTracks()) {
          mediaTrack.stop()
        }
        session.mediaStream = null
      }

      const finalTelemetry: LiveTelemetry = {
        elapsedMs: performance.now() - session.startTimestampMs,
        videoSampleCount: session.videoSampleCount,
        bytesStreamed: session.bytesStreamed,
      }

      if (!isMountedRef.current) {
        sessionRef.current = null
        return
      }

      setTelemetry(finalTelemetry)
      setPhase('stopped')
      sessionRef.current = null
    } catch (unknownReason) {
      const reasonMessage = unknownReason instanceof Error ? unknownReason.message : String(unknownReason)
      if (isMountedRef.current) {
        setErrorMessage(reasonMessage)
        setPhase('error')
      }
      await releaseSessionResources()
    }
  }, [releaseSessionResources])

  /*
   * Return the scenario to the `idle` phase, releasing the previous
   * session's MediaSource object URL so a second session starts from a
   * clean slate.
   */
  const resetSession = useCallback((): void => {
    if (liveMediaSourceObjectUrl !== null) {
      URL.revokeObjectURL(liveMediaSourceObjectUrl)
    }
    setLiveMediaSourceObjectUrl(null)
    setTelemetry(INITIAL_TELEMETRY)
    setErrorMessage('')
    setPhase('idle')
  }, [liveMediaSourceObjectUrl])

  /*
   * Revoke the MediaSource object URL when the component unmounts or when a
   * new session replaces the old one. Revocation inside `resetSession`
   * handles the in-flow path; this effect handles the navigate-away path.
   */
  useEffect(() => {
    return () => {
      if (liveMediaSourceObjectUrl !== null) {
        URL.revokeObjectURL(liveMediaSourceObjectUrl)
      }
    }
  }, [liveMediaSourceObjectUrl])

  /*
   * Teardown on unmount so a user navigating away mid-session does not leak
   * the camera light or the MediaSource.
   */
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      void releaseSessionResources()
    }
  }, [releaseSessionResources])

  return (
    <ScenarioFrame
      title="Fragmented Live"
      description="Fragmented MP4 bytes streamed into a MediaSource for live in-browser playback."
    >
      <div className={fmp4LiveStyles.layout}>
        {renderPhaseContent({
          phase,
          errorMessage,
          telemetry,
          liveVideoElementRef,
          liveMediaSourceObjectUrl,
          onStart: () => void beginLiveSession(),
          onStop: () => void stopLiveSession(),
          onReset: resetSession,
          onRetry: resetSession,
        })}
      </div>
    </ScenarioFrame>
  )
}

/**
 * Arguments accepted by {@link renderPhaseContent}.
 */
type PhaseRenderInputs = {
  phase: LivePhase
  errorMessage: string
  telemetry: LiveTelemetry
  liveVideoElementRef: React.RefObject<HTMLVideoElement>
  liveMediaSourceObjectUrl: string | null
  onStart: () => void
  onStop: () => void
  onReset: () => void
  onRetry: () => void
}

/**
 * Renders the correct card layout for the current live phase.
 *
 * @param inputs - Current phase plus the telemetry and callbacks required to
 *   render and drive it.
 * @returns The JSX for the active phase.
 */
function renderPhaseContent(inputs: PhaseRenderInputs) {
  const statsEntries: readonly StatsEntry[] = [
    { label: 'Elapsed', value: formatElapsed(inputs.telemetry.elapsedMs) },
    {
      label: 'Video samples',
      value: inputs.telemetry.videoSampleCount.toString(),
    },
    {
      label: 'Bytes streamed',
      value: formatBytes(inputs.telemetry.bytesStreamed),
    },
  ]

  const phaseRenderers: Record<LivePhase, () => React.ReactElement> = {
    idle: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fmp4LiveStyles.statusCard}>
          <h2 className={fmp4LiveStyles.statusHeading}>Go live</h2>
          <p className={fmp4LiveStyles.statusMessage}>
            Captures the camera, encodes it as AVC Baseline 3.1, runs every byte through mp4craft's fragmented layout,
            and appends each moof + mdat pair to a MediaSource SourceBuffer. The preview that appears after you click Go
            Live is the muxed output being demuxed and decoded again by the browser, not the raw camera stream.
          </p>
          <p className={fmp4LiveStyles.statusMessage}>
            This is what distinguishes the scenario from Camera Recorder: there, the preview is the untouched
            MediaStream and the MP4 is only materialized when you click Stop. Here, you are watching the full
            encode-then-mux-then-MSE-demux-then-decode round trip happen live, so the preview shows a few hundred
            milliseconds of pipeline latency. Wave your hand in front of the camera and compare the lag: that lag is the
            scenario.
          </p>
          <p className={fmp4LiveStyles.compatibilityNote}>
            Requires Chromium: MediaSource, MediaStreamTrackProcessor, WebCodecs VideoEncoder, and getUserMedia. Safari
            ships MSE but not the WebCodecs pipeline this scenario drives.
          </p>
          <div className={fmp4LiveStyles.actionRow}>
            <DarkButton onClick={inputs.onStart}>Go Live</DarkButton>
          </div>
        </div>
      </Card>
    ),
    preparing: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fmp4LiveStyles.statusCard}>
          <h2 className={fmp4LiveStyles.statusHeading}>Waiting on browser prompts</h2>
          <p className={fmp4LiveStyles.statusMessage}>
            Requesting camera access and opening the MediaSource. Streaming starts the instant the encoder emits its
            first keyframe.
          </p>
        </div>
      </Card>
    ),
    live: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={fmp4LiveStyles.previewCard}>
            <h2 className={fmp4LiveStyles.previewHeading}>Muxed playback (live)</h2>
            {inputs.liveMediaSourceObjectUrl !== null ? (
              <video
                key={inputs.liveMediaSourceObjectUrl}
                ref={inputs.liveVideoElementRef}
                className={fmp4LiveStyles.previewVideo}
                src={inputs.liveMediaSourceObjectUrl}
                autoPlay
                muted
                playsInline
                controls
              />
            ) : null}
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={fmp4LiveStyles.statusCard}>
            <h2 className={fmp4LiveStyles.statusHeading}>Telemetry</h2>
            <Stats entries={statsEntries} />
            <div className={fmp4LiveStyles.actionRow}>
              <PillButton variant="nav-active" onClick={inputs.onStop}>
                Stop Live
              </PillButton>
            </div>
            <p className={fmp4LiveStyles.helperText}>
              The video above is the muxed MP4 being decoded back by the browser, not the raw camera feed. Inspect the
              element in DevTools: its <code>src</code> is a<code> blob:</code> URL pointing at a MediaSource, and
              <code> srcObject</code> is null. Compare against Camera Recorder, whose live preview uses{' '}
              <code>srcObject</code> = MediaStream for a zero-latency view. The visible lag between your motion and what
              you see here is the encode + mux + demux + decode round trip.
            </p>
          </div>
        </Card>
      </>
    ),
    stopping: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fmp4LiveStyles.statusCard}>
          <h2 className={fmp4LiveStyles.statusHeading}>Finalizing fragments</h2>
          <p className={fmp4LiveStyles.statusMessage}>
            Flushing the encoder, writing the final moof and mdat pair, and signalling endOfStream on the MediaSource so
            the live element knows the buffer is complete.
          </p>
        </div>
      </Card>
    ),
    stopped: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fmp4LiveStyles.statusCard}>
          <h2 className={fmp4LiveStyles.statusHeading}>Live session complete</h2>
          <p className={fmp4LiveStyles.statusMessage}>
            The MediaSource has been closed and the SourceBuffer no longer accepts appends. There is no post-stop
            playback file to save: the scenario's output was the live stream you just watched, produced byte-by-byte as
            fragments. Use Camera Recorder when you want a persistable .mp4.
          </p>
          <Stats entries={statsEntries} />
          <div className={fmp4LiveStyles.actionRow}>
            <PillButton variant="nav-active" onClick={inputs.onReset}>
              Go Live Again
            </PillButton>
          </div>
        </div>
      </Card>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fmp4LiveStyles.statusCard}>
          <h2 className={fmp4LiveStyles.statusHeading}>Live session failed</h2>
          <p className={fmp4LiveStyles.errorMessage}>
            {inputs.errorMessage !== ''
              ? inputs.errorMessage
              : 'An unknown error occurred while setting up the live session.'}
          </p>
          <div className={fmp4LiveStyles.actionRow}>
            <PillButton variant="nav-active" onClick={inputs.onRetry}>
              Retry
            </PillButton>
          </div>
        </div>
      </Card>
    ),
  }

  return phaseRenderers[inputs.phase]()
}

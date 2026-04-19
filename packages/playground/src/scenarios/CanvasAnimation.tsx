import { Card } from '@/components/Card'
import { DarkButton } from '@/components/DarkButton'
import { PillButton } from '@/components/PillButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { saveBytesToDisk } from '@/lib/download'
import { createVideoEncoderPipeline } from '@/lib/encoders'
import type { VideoEncoderPipelineHandle } from '@/lib/encoders'
import canvasAnimationStyles from '@/scenarios/CanvasAnimation.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phases of the canvas animation recording session. The UI renders a different
 * layout per phase and only the legal transitions are reachable from each.
 */
type RecordingPhase = 'idle' | 'preparing' | 'recording' | 'stopping' | 'stopped' | 'error'

/** Canvas source dimensions. Sized well within VP9 level 3.0 (up to 720p30) budgets. */
const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 360

/** Target encoding bitrate. */
const TARGET_BITRATE = 3_000_000

/**
 * WebCodecs VP9 codec string used by the encoder. Profile 0 (4:2:0 8-bit),
 * level 3.0 (max 720p30, 20 Mbps), bit depth 8. Level 3.0 comfortably covers
 * the 640x360p30 source; lower levels such as 1.0 cap out at roughly 144p and
 * surface as silent encoder errors on Chrome.
 */
const VIDEO_CODEC_STRING = 'vp09.00.30.08'

/**
 * Nominal framerate hint supplied to the `VideoEncoder`. The actual capture
 * rate tracks `requestAnimationFrame`, which on modern displays runs at 60
 * to 120 Hz; 60 is a reasonable midpoint for the encoder's rate-control.
 */
const NOMINAL_FRAMERATE_HINT = 60

/**
 * Wall-clock interval between forced keyframes, expressed in microseconds.
 * Keeping keyframes roughly one second apart keeps seeking cheap without
 * inflating the bitrate on long recordings.
 */
const KEYFRAME_INTERVAL_MICROSECONDS = 1_000_000

/**
 * Length of the hue rotation used by the animation renderer, expressed as a
 * frame count. Controls visual pacing of the idle preview and the recorded
 * output; it no longer bounds the recording because the user drives stop.
 */
const ANIMATION_CYCLE_FRAMES = 150

/**
 * Fallback duration stamped on the trailing video chunk when no successor is
 * available. Sized to one frame at 60 Hz so the final sample reads as a real
 * frame-length entry in the stts table.
 */
const TRAILING_CHUNK_DURATION_MICROSECONDS = Math.round(1_000_000 / NOMINAL_FRAMERATE_HINT)

/** UI telemetry refresh cadence in milliseconds. */
const UI_REFRESH_INTERVAL_MS = 100

/**
 * Formats a byte count as a short human-readable string, for example `1.42 MB`.
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
 * Formats an elapsed millisecond count as `m:ss`.
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
 * Draws one animated gradient frame onto the supplied 2D context. Hue rotates
 * smoothly across the full recording duration, and a diagonal linear sweep
 * crosses the frame so encoded keyframes differ meaningfully from predicted
 * frames, which exercises the VP9 encoder rather than letting it collapse to
 * near-zero byte chunks.
 *
 * @param drawingContext - Target 2D rendering context for the canvas.
 * @param frameIndex - Zero-based frame index inside the recording.
 */
function drawAnimationFrame(drawingContext: CanvasRenderingContext2D, frameIndex: number): void {
  const normalizedProgress = (frameIndex % ANIMATION_CYCLE_FRAMES) / ANIMATION_CYCLE_FRAMES
  const hueDegrees = (normalizedProgress * 360) % 360
  const complementaryHue = (hueDegrees + 120) % 360
  const gradient = drawingContext.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  gradient.addColorStop(0, `hsl(${hueDegrees.toFixed(1)}, 82%, 55%)`)
  gradient.addColorStop(1, `hsl(${complementaryHue.toFixed(1)}, 78%, 42%)`)
  drawingContext.fillStyle = gradient
  drawingContext.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  /*
   * A slowly rotating ring of high-contrast dots adds motion the encoder has
   * to predict between frames. Without this the encoded output is trivially
   * small and the telemetry panel is boring to watch.
   */
  const centerX = CANVAS_WIDTH / 2
  const centerY = CANVAS_HEIGHT / 2
  const orbitRadius = 120
  const dotCount = 6
  const baseAngle = normalizedProgress * Math.PI * 2
  drawingContext.fillStyle = 'rgba(255, 255, 255, 0.85)'
  for (let dotIndex = 0; dotIndex < dotCount; dotIndex += 1) {
    const dotAngle = baseAngle + (dotIndex / dotCount) * Math.PI * 2
    const dotX = centerX + Math.cos(dotAngle) * orbitRadius
    const dotY = centerY + Math.sin(dotAngle) * orbitRadius
    drawingContext.beginPath()
    drawingContext.arc(dotX, dotY, 18, 0, Math.PI * 2)
    drawingContext.fill()
  }
}

/**
 * Builds the 8-byte vpcC FullBox body from a WebCodecs VP9 codec string. The
 * payload matches the VP9 ISOBMFF binding §2.2: profile, level, bit depth plus
 * chroma subsampling and video range flag, then three colour info bytes, then
 * a `codec_initialization_data_size` field of zero. Chrome's VP9
 * `VideoEncoder` does not populate `metadata.decoderConfig.description`
 * because VP9 is self-describing inside the bitstream, so the scenario
 * synthesizes the vpcC payload locally rather than waiting on the encoder for
 * a description it will never supply. BT.709 colour primaries, transfer, and
 * matrix are used for the synthesized track; these match Chrome's default
 * display-pipeline assumptions for an sRGB canvas source.
 *
 * @param webcodecsVp9CodecString - Codec identifier in the `vp09.PP.LL.BB`
 *   format (profile, level times ten as a decimal integer, bit depth).
 * @returns An eight-byte `Uint8Array` suitable as the `description` argument
 *   for the mp4craft VP9 codec adapter.
 */
function buildVp9VpccPayload(webcodecsVp9CodecString: string): Uint8Array<ArrayBuffer> {
  const codecParts = webcodecsVp9CodecString.split('.')
  if (codecParts[0] !== 'vp09' || codecParts.length < 4) {
    throw new Error(`Unsupported VP9 codec string '${webcodecsVp9CodecString}'. Expected format vp09.PP.LL.BB.`)
  }
  const profile = Number.parseInt(codecParts[1] ?? '', 10)
  const level = Number.parseInt(codecParts[2] ?? '', 10)
  const bitDepth = Number.parseInt(codecParts[3] ?? '', 10)
  if (!Number.isFinite(profile) || !Number.isFinite(level) || !Number.isFinite(bitDepth)) {
    throw new Error(`VP9 codec string '${webcodecsVp9CodecString}' has non-numeric components.`)
  }
  const chromaSubsampling420Colocated = 1
  const videoFullRangeFlag = 0
  const colourPrimariesBt709 = 1
  const transferCharacteristicsBt709 = 1
  const matrixCoefficientsBt709 = 1
  const vpccPayload = new Uint8Array(new ArrayBuffer(8))
  vpccPayload[0] = profile
  vpccPayload[1] = level
  vpccPayload[2] = (bitDepth << 4) | (chromaSubsampling420Colocated << 1) | videoFullRangeFlag
  vpccPayload[3] = colourPrimariesBt709
  vpccPayload[4] = transferCharacteristicsBt709
  vpccPayload[5] = matrixCoefficientsBt709
  vpccPayload[6] = 0
  vpccPayload[7] = 0
  return vpccPayload
}

/**
 * Metadata captured alongside an encoded video chunk. Each chunk sits in the
 * `pendingVideoChunk` slot until the next chunk arrives so the per-sample
 * `duration` can be computed from the successor's timestamp.
 */
type VideoChunkEntry = {
  chunk: EncodedVideoChunk
}

/**
 * Emits a video chunk into the muxer with an explicit `duration` derived from
 * the supplied next-chunk timestamp. When no successor timestamp is available
 * (the trailing flushed chunk), a nominal 60-fps frame interval is used so the
 * sample table still reports a non-zero length.
 *
 * @param muxer - The live muxer receiving the sample.
 * @param entry - The buffered chunk.
 * @param nextTimestampMicroseconds - Timestamp of the chunk that follows the
 *   supplied entry, or `null` when `entry` is the final flushed chunk.
 */
function emitVideoChunkToMuxer(
  muxer: Mp4Muxer<ArrayBufferTarget>,
  entry: VideoChunkEntry,
  nextTimestampMicroseconds: number | null
): void {
  const computedDuration =
    nextTimestampMicroseconds !== null
      ? Math.max(1, nextTimestampMicroseconds - entry.chunk.timestamp)
      : TRAILING_CHUNK_DURATION_MICROSECONDS
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
 * Mutable state that survives React renders without triggering them. Held
 * inside a single ref so teardown iterates one object instead of chasing
 * several independent fields.
 */
type RecordingSessionState = {
  muxer: Mp4Muxer<ArrayBufferTarget> | null
  target: ArrayBufferTarget | null
  videoPipeline: VideoEncoderPipelineHandle | null
  /**
   * The most recently observed chunk, held until the next chunk arrives so
   * the sample duration can be computed from the delta between timestamps.
   * Flushed during stop with the nominal fallback duration.
   */
  pendingVideoChunk: VideoChunkEntry | null
  frameCounter: number
  videoSampleCount: number
  bufferedBytes: number
  startTimestampMs: number
  /**
   * Timestamp of the last keyframe in microseconds, used to schedule the
   * next forced keyframe once the configured interval has elapsed.
   */
  lastKeyframeTimestampMicroseconds: number | null
  /**
   * Set by the Stop button handler. The capture loop observes this on its
   * next tick and resolves the capture promise so the scenario can proceed
   * to flush and finalize.
   */
  isStopRequested: boolean
}

/**
 * Readable telemetry snapshot rendered by the `Stats` component during the
 * `recording` phase.
 */
type RecordingTelemetry = {
  elapsedMs: number
  videoSampleCount: number
  bufferedBytes: number
}

const INITIAL_TELEMETRY: RecordingTelemetry = {
  elapsedMs: 0,
  videoSampleCount: 0,
  bufferedBytes: 0,
}

/**
 * Canvas-to-MP4 scenario. Draws an animated gradient onto a 2D canvas at the
 * display refresh rate, captures `VideoFrame` snapshots, runs them through a
 * VP9 `VideoEncoder`, and muxes the encoded chunks into an in-memory MP4 via
 * {@link Mp4Muxer} wired to {@link ArrayBufferTarget}. Recording continues
 * until the user clicks Stop, then the finalized bytes are offered as a
 * download and as a playback preview.
 *
 * Frame timestamps are derived from wall-clock deltas against the recording
 * start, so the captured video matches the real-time pacing of the on-screen
 * animation regardless of the actual `requestAnimationFrame` cadence.
 *
 * The scenario uses VP9 profile 0 at level 3.0 (`vp09.00.30.08`), which
 * comfortably covers the 640x360 source.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function CanvasAnimation() {
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [telemetry, setTelemetry] = useState<RecordingTelemetry>(INITIAL_TELEMETRY)
  const [playbackObjectUrl, setPlaybackObjectUrl] = useState<string | null>(null)
  const [savedBytes, setSavedBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)

  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const sessionRef = useRef<RecordingSessionState | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const animationFrameRef = useRef<number | null>(null)
  const previewAnimationFrameRef = useRef<number | null>(null)
  const lastTelemetryFlushRef = useRef<number>(0)

  /*
   * Idle-phase preview loop. Drives the same gradient animation on the visible
   * canvas so the scenario feels alive even before recording starts. Cancelled
   * as soon as the recording loop takes over or the scenario unmounts.
   */
  useEffect(() => {
    if (phase !== 'idle') {
      return
    }
    const canvasElement = canvasElementRef.current
    if (canvasElement === null) {
      return
    }
    const drawingContext = canvasElement.getContext('2d')
    if (drawingContext === null) {
      return
    }

    let previewFrameIndex = 0
    const renderPreviewFrame = (): void => {
      drawAnimationFrame(drawingContext, previewFrameIndex)
      previewFrameIndex += 1
      previewAnimationFrameRef.current = requestAnimationFrame(renderPreviewFrame)
    }
    previewAnimationFrameRef.current = requestAnimationFrame(renderPreviewFrame)

    return () => {
      if (previewAnimationFrameRef.current !== null) {
        cancelAnimationFrame(previewAnimationFrameRef.current)
        previewAnimationFrameRef.current = null
      }
    }
  }, [phase])

  /*
   * Schedules a throttled UI refresh pulling the latest counters from the
   * mutable session state.
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
        bufferedBytes: session.bufferedBytes,
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
    if (session.videoPipeline !== null) {
      try {
        await session.videoPipeline.close()
      } catch {
        /* The encoder may already be closed if finalize ran first. */
      }
    }
  }, [])

  /*
   * Drives the capture: constructs the encoder, builds the muxer, then pushes
   * a frame per `requestAnimationFrame` tick until the user clicks Stop.
   * Flushes the encoder, finalizes the muxer, and transitions into `stopped`
   * on success. Any thrown error routes into `error`.
   */
  const beginRecordingSession = useCallback(async (): Promise<void> => {
    setPhase('preparing')
    setErrorMessage('')
    setTelemetry(INITIAL_TELEMETRY)

    if (typeof VideoEncoder === 'undefined') {
      setErrorMessage(
        'This browser does not expose WebCodecs VideoEncoder. Use Chrome 94 or newer to run the CanvasAnimation scenario.'
      )
      setPhase('error')
      return
    }

    const canvasElement = canvasElementRef.current
    if (canvasElement === null) {
      setErrorMessage('Canvas element is not ready yet.')
      setPhase('error')
      return
    }
    const drawingContext = canvasElement.getContext('2d')
    if (drawingContext === null) {
      setErrorMessage('Failed to acquire a 2D rendering context.')
      setPhase('error')
      return
    }

    /*
     * Stop the idle preview loop so the recording path drives the canvas
     * without visual contention. The effect above cancels too, but the phase
     * state flip lags by one React render so clearing here closes the race.
     */
    if (previewAnimationFrameRef.current !== null) {
      cancelAnimationFrame(previewAnimationFrameRef.current)
      previewAnimationFrameRef.current = null
    }

    const session: RecordingSessionState = {
      muxer: null,
      target: null,
      videoPipeline: null,
      pendingVideoChunk: null,
      frameCounter: 0,
      videoSampleCount: 0,
      bufferedBytes: 0,
      startTimestampMs: 0,
      lastKeyframeTimestampMicroseconds: null,
      isStopRequested: false,
    }
    sessionRef.current = session

    try {
      const target = new ArrayBufferTarget()
      session.target = target

      const synthesizedVp9Description = buildVp9VpccPayload(VIDEO_CODEC_STRING)

      /*
       * Construct the muxer before the encoder so the `onChunk` callback can
       * forward every chunk directly without a buffer-and-replay step. The
       * synthesized vpcC payload sidesteps Chrome's VP9 encoder, which does
       * not emit `metadata.decoderConfig.description`.
       */
      const muxer = new Mp4Muxer<ArrayBufferTarget>({
        target,
        fastStart: 'in-memory',
        video: {
          codec: 'vp9',
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          description: synthesizedVp9Description,
        },
      })
      session.muxer = muxer

      const videoPipeline = createVideoEncoderPipeline({
        codec: VIDEO_CODEC_STRING,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        framerate: NOMINAL_FRAMERATE_HINT,
        bitrate: TARGET_BITRATE,
        onChunk: (chunk, _metadata) => {
          const activeSession = sessionRef.current
          if (activeSession === null || activeSession.muxer === null) {
            return
          }
          /*
           * `VideoFrame.duration` is not forwarded into `EncodedVideoChunk`
           * in Chrome, so the scenario derives per-sample durations from
           * timestamp deltas. The most recent chunk parks in
           * `pendingVideoChunk` until the next chunk arrives; that point
           * emits the predecessor with an exact delta duration. The final
           * pending chunk flushes on stop with a nominal fallback.
           */
          activeSession.videoSampleCount += 1
          activeSession.bufferedBytes += chunk.byteLength
          if (activeSession.pendingVideoChunk !== null) {
            emitVideoChunkToMuxer(activeSession.muxer, activeSession.pendingVideoChunk, chunk.timestamp)
          }
          activeSession.pendingVideoChunk = { chunk }
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

      session.startTimestampMs = performance.now()
      setPhase('recording')
      scheduleTelemetryRefresh()

      /*
       * rAF-driven capture. Each tick renders a frame at the display refresh
       * rate and stamps it with a wall-clock timestamp derived from
       * `startTimestampMs`, so recorded playback matches the pacing of the
       * visible animation regardless of refresh rate. The loop runs until
       * the user clicks Stop, which sets `isStopRequested` on the session.
       */
      await new Promise<void>((resolveCaptureLoop, rejectCaptureLoop) => {
        const emitNextFrame = (): void => {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            rejectCaptureLoop(new Error('Session cancelled during capture.'))
            return
          }
          if (activeSession.isStopRequested) {
            resolveCaptureLoop()
            return
          }
          const timestampMicroseconds = Math.round((performance.now() - activeSession.startTimestampMs) * 1000)
          drawAnimationFrame(drawingContext, activeSession.frameCounter)
          const capturedFrame = new VideoFrame(canvasElement, {
            timestamp: timestampMicroseconds,
          })
          activeSession.frameCounter += 1
          const shouldInsertKeyframe =
            activeSession.lastKeyframeTimestampMicroseconds === null ||
            timestampMicroseconds - activeSession.lastKeyframeTimestampMicroseconds >= KEYFRAME_INTERVAL_MICROSECONDS
          if (shouldInsertKeyframe) {
            activeSession.lastKeyframeTimestampMicroseconds = timestampMicroseconds
          }
          videoPipeline.encoder.encode(capturedFrame, {
            keyFrame: shouldInsertKeyframe,
          })
          capturedFrame.close()
          requestAnimationFrame(emitNextFrame)
        }
        requestAnimationFrame(emitNextFrame)
      })

      await videoPipeline.encoder.flush()

      const activeSession = sessionRef.current
      if (activeSession === null || activeSession.muxer === null) {
        return
      }
      /*
       * Flush the last chunk waiting for a successor. Its duration falls back
       * to the nominal 60-fps interval so the final sample still reads as a
       * real frame-length entry in the stts table.
       */
      if (activeSession.pendingVideoChunk !== null) {
        emitVideoChunkToMuxer(activeSession.muxer, activeSession.pendingVideoChunk, null)
        activeSession.pendingVideoChunk = null
      }
      setPhase('stopping')
      await activeSession.muxer.finalize()

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      const finalizedBytes = new Uint8Array(target.buffer)
      const playbackBlob = new Blob([finalizedBytes], { type: 'video/mp4' })
      const objectUrl = URL.createObjectURL(playbackBlob)

      if (!isMountedRef.current) {
        URL.revokeObjectURL(objectUrl)
        sessionRef.current = null
        return
      }

      setSavedBytes(finalizedBytes)
      setPlaybackObjectUrl(objectUrl)
      setTelemetry({
        elapsedMs: performance.now() - activeSession.startTimestampMs,
        videoSampleCount: activeSession.videoSampleCount,
        bufferedBytes: finalizedBytes.byteLength,
      })
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
  }, [releaseSessionResources, scheduleTelemetryRefresh])

  /*
   * Requests the capture loop to stop. The loop observes the flag on its next
   * `requestAnimationFrame` tick, resolves its capture promise, and
   * `beginRecordingSession` continues into flush and finalize.
   */
  const requestStopRecording = useCallback((): void => {
    const session = sessionRef.current
    if (session === null) {
      return
    }
    session.isStopRequested = true
  }, [])

  /*
   * Return the scenario to the `idle` phase, releasing the previous recording's
   * object URL so a second recording starts from a clean slate.
   */
  const resetSession = useCallback((): void => {
    if (playbackObjectUrl !== null) {
      URL.revokeObjectURL(playbackObjectUrl)
    }
    setPlaybackObjectUrl(null)
    setSavedBytes(null)
    setTelemetry(INITIAL_TELEMETRY)
    setErrorMessage('')
    setPhase('idle')
  }, [playbackObjectUrl])

  const handleSaveClick = useCallback(async (): Promise<void> => {
    if (savedBytes === null) {
      return
    }
    await saveBytesToDisk('canvas-animation.mp4', savedBytes)
  }, [savedBytes])

  /*
   * Revoke the playback object URL when the component unmounts or when a new
   * recording replaces the old one.
   */
  useEffect(() => {
    return () => {
      if (playbackObjectUrl !== null) {
        URL.revokeObjectURL(playbackObjectUrl)
      }
    }
  }, [playbackObjectUrl])

  /*
   * Teardown on unmount so a user navigating away mid-recording does not leave
   * encoder resources dangling.
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
      title="Canvas Animation"
      description="Generated canvas frames encoded with VP9 and muxed into an in-memory MP4."
    >
      <div className={canvasAnimationStyles.layout}>
        {renderPhaseContent({
          phase,
          errorMessage,
          telemetry,
          canvasElementRef,
          playbackObjectUrl,
          onStart: () => void beginRecordingSession(),
          onStop: requestStopRecording,
          onSave: () => void handleSaveClick(),
          onReset: resetSession,
          onRetry: resetSession,
        })}
      </div>
    </ScenarioFrame>
  )
}

/**
 * Arguments accepted by {@link renderPhaseContent}. Packaging the render inputs
 * inside a single record keeps the outer component body focused on lifecycle
 * wiring rather than branching UI.
 */
type PhaseRenderInputs = {
  phase: RecordingPhase
  errorMessage: string
  telemetry: RecordingTelemetry
  canvasElementRef: React.RefObject<HTMLCanvasElement>
  playbackObjectUrl: string | null
  onStart: () => void
  onStop: () => void
  onSave: () => void
  onReset: () => void
  onRetry: () => void
}

/**
 * Renders the correct card layout for the current recording phase.
 *
 * @param inputs - Current phase plus telemetry and callbacks required to drive it.
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
      label: 'Bytes buffered',
      value: formatBytes(inputs.telemetry.bufferedBytes),
    },
  ]

  const liveCanvasPreview = (
    <Card radius="medium" shadow="glow">
      <div className={canvasAnimationStyles.previewCard}>
        <h2 className={canvasAnimationStyles.previewHeading}>Canvas source</h2>
        <canvas
          ref={inputs.canvasElementRef}
          className={canvasAnimationStyles.previewCanvas}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
        />
      </div>
    </Card>
  )

  const phaseRenderers: Record<RecordingPhase, () => React.ReactElement> = {
    idle: () => (
      <>
        {liveCanvasPreview}
        <Card radius="medium" shadow="subtle">
          <div className={canvasAnimationStyles.statusCard}>
            <h2 className={canvasAnimationStyles.statusHeading}>Ready when you are</h2>
            <p className={canvasAnimationStyles.statusMessage}>
              The scenario captures canvas frames at the display refresh rate, encodes them with VP9, and finalizes the
              MP4 entirely in memory. Recording continues until you click Stop.
            </p>
            <div className={canvasAnimationStyles.actionRow}>
              <DarkButton onClick={inputs.onStart}>Start recording</DarkButton>
            </div>
          </div>
        </Card>
      </>
    ),
    preparing: () => (
      <>
        {liveCanvasPreview}
        <Card radius="medium" shadow="subtle">
          <div className={canvasAnimationStyles.statusCard}>
            <h2 className={canvasAnimationStyles.statusHeading}>Priming the encoder</h2>
            <p className={canvasAnimationStyles.statusMessage}>
              Configuring the VP9 encoder and preparing the muxer. The capture begins on the next animation frame.
            </p>
          </div>
        </Card>
      </>
    ),
    recording: () => (
      <>
        {liveCanvasPreview}
        <Card radius="medium" shadow="subtle">
          <div className={canvasAnimationStyles.statusCard}>
            <h2 className={canvasAnimationStyles.statusHeading}>Telemetry</h2>
            <Stats entries={statsEntries} />
            <div className={canvasAnimationStyles.actionRow}>
              <PillButton variant="nav-active" onClick={inputs.onStop}>
                Stop
              </PillButton>
            </div>
            <p className={canvasAnimationStyles.helperText}>
              Frames are encoded at the display refresh rate with wall-clock timestamps, so the recorded playback
              matches the pacing you see on-screen.
            </p>
          </div>
        </Card>
      </>
    ),
    stopping: () => (
      <>
        {liveCanvasPreview}
        <Card radius="medium" shadow="subtle">
          <div className={canvasAnimationStyles.statusCard}>
            <h2 className={canvasAnimationStyles.statusHeading}>Finalizing MP4</h2>
            <p className={canvasAnimationStyles.statusMessage}>
              Flushing the encoder, writing the moov atom, and snapshotting the buffer into a playable file.
            </p>
          </div>
        </Card>
      </>
    ),
    stopped: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={canvasAnimationStyles.previewCard}>
            <h2 className={canvasAnimationStyles.previewHeading}>Recorded playback</h2>
            {inputs.playbackObjectUrl !== null ? (
              <video
                key={inputs.playbackObjectUrl}
                className={canvasAnimationStyles.previewVideo}
                src={inputs.playbackObjectUrl}
                controls
                playsInline
              />
            ) : null}
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={canvasAnimationStyles.statusCard}>
            <h2 className={canvasAnimationStyles.statusHeading}>Summary</h2>
            <Stats entries={statsEntries} />
            <div className={canvasAnimationStyles.actionRow}>
              <DarkButton onClick={inputs.onSave}>Save MP4</DarkButton>
              <PillButton variant="nav-active" onClick={inputs.onReset}>
                Record Again
              </PillButton>
            </div>
            <p className={canvasAnimationStyles.helperText}>
              The save dialog uses the File System Access API when available and falls back to a Blob download in other
              browsers.
            </p>
          </div>
        </Card>
      </>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={canvasAnimationStyles.statusCard}>
          <h2 className={canvasAnimationStyles.statusHeading}>Recording failed</h2>
          <p className={canvasAnimationStyles.errorMessage}>
            {inputs.errorMessage !== ''
              ? inputs.errorMessage
              : 'An unknown error occurred while setting up the recording.'}
          </p>
          <div className={canvasAnimationStyles.actionRow}>
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

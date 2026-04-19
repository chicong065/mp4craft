import { Card } from '@/components/Card'
import { DarkButton } from '@/components/DarkButton'
import { PillButton } from '@/components/PillButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { saveBytesToDisk } from '@/lib/download'
import { createVideoEncoderPipeline } from '@/lib/encoders'
import type { VideoEncoderPipelineHandle } from '@/lib/encoders'
import screenRecorderStyles from '@/scenarios/ScreenRecorder.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phases of the screen recording session. The UI renders a different layout
 * per phase and only the legal transitions are reachable from each.
 */
type RecordingPhase = 'idle' | 'preparing' | 'recording' | 'stopping' | 'stopped' | 'error'

/** Framerate requested from `getDisplayMedia`. Chrome honours this in most cases. */
const TARGET_VIDEO_FRAMERATE = 30

/**
 * AVC Baseline 3.1 covers HD output from most displays without crossing into
 * the high-profile constraints that some browsers refuse to encode.
 */
const TARGET_VIDEO_BITRATE = 5_000_000

/** Keyframe cadence. Matches the other recorder scenarios for consistency. */
const KEYFRAME_INTERVAL_FRAMES = 30

/** UI telemetry refresh cadence in milliseconds. */
const UI_REFRESH_INTERVAL_MS = 100

/**
 * Fallback duration in microseconds applied to any video chunk whose next
 * chunk timestamp is unavailable, typically the final flushed chunk. Derived
 * from the target framerate so the tail sample reads as one frame long.
 */
const DEFAULT_VIDEO_FRAME_DURATION_US = Math.round(1_000_000 / TARGET_VIDEO_FRAMERATE)

/** Default file name suggested inside the save dialog. */
const DEFAULT_FILE_NAME = 'screen-capture.mp4'

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
 * Metadata captured alongside an encoded video chunk. The scenario defers
 * handing each chunk to the muxer so the per-sample `duration` can be computed
 * from the next chunk's timestamp. Chrome's `VideoEncoder` does not populate
 * `EncodedVideoChunk.duration` for frames read off a `MediaStreamTrack` (those
 * frames carry a timestamp but no duration), which would otherwise surface as
 * a 0-second MP4 because the muxer writes `chunk.duration ?? 0` per sample.
 */
type VideoChunkEntry = {
  chunk: EncodedVideoChunk
  metadata: EncodedVideoChunkMetadata | undefined
}

/**
 * Emits a video chunk into the muxer with an explicit `duration` computed
 * from the supplied next-chunk timestamp. When no successor timestamp is
 * available (the trailing flushed chunk), a fallback based on the configured
 * framerate is used so the sample table still reports a non-zero length.
 *
 * @param muxer - The live muxer receiving the sample.
 * @param entry - The buffered chunk and its metadata.
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
 * Mutable state that survives React renders without triggering them. Held
 * inside a single ref so teardown iterates one object instead of chasing
 * several independent fields.
 */
type RecordingSessionState = {
  muxer: Mp4Muxer<ArrayBufferTarget> | null
  target: ArrayBufferTarget | null
  videoPipeline: VideoEncoderPipelineHandle | null
  mediaStream: MediaStream | null
  videoReader: ReadableStreamDefaultReader<VideoFrame> | null
  /**
   * Chunks that arrived from the encoder before the muxer was constructed.
   * Drained once the muxer exists, with per-sample durations derived from
   * adjacent timestamps.
   */
  earlyVideoChunks: VideoChunkEntry[]
  /**
   * The most recently observed chunk, held until the next chunk arrives so
   * the sample duration can be computed from the delta between timestamps.
   * Flushed during stop with the framerate-based fallback duration.
   */
  pendingVideoChunk: VideoChunkEntry | null
  frameCounter: number
  videoSampleCount: number
  bytesWritten: number
  startTimestampMs: number
}

/**
 * Readable telemetry snapshot rendered by the `Stats` component during the
 * `recording` phase.
 */
type RecordingTelemetry = {
  elapsedMs: number
  videoSampleCount: number
  bytesWritten: number
}

const INITIAL_TELEMETRY: RecordingTelemetry = {
  elapsedMs: 0,
  videoSampleCount: 0,
  bytesWritten: 0,
}

/**
 * Screen-to-MP4 scenario. Captures `getDisplayMedia`, encodes frames with AVC
 * via WebCodecs `VideoEncoder`, and muxes the encoded chunks into an in-memory
 * MP4 via {@link Mp4Muxer} wired to {@link ArrayBufferTarget}. When the user
 * clicks Stop the finalized bytes are offered as a playback preview and a
 * save button that invokes the File System Access API save dialog via the
 * shared `saveBytesToDisk` helper (falling back to a Blob download in
 * browsers that do not expose `window.showSaveFilePicker`).
 *
 * The scenario depends on two Chromium-only APIs: `getDisplayMedia` and
 * `MediaStreamTrackProcessor`. Browsers that lack either surface the error
 * state up front with a compatibility message.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 * @see {@link https://wicg.github.io/file-system-access/ | File System Access API}
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function ScreenRecorder() {
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [telemetry, setTelemetry] = useState<RecordingTelemetry>(INITIAL_TELEMETRY)
  const [savedBytes, setSavedBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const [playbackObjectUrl, setPlaybackObjectUrl] = useState<string | null>(null)
  /*
   * The live preview `<video>` is only mounted during the `recording` phase, so
   * the ref is null at the moment the stream is acquired. Holding the stream in
   * state lets a paired effect attach it after React commits the recording
   * layout and the video element exists.
   */
  const [recordingMediaStream, setRecordingMediaStream] = useState<MediaStream | null>(null)

  const livePreviewElementRef = useRef<HTMLVideoElement | null>(null)
  const sessionRef = useRef<RecordingSessionState | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const animationFrameRef = useRef<number | null>(null)
  const lastTelemetryFlushRef = useRef<number>(0)

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
        bytesWritten: session.bytesWritten,
      })
      scheduleTelemetryRefresh()
    })
  }, [])

  /*
   * Teardown every resource held by the session. Safe to call in any phase.
   * The encoder, reader, and media tracks are released so the browser's
   * screen-sharing indicator clears immediately and the encoder does not
   * continue consuming compute on an abandoned pipeline.
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
  }, [])

  /*
   * Drives the `getDisplayMedia` handshake, encoder construction, muxer
   * deferred-start handshake, and frame-loop launch. Soft failures (user
   * declined the share sheet) return to idle with a short message. Hard
   * failures (encoder error, missing APIs) route into the `error` phase.
   * The output is muxed entirely in memory; the user picks a save location
   * from the stopped-phase Save button rather than up front.
   */
  const beginRecordingSession = useCallback(async (): Promise<void> => {
    setPhase('preparing')
    setErrorMessage('')
    setStatusMessage('')
    setTelemetry(INITIAL_TELEMETRY)

    if (typeof MediaStreamTrackProcessor === 'undefined' || typeof VideoEncoder === 'undefined') {
      setErrorMessage(
        'This scenario requires Chromium-only WebCodecs and MediaStreamTrackProcessor APIs. Use Chrome 94 or newer on desktop.'
      )
      setPhase('error')
      return
    }

    let mediaStream: MediaStream
    try {
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: TARGET_VIDEO_FRAMERATE },
        audio: false,
      })
    } catch (displayMediaReason) {
      if (isMountedRef.current) {
        setStatusMessage(
          displayMediaReason instanceof Error
            ? `No screen selected: ${displayMediaReason.message}`
            : 'No screen selected.'
        )
        setPhase('idle')
      }
      return
    }

    const session: RecordingSessionState = {
      muxer: null,
      target: null,
      videoPipeline: null,
      mediaStream,
      videoReader: null,
      earlyVideoChunks: [],
      pendingVideoChunk: null,
      frameCounter: 0,
      videoSampleCount: 0,
      bytesWritten: 0,
      startTimestampMs: 0,
    }
    sessionRef.current = session

    try {
      const target = new ArrayBufferTarget()
      session.target = target

      const videoTrack = mediaStream.getVideoTracks()[0]
      if (videoTrack === undefined) {
        throw new Error('The granted display-media stream is missing a video track.')
      }

      const videoSettings = videoTrack.getSettings()
      const capturedWidth = videoSettings.width
      const capturedHeight = videoSettings.height
      if (capturedWidth === undefined || capturedHeight === undefined) {
        throw new Error('The display-media track did not report width or height. Pick a different capture source.')
      }
      const capturedFramerate = videoSettings.frameRate ?? TARGET_VIDEO_FRAMERATE

      const videoPipeline = createVideoEncoderPipeline({
        codec: 'avc1.42001f',
        width: capturedWidth,
        height: capturedHeight,
        framerate: capturedFramerate,
        bitrate: TARGET_VIDEO_BITRATE,
        /*
         * mp4craft expects length-prefixed NAL units. See CameraRecorder for
         * the full justification.
         */
        extraConfigureOptions: { avc: { format: 'avc' } },
        onChunk: (encodedChunk, chunkMetadata) => {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          /*
           * `EncodedVideoChunk.duration` is undefined for frames pulled off a
           * `MediaStreamTrack`, so the scenario computes per-sample durations
           * from timestamp deltas. The most recent chunk sits in
           * `pendingVideoChunk` until the next chunk arrives; at that point
           * the predecessor emits into the muxer with the exact delta. The
           * final pending chunk flushes on stop with a framerate-based
           * fallback duration.
           */
          activeSession.videoSampleCount += 1
          activeSession.bytesWritten += encodedChunk.byteLength
          const incomingEntry: VideoChunkEntry = {
            chunk: encodedChunk,
            metadata: chunkMetadata,
          }
          if (activeSession.muxer === null) {
            activeSession.earlyVideoChunks.push(incomingEntry)
            return
          }
          if (activeSession.pendingVideoChunk !== null) {
            emitVideoChunkToMuxer(activeSession.muxer, activeSession.pendingVideoChunk, encodedChunk.timestamp)
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
       * Render a live self-preview. Stash the stream in state so the paired
       * effect can attach it after React commits the recording-phase layout,
       * at which point the video element is actually in the DOM.
       */
      setRecordingMediaStream(mediaStream)

      /*
       * Promote a browser-side stop (the user clicks "Stop sharing" in the
       * native control bar) into a scenario stop so the muxer still
       * finalizes the file cleanly.
       */
      videoTrack.addEventListener(
        'ended',
        () => {
          void requestStopIfActive()
        },
        { once: true }
      )

      session.startTimestampMs = performance.now()
      setPhase('recording')
      scheduleTelemetryRefresh()

      /*
       * Capture loop: reads frames from the display-media track and feeds
       * them into the AVC encoder at their native cadence. The loop runs
       * concurrently with the `firstDescription` await below, so the encoder
       * stays fed while the scenario is still waiting for the decoder
       * configuration record. Running the loop up front also prevents Chrome
       * from starving the `MediaStreamTrackProcessor` during the initial
       * setup tick, which in an earlier iteration caused the encoder to
       * batch only the priming frame and finalize into a one-sample file.
       */
      const videoLoop = async (): Promise<void> => {
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
          const shouldInsertKeyframe =
            activeSession.frameCounter === 1 || activeSession.frameCounter % KEYFRAME_INTERVAL_FRAMES === 0
          videoPipeline.encoder.encode(nextFrameResult.value, {
            keyFrame: shouldInsertKeyframe,
          })
          nextFrameResult.value.close()
        }
      }
      void videoLoop()

      const videoDescription = await videoPipeline.firstDescription

      const muxer = new Mp4Muxer<ArrayBufferTarget>({
        target,
        fastStart: 'in-memory',
        video: {
          codec: 'avc',
          width: capturedWidth,
          height: capturedHeight,
          description: videoDescription,
        },
      })
      session.muxer = muxer

      /*
       * Drain the chunks that arrived before the muxer existed. Each entry
       * borrows its duration from the timestamp of the chunk that follows it,
       * and the trailing drained chunk is promoted to `pendingVideoChunk` so
       * the next live arrival can compute its duration as usual.
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
   * Drains the encoder, finalizes the muxer, snapshots the produced bytes for
   * playback and save, and transitions into the stopped phase.
   */
  const stopRecordingSession = useCallback(async (): Promise<void> => {
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
      if (session.muxer === null || session.target === null) {
        throw new Error('Muxer was not constructed before stop was requested.')
      }
      /*
       * Flush any chunk still waiting for a successor. Its duration falls
       * back to the framerate-derived default so the final sample reads as
       * a real frame-length entry in the stts table.
       */
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

      const finalizedBytes = new Uint8Array(session.target.buffer)
      const playbackBlob = new Blob([finalizedBytes], { type: 'video/mp4' })
      const freshObjectUrl = URL.createObjectURL(playbackBlob)

      const finalTelemetry: RecordingTelemetry = {
        elapsedMs: performance.now() - session.startTimestampMs,
        videoSampleCount: session.videoSampleCount,
        bytesWritten: finalizedBytes.byteLength,
      }

      if (!isMountedRef.current) {
        URL.revokeObjectURL(freshObjectUrl)
        sessionRef.current = null
        return
      }

      setTelemetry(finalTelemetry)
      setSavedBytes(finalizedBytes)
      setPlaybackObjectUrl(freshObjectUrl)
      setRecordingMediaStream(null)
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
   * Bridge used by the display-media `ended` listener. The listener fires on
   * a different tick so the phase reference inside `stopRecordingSession` must
   * be resolved at call time rather than captured by the closure below.
   */
  const requestStopIfActive = useCallback(async (): Promise<void> => {
    if (sessionRef.current === null) {
      return
    }
    await stopRecordingSession()
  }, [stopRecordingSession])

  /*
   * Return the scenario to the `idle` phase so a second recording starts from
   * a clean slate. Revokes the previous recording's playback object URL so
   * it does not leak across sessions.
   */
  const resetSession = useCallback((): void => {
    if (playbackObjectUrl !== null) {
      URL.revokeObjectURL(playbackObjectUrl)
    }
    setSavedBytes(null)
    setPlaybackObjectUrl(null)
    setStatusMessage('')
    setErrorMessage('')
    setTelemetry(INITIAL_TELEMETRY)
    setRecordingMediaStream(null)
    setPhase('idle')
  }, [playbackObjectUrl])

  /*
   * Prompts the user for a save location and writes the finalized MP4 bytes
   * to disk. Uses the File System Access API via `saveBytesToDisk` when the
   * browser supports it, or an anchor-download fallback otherwise.
   */
  const handleSaveClick = useCallback(async (): Promise<void> => {
    if (savedBytes === null) {
      return
    }
    await saveBytesToDisk(DEFAULT_FILE_NAME, savedBytes)
  }, [savedBytes])

  /*
   * Revoke the playback object URL when the component unmounts or when a
   * new recording replaces the previous one.
   */
  useEffect(() => {
    return () => {
      if (playbackObjectUrl !== null) {
        URL.revokeObjectURL(playbackObjectUrl)
      }
    }
  }, [playbackObjectUrl])

  /*
   * Attach the live MediaStream after the recording-phase layout mounts the
   * `<video>` element. Cleans up when the stream changes or the component
   * unmounts so the element does not retain a reference to a stopped stream.
   */
  useEffect(() => {
    const videoElement = livePreviewElementRef.current
    if (videoElement === null || recordingMediaStream === null) {
      return
    }
    videoElement.srcObject = recordingMediaStream
    videoElement.play().catch(() => undefined)
    return () => {
      if (videoElement.srcObject === recordingMediaStream) {
        videoElement.srcObject = null
      }
    }
  }, [recordingMediaStream])

  /*
   * Teardown on unmount so a user navigating away mid-recording does not leave
   * capture resources or writables dangling.
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
      title="Screen Recorder"
      description="getDisplayMedia encoded with AVC and muxed into an in-memory MP4."
    >
      <div className={screenRecorderStyles.layout}>
        {renderPhaseContent({
          phase,
          statusMessage,
          errorMessage,
          telemetry,
          playbackObjectUrl,
          canSave: savedBytes !== null,
          livePreviewElementRef,
          onStart: () => void beginRecordingSession(),
          onStop: () => void stopRecordingSession(),
          onSave: () => void handleSaveClick(),
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
  phase: RecordingPhase
  statusMessage: string
  errorMessage: string
  telemetry: RecordingTelemetry
  playbackObjectUrl: string | null
  canSave: boolean
  livePreviewElementRef: React.MutableRefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
  onSave: () => void
  onReset: () => void
  onRetry: () => void
}

/**
 * Renders the correct card layout for the current recording phase.
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
      label: 'Bytes written',
      value: formatBytes(inputs.telemetry.bytesWritten),
    },
  ]

  const phaseRenderers: Record<RecordingPhase, () => React.ReactElement> = {
    idle: () => (
      <Card radius="medium" shadow="subtle">
        <div className={screenRecorderStyles.statusCard}>
          <h2 className={screenRecorderStyles.statusHeading}>Capture a screen or window</h2>
          <p className={screenRecorderStyles.statusMessage}>
            The browser prompts for a screen to share. The encoded AVC samples are muxed into an in-memory MP4 and
            offered as a playback preview plus save button when you click Stop.
          </p>
          {inputs.statusMessage !== '' ? (
            <p className={screenRecorderStyles.helperText}>{inputs.statusMessage}</p>
          ) : null}
          <p className={screenRecorderStyles.compatibilityNote}>
            Requires Chromium: getDisplayMedia and MediaStreamTrackProcessor are not available in Safari or Firefox.
          </p>
          <div className={screenRecorderStyles.actionRow}>
            <DarkButton onClick={inputs.onStart}>Start Capture</DarkButton>
          </div>
        </div>
      </Card>
    ),
    preparing: () => (
      <Card radius="medium" shadow="subtle">
        <div className={screenRecorderStyles.statusCard}>
          <h2 className={screenRecorderStyles.statusHeading}>Waiting on browser prompt</h2>
          <p className={screenRecorderStyles.statusMessage}>
            Grant the screen share permission. Recording begins once the encoder emits its first decoder configuration.
          </p>
        </div>
      </Card>
    ),
    recording: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={screenRecorderStyles.previewCard}>
            <h2 className={screenRecorderStyles.previewHeading}>Live preview</h2>
            <video
              ref={inputs.livePreviewElementRef}
              className={screenRecorderStyles.previewVideo}
              muted
              autoPlay
              playsInline
            />
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={screenRecorderStyles.statusCard}>
            <h2 className={screenRecorderStyles.statusHeading}>Telemetry</h2>
            <Stats entries={statsEntries} />
            <div className={screenRecorderStyles.actionRow}>
              <PillButton variant="nav-active" onClick={inputs.onStop}>
                Stop
              </PillButton>
            </div>
            <p className={screenRecorderStyles.helperText}>
              Encoded AVC chunks are muxed into an in-memory MP4. Click Stop to finalize and get a playback preview plus
              a save button.
            </p>
          </div>
        </Card>
      </>
    ),
    stopping: () => (
      <Card radius="medium" shadow="subtle">
        <div className={screenRecorderStyles.statusCard}>
          <h2 className={screenRecorderStyles.statusHeading}>Finalizing MP4</h2>
          <p className={screenRecorderStyles.statusMessage}>
            Flushing the encoder, writing the moov atom, and snapshotting the in-memory buffer into a playable file.
          </p>
        </div>
      </Card>
    ),
    stopped: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={screenRecorderStyles.previewCard}>
            <h2 className={screenRecorderStyles.previewHeading}>Recorded playback</h2>
            {inputs.playbackObjectUrl !== null ? (
              <video
                key={inputs.playbackObjectUrl}
                className={screenRecorderStyles.previewVideo}
                src={inputs.playbackObjectUrl}
                controls
                playsInline
              />
            ) : null}
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={screenRecorderStyles.statusCard}>
            <h2 className={screenRecorderStyles.statusHeading}>Capture complete</h2>
            <Stats entries={statsEntries} />
            <div className={screenRecorderStyles.actionRow}>
              <DarkButton onClick={inputs.onSave} disabled={!inputs.canSave}>
                Save MP4
              </DarkButton>
              <PillButton variant="nav-active" onClick={inputs.onReset}>
                Record Another
              </PillButton>
            </div>
            <p className={screenRecorderStyles.helperText}>
              Save opens the File System Access save dialog when available and falls back to a Blob download otherwise.
            </p>
          </div>
        </Card>
      </>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={screenRecorderStyles.statusCard}>
          <h2 className={screenRecorderStyles.statusHeading}>Recording failed</h2>
          <p className={screenRecorderStyles.errorMessage}>
            {inputs.errorMessage !== ''
              ? inputs.errorMessage
              : 'An unknown error occurred while setting up the recording.'}
          </p>
          <div className={screenRecorderStyles.actionRow}>
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

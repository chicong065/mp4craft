import { Card } from '@/components/Card'
import { DarkButton } from '@/components/DarkButton'
import { PillButton } from '@/components/PillButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { saveBytesToDisk } from '@/lib/download'
import { createAudioEncoderPipeline, createVideoEncoderPipeline } from '@/lib/encoders'
import type { AudioEncoderPipelineHandle, VideoEncoderPipelineHandle } from '@/lib/encoders'
import cameraRecorderStyles from '@/scenarios/CameraRecorder.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phases of the camera recording session. The UI renders a different layout per
 * phase and only the legal transitions are reachable from each.
 */
type RecordingPhase = 'idle' | 'preparing' | 'recording' | 'stopping' | 'stopped' | 'error'

/**
 * Recording target resolution. 1280x720 at 30 fps keeps the AVC encoder inside
 * profile `42001f` (Baseline 3.1) on every shipping browser tested.
 */
const TARGET_VIDEO_WIDTH = 1280
const TARGET_VIDEO_HEIGHT = 720
const TARGET_VIDEO_FRAMERATE = 30
const TARGET_VIDEO_BITRATE = 5_000_000

/** AAC-LC at 48 kHz mono is the broadest-compatibility audio profile. */
const TARGET_AUDIO_CHANNELS = 1
const TARGET_AUDIO_SAMPLE_RATE = 48_000
const TARGET_AUDIO_BITRATE = 128_000

/** Insert a keyframe roughly every second at 30 fps. */
const KEYFRAME_INTERVAL_FRAMES = 30

/** UI telemetry refresh cadence in milliseconds. 100ms keeps the UI responsive. */
const UI_REFRESH_INTERVAL_MS = 100

/**
 * Fallback duration in microseconds applied to any video chunk whose
 * successor is unavailable (typically the final flushed chunk). Derived from
 * the target framerate so the tail sample reads as one frame long.
 */
const DEFAULT_VIDEO_FRAME_DURATION_US = Math.round(1_000_000 / TARGET_VIDEO_FRAMERATE)

/**
 * Fallback duration in microseconds applied to any audio chunk whose
 * successor is unavailable. AAC-LC always emits 1024 samples per chunk, so
 * `1024 / sampleRate` in seconds converted to microseconds is the exact
 * duration of a single AAC frame.
 */
const DEFAULT_AAC_FRAME_DURATION_US = Math.round((1024 * 1_000_000) / TARGET_AUDIO_SAMPLE_RATE)

/**
 * Formats a byte count as a short human-readable string, for example `1.42 MB`.
 * The playground prefers SI units because browser download dialogs already use
 * them, which keeps the stats panel consistent with the save target filename.
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
 * Formats an elapsed millisecond count as `m:ss`. Minutes grow without bound so
 * long recordings still render cleanly.
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
 * Encoded video chunk plus the metadata that arrived with it. The muxer
 * needs the chunk bytes, the original timestamp, and a computed duration
 * derived from the next chunk's timestamp. Holding the raw chunk lets the
 * pending-slot logic recompute the duration once the successor arrives.
 */
type VideoChunkEntry = {
  chunk: EncodedVideoChunk
  metadata: EncodedVideoChunkMetadata | undefined
}

/**
 * Encoded audio chunk plus the metadata that arrived with it. Same rationale
 * as {@link VideoChunkEntry}.
 */
type AudioChunkEntry = {
  chunk: EncodedAudioChunk
  metadata: EncodedAudioChunkMetadata | undefined
}

/**
 * Emits a video chunk into the muxer with an explicit duration computed from
 * the supplied next-chunk timestamp. When no successor timestamp is available
 * (the trailing flushed chunk), the framerate-derived default applies so the
 * sample table still reports a non-zero length.
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
 * Emits an audio chunk into the muxer with an explicit duration computed
 * from the supplied next-chunk timestamp. Falls back to the AAC-frame default
 * (1024 samples at the configured rate) when no successor is available.
 *
 * @param muxer - The live muxer receiving the sample.
 * @param entry - The buffered chunk and its metadata.
 * @param nextTimestampMicroseconds - Timestamp of the chunk that follows the
 *   supplied entry, or `null` when `entry` is the final flushed chunk.
 */
function emitAudioChunkToMuxer(
  muxer: Mp4Muxer<ArrayBufferTarget>,
  entry: AudioChunkEntry,
  nextTimestampMicroseconds: number | null
): void {
  const computedDuration =
    nextTimestampMicroseconds !== null
      ? Math.max(1, nextTimestampMicroseconds - entry.chunk.timestamp)
      : DEFAULT_AAC_FRAME_DURATION_US
  const sampleBytes = new Uint8Array(entry.chunk.byteLength)
  entry.chunk.copyTo(sampleBytes)
  muxer.addAudioSample({
    data: sampleBytes,
    timestamp: entry.chunk.timestamp,
    duration: computedDuration,
    isKeyFrame: entry.chunk.type === 'key',
  })
}

/**
 * Mutable state that survives React renders without triggering them. Held inside
 * a single ref so teardown can iterate one object instead of chasing several.
 */
type RecordingSessionState = {
  muxer: Mp4Muxer<ArrayBufferTarget> | null
  target: ArrayBufferTarget | null
  videoPipeline: VideoEncoderPipelineHandle | null
  audioPipeline: AudioEncoderPipelineHandle | null
  mediaStream: MediaStream | null
  videoReader: ReadableStreamDefaultReader<VideoFrame> | null
  audioReader: ReadableStreamDefaultReader<AudioData> | null
  /**
   * Video chunks that arrived before the muxer was constructed. Drained once
   * the muxer exists, with per-sample durations derived from adjacent
   * timestamps.
   */
  earlyVideoChunks: VideoChunkEntry[]
  /** Audio counterpart to {@link RecordingSessionState.earlyVideoChunks}. */
  earlyAudioChunks: AudioChunkEntry[]
  /**
   * The most recently observed video chunk, held until the next chunk arrives
   * so the sample duration can be computed from the delta between timestamps.
   * Flushed during stop with the framerate-based fallback duration.
   */
  pendingVideoChunk: VideoChunkEntry | null
  /** Audio counterpart to {@link RecordingSessionState.pendingVideoChunk}. */
  pendingAudioChunk: AudioChunkEntry | null
  frameCounter: number
  videoSampleCount: number
  audioSampleCount: number
  bufferedBytes: number
  startTimestampMs: number
}

/**
 * Readable telemetry snapshot rendered by the `Stats` component during the
 * `recording` phase. Using a single object keeps the rAF refresh cheap.
 */
type RecordingTelemetry = {
  elapsedMs: number
  videoSampleCount: number
  audioSampleCount: number
  bufferedBytes: number
}

const INITIAL_TELEMETRY: RecordingTelemetry = {
  elapsedMs: 0,
  videoSampleCount: 0,
  audioSampleCount: 0,
  bufferedBytes: 0,
}

/**
 * Camera-to-MP4 scenario. Captures a user-granted `MediaStream` via
 * `getUserMedia`, runs the frames through WebCodecs `VideoEncoder` (AVC) and
 * `AudioEncoder` (AAC-LC), and muxes the encoded chunks into an in-memory MP4
 * via {@link Mp4Muxer} wired to {@link ArrayBufferTarget}. On stop the finalized
 * bytes are offered as a download and as a playback preview.
 *
 * The scenario relies on {@link MediaStreamTrackProcessor} to pull `VideoFrame`
 * and `AudioData` off the live tracks. Browsers that do not ship the Processor
 * API render an error state up front. Supporting a fallback is out of scope for
 * Task 2; the later ScreenRecorder scenario revisits browser coverage.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 * @see {@link https://w3c.github.io/mediacapture-transform/ | MediaStreamTrack Insertable Streams}
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function CameraRecorder() {
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [telemetry, setTelemetry] = useState<RecordingTelemetry>(INITIAL_TELEMETRY)
  const [playbackObjectUrl, setPlaybackObjectUrl] = useState<string | null>(null)
  const [savedBytes, setSavedBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const [recordingMediaStream, setRecordingMediaStream] = useState<MediaStream | null>(null)

  const livePreviewElementRef = useRef<HTMLVideoElement | null>(null)
  const sessionRef = useRef<RecordingSessionState | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const animationFrameRef = useRef<number | null>(null)
  const lastTelemetryFlushRef = useRef<number>(0)

  /*
   * Schedules a throttled UI refresh pulling the latest counters from the
   * mutable session state. Running at ~10 Hz keeps React from re-rendering on
   * every encoded chunk, which on a 5 Mbps stream arrives 30 times per second.
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
        audioSampleCount: session.audioSampleCount,
        bufferedBytes: session.bufferedBytes,
      })
      scheduleTelemetryRefresh()
    })
  }, [])

  /*
   * Teardown every resource held by the session. Safe to call in any phase. The
   * individual close paths are each guarded for idempotency.
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
    if (session.audioReader !== null) {
      try {
        await session.audioReader.cancel()
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
    if (session.audioPipeline !== null) {
      try {
        await session.audioPipeline.close()
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
   * Drives the `getUserMedia` handshake, encoder construction, muxer start, and
   * frame-loop launch. Any thrown error routes into the `error` phase so the UI
   * can surface a single actionable message.
   */
  const beginRecordingSession = useCallback(async (): Promise<void> => {
    setPhase('preparing')
    setErrorMessage('')
    setTelemetry(INITIAL_TELEMETRY)

    if (typeof MediaStreamTrackProcessor === 'undefined') {
      setErrorMessage(
        'This browser does not expose MediaStreamTrackProcessor. Use Chrome 94 or newer to run the CameraRecorder scenario.'
      )
      setPhase('error')
      return
    }

    const session: RecordingSessionState = {
      muxer: null,
      target: null,
      videoPipeline: null,
      audioPipeline: null,
      mediaStream: null,
      videoReader: null,
      audioReader: null,
      earlyVideoChunks: [],
      earlyAudioChunks: [],
      pendingVideoChunk: null,
      pendingAudioChunk: null,
      frameCounter: 0,
      videoSampleCount: 0,
      audioSampleCount: 0,
      bufferedBytes: 0,
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
        audio: true,
      })
      session.mediaStream = mediaStream

      const videoTrack = mediaStream.getVideoTracks()[0]
      const audioTrack = mediaStream.getAudioTracks()[0]
      if (videoTrack === undefined || audioTrack === undefined) {
        throw new Error('The granted media stream is missing a video or audio track.')
      }

      const videoSettings = videoTrack.getSettings()
      const actualWidth = videoSettings.width ?? TARGET_VIDEO_WIDTH
      const actualHeight = videoSettings.height ?? TARGET_VIDEO_HEIGHT
      const actualFramerate = videoSettings.frameRate ?? TARGET_VIDEO_FRAMERATE

      const target = new ArrayBufferTarget()
      session.target = target

      const videoPipeline = createVideoEncoderPipeline({
        codec: 'avc1.42001f',
        width: actualWidth,
        height: actualHeight,
        framerate: actualFramerate,
        bitrate: TARGET_VIDEO_BITRATE,
        /*
         * Chrome defaults AVC output to AnnexB. mp4craft expects length-prefixed
         * NAL units so the bytes can flow into sample storage without a size-
         * prefix rewrite. VP9 and other codecs omit this field.
         */
        extraConfigureOptions: { avc: { format: 'avc' } },
        onChunk: (chunk, metadata) => {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          /*
           * `EncodedVideoChunk.duration` is undefined for frames pulled off a
           * `MediaStreamTrack`, so the scenario computes per-sample durations
           * from timestamp deltas. Pending-slot carries the predecessor until
           * its successor arrives. Early arrivals queue until the muxer
           * exists.
           */
          activeSession.videoSampleCount += 1
          activeSession.bufferedBytes += chunk.byteLength
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

      const audioPipeline = createAudioEncoderPipeline({
        codec: 'mp4a.40.2',
        numberOfChannels: TARGET_AUDIO_CHANNELS,
        sampleRate: TARGET_AUDIO_SAMPLE_RATE,
        bitrate: TARGET_AUDIO_BITRATE,
        onChunk: (chunk, metadata) => {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          /*
           * Same reasoning as the video pipeline. AAC chunks from
           * WebCodecs typically carry `duration === undefined`, so the
           * pending-slot pattern synthesizes durations from timestamp
           * deltas.
           */
          activeSession.audioSampleCount += 1
          activeSession.bufferedBytes += chunk.byteLength
          const incomingEntry: AudioChunkEntry = { chunk, metadata }
          if (activeSession.muxer === null) {
            activeSession.earlyAudioChunks.push(incomingEntry)
            return
          }
          if (activeSession.pendingAudioChunk !== null) {
            emitAudioChunkToMuxer(activeSession.muxer, activeSession.pendingAudioChunk, chunk.timestamp)
          }
          activeSession.pendingAudioChunk = incomingEntry
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
      session.audioPipeline = audioPipeline

      /*
       * The muxer needs both decoder configuration records at construction
       * time. Each pipeline publishes its first description from the encoder
       * output callback, so both encoders must have produced at least one
       * chunk before `Promise.all([firstDescription, firstDescription])` can
       * resolve. A single audio `AudioData` buffer from
       * `MediaStreamTrackProcessor` is typically ~10-20ms while an AAC frame
       * holds 1024 samples (~21ms at 48 kHz), and the encoder often buffers
       * one to two input buffers before emitting its first chunk. The video
       * and audio read loops therefore start running in parallel below and
       * keep feeding the encoders until `firstDescription` resolves naturally.
       */
      const videoProcessor = new MediaStreamTrackProcessor<VideoFrame>({
        track: videoTrack,
      })
      const audioProcessor = new MediaStreamTrackProcessor<AudioData>({
        track: audioTrack,
      })
      const videoReader = videoProcessor.readable.getReader()
      const audioReader = audioProcessor.readable.getReader()
      session.videoReader = videoReader
      session.audioReader = audioReader

      /*
       * Video frame loop. Inserts a keyframe every KEYFRAME_INTERVAL_FRAMES
       * frames so the output file seeks cleanly. Starts immediately so the
       * encoder has frames to chew on while the scenario awaits the decoder
       * configuration records.
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
           * description record arrives immediately. Subsequent keyframes
           * follow the configured cadence.
           */
          const shouldInsertKeyframe = isFirstFrame || activeSession.frameCounter % KEYFRAME_INTERVAL_FRAMES === 0
          videoPipeline.encoder.encode(nextFrameResult.value, {
            keyFrame: shouldInsertKeyframe,
          })
          nextFrameResult.value.close()
          isFirstFrame = false
        }
      }

      const audioLoop = async (): Promise<void> => {
        while (true) {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          const nextAudioResult = await audioReader.read()
          if (nextAudioResult.done || nextAudioResult.value === undefined) {
            return
          }
          audioPipeline.encoder.encode(nextAudioResult.value)
          nextAudioResult.value.close()
        }
      }

      /*
       * Launch both loops before awaiting the description promises. The
       * encoder output callbacks park any chunks they emit in
       * `earlyVideoChunks` / `earlyAudioChunks` until the muxer exists. This
       * is the load-bearing change for the audio deadlock: the AAC encoder
       * only emits its first chunk after several input buffers accumulate,
       * which cannot happen if the scenario awaits on a single primed buffer.
       */
      void videoLoop()
      void audioLoop()

      /*
       * Guard against the encoder never emitting a decoder configuration. In
       * the wild this can happen when the configured codec profile does not
       * match the actual track resolution (for example AVC Baseline 3.1 on a
       * 1080p camera on some hardware encoders). The race with a timeout lets
       * the scenario surface an actionable message rather than hang forever
       * at "preparing".
       */
      const DESCRIPTION_TIMEOUT_MS = 8000
      const waitForDescriptionsWithTimeout = async (): Promise<{
        videoDescription: ArrayBuffer | ArrayBufferView
        audioDescription: ArrayBuffer | ArrayBufferView
      }> => {
        const videoDescriptionPromise = videoPipeline.firstDescription.then((description) => ({
          kind: 'video' as const,
          description,
        }))
        const audioDescriptionPromise = audioPipeline.firstDescription.then((description) => ({
          kind: 'audio' as const,
          description,
        }))
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Timed out waiting for encoder decoder configurations after ${DESCRIPTION_TIMEOUT_MS}ms. Check the browser DevTools console for encoder errors and confirm the camera resolution matches the configured AVC profile.`
              )
            )
          }, DESCRIPTION_TIMEOUT_MS)
        })
        const [videoResolved, audioResolved] = await Promise.all([
          Promise.race([videoDescriptionPromise, timeoutPromise]),
          Promise.race([audioDescriptionPromise, timeoutPromise]),
        ])
        return {
          videoDescription: videoResolved.description,
          audioDescription: audioResolved.description,
        }
      }
      const { videoDescription, audioDescription } = await waitForDescriptionsWithTimeout()

      const muxer = new Mp4Muxer<ArrayBufferTarget>({
        target,
        fastStart: 'in-memory',
        video: {
          codec: 'avc',
          width: actualWidth,
          height: actualHeight,
          description: videoDescription,
        },
        audio: {
          codec: 'aac',
          description: audioDescription,
          channels: TARGET_AUDIO_CHANNELS,
          sampleRate: TARGET_AUDIO_SAMPLE_RATE,
        },
      })
      session.muxer = muxer

      /*
       * Drain the chunks that arrived from both encoders before the muxer
       * existed. Each drained entry borrows its duration from the timestamp
       * of the chunk that follows it, and the trailing entry in each queue
       * becomes the new `pendingVideoChunk` / `pendingAudioChunk` so the next
       * live arrival computes its duration as usual.
       */
      const bufferedVideoReplayEntries = session.earlyVideoChunks
      session.earlyVideoChunks = []
      for (let videoReplayIndex = 0; videoReplayIndex < bufferedVideoReplayEntries.length; videoReplayIndex += 1) {
        const replayEntry = bufferedVideoReplayEntries[videoReplayIndex]
        if (replayEntry === undefined) {
          continue
        }
        const successorEntry = bufferedVideoReplayEntries[videoReplayIndex + 1]
        if (successorEntry !== undefined) {
          emitVideoChunkToMuxer(muxer, replayEntry, successorEntry.chunk.timestamp)
        } else {
          session.pendingVideoChunk = replayEntry
        }
      }

      const bufferedAudioReplayEntries = session.earlyAudioChunks
      session.earlyAudioChunks = []
      for (let audioReplayIndex = 0; audioReplayIndex < bufferedAudioReplayEntries.length; audioReplayIndex += 1) {
        const replayEntry = bufferedAudioReplayEntries[audioReplayIndex]
        if (replayEntry === undefined) {
          continue
        }
        const successorEntry = bufferedAudioReplayEntries[audioReplayIndex + 1]
        if (successorEntry !== undefined) {
          emitAudioChunkToMuxer(muxer, replayEntry, successorEntry.chunk.timestamp)
        } else {
          session.pendingAudioChunk = replayEntry
        }
      }

      /*
       * Expose the live `MediaStream` to the render layer. The `<video>`
       * element only mounts once the phase flips to "recording", so
       * attaching `srcObject` inside this async callback would find
       * `livePreviewElementRef.current === null` and the preview would stay
       * black. A dedicated effect below watches `recordingMediaStream` and
       * binds the stream after React commits the recording-phase layout.
       */
      setRecordingMediaStream(mediaStream)
      session.startTimestampMs = performance.now()
      setPhase('recording')
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
   * Drains the encoders, finalizes the muxer, and captures the resulting bytes
   * plus an object URL for playback. Transitions through `stopping` so the UI
   * can communicate that the save path is running.
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

    /*
     * Cancel the readers before closing the encoders so the loops exit promptly.
     * The encoders each flush remaining samples during close().
     */
    if (session.videoReader !== null) {
      try {
        await session.videoReader.cancel()
      } catch {
        /* Ignored: a cancel on an already-closed reader is not an error. */
      }
    }
    if (session.audioReader !== null) {
      try {
        await session.audioReader.cancel()
      } catch {
        /* Ignored: a cancel on an already-closed reader is not an error. */
      }
    }

    try {
      if (session.videoPipeline !== null) {
        await session.videoPipeline.close()
      }
      if (session.audioPipeline !== null) {
        await session.audioPipeline.close()
      }
      if (session.muxer === null || session.target === null) {
        throw new Error('Muxer was not constructed before stop was requested.')
      }
      /*
       * Flush any chunks still waiting for a successor. Their durations fall
       * back to the per-codec default so both sample tables close cleanly.
       */
      if (session.pendingVideoChunk !== null) {
        emitVideoChunkToMuxer(session.muxer, session.pendingVideoChunk, null)
        session.pendingVideoChunk = null
      }
      if (session.pendingAudioChunk !== null) {
        emitAudioChunkToMuxer(session.muxer, session.pendingAudioChunk, null)
        session.pendingAudioChunk = null
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
      const objectUrl = URL.createObjectURL(playbackBlob)

      if (!isMountedRef.current) {
        URL.revokeObjectURL(objectUrl)
        return
      }

      setSavedBytes(finalizedBytes)
      setPlaybackObjectUrl(objectUrl)
      setTelemetry({
        elapsedMs: performance.now() - session.startTimestampMs,
        videoSampleCount: session.videoSampleCount,
        audioSampleCount: session.audioSampleCount,
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
  }, [releaseSessionResources])

  /*
   * Return the scenario to the `idle` phase, releasing the previous recording's
   * object URL and bytes so a second recording starts from a clean slate.
   */
  const resetSession = useCallback((): void => {
    if (playbackObjectUrl !== null) {
      URL.revokeObjectURL(playbackObjectUrl)
    }
    setPlaybackObjectUrl(null)
    setSavedBytes(null)
    setTelemetry(INITIAL_TELEMETRY)
    setErrorMessage('')
    setRecordingMediaStream(null)
    setPhase('idle')
  }, [playbackObjectUrl])

  const handleSaveClick = useCallback(async (): Promise<void> => {
    if (savedBytes === null) {
      return
    }
    await saveBytesToDisk('camera-recording.mp4', savedBytes)
  }, [savedBytes])

  /*
   * Revoke the playback object URL when the component unmounts or when a new
   * recording replaces the old one. Revocation happens inside `resetSession`
   * for the in-session path. This effect handles the navigate-away path.
   */
  useEffect(() => {
    return () => {
      if (playbackObjectUrl !== null) {
        URL.revokeObjectURL(playbackObjectUrl)
      }
    }
  }, [playbackObjectUrl])

  /*
   * Teardown on unmount. Stops tracks, cancels readers, and closes encoders so a
   * user navigating away mid-recording does not leak the camera light.
   */
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      void releaseSessionResources()
    }
  }, [releaseSessionResources])

  /*
   * Bind the live `MediaStream` to the preview `<video>` element after React
   * commits the recording-phase layout. The element only exists once the
   * phase flips, so assignment has to follow the render. The effect also
   * detaches the stream on reset or unmount so the video element does not
   * retain a reference to a stopped track.
   */
  useEffect(() => {
    const videoElement = livePreviewElementRef.current
    if (videoElement === null || recordingMediaStream === null) {
      return
    }
    videoElement.srcObject = recordingMediaStream
    /*
     * Autoplay in a user-initiated flow is allowed by Chrome, but swallowing
     * the promise rejection defensively keeps the UI alive if a future
     * browser tightens the rule. The video still receives frames because
     * `srcObject` is already bound at that point.
     */
    videoElement.play().catch(() => undefined)
    return () => {
      if (videoElement.srcObject === recordingMediaStream) {
        videoElement.srcObject = null
      }
    }
  }, [recordingMediaStream])

  return (
    <ScenarioFrame
      title="Camera Recorder"
      description="getUserMedia through VideoEncoder and AudioEncoder into an in-memory MP4."
    >
      <div className={cameraRecorderStyles.layout}>
        {renderPhaseContent({
          phase,
          errorMessage,
          telemetry,
          livePreviewElementRef,
          playbackObjectUrl,
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
 * Arguments accepted by {@link renderPhaseContent}. Packaging the render inputs
 * inside a single record keeps the outer component body focused on lifecycle
 * wiring rather than branching UI.
 */
type PhaseRenderInputs = {
  phase: RecordingPhase
  errorMessage: string
  telemetry: RecordingTelemetry
  livePreviewElementRef: React.RefObject<HTMLVideoElement>
  playbackObjectUrl: string | null
  onStart: () => void
  onStop: () => void
  onSave: () => void
  onReset: () => void
  onRetry: () => void
}

/**
 * Renders the correct card layout for the current recording phase. A single
 * dispatch table keeps the phase-to-view mapping centralized so new phases are
 * added in one place.
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
      label: 'Audio samples',
      value: inputs.telemetry.audioSampleCount.toString(),
    },
    {
      label: 'Bytes buffered',
      value: formatBytes(inputs.telemetry.bufferedBytes),
    },
  ]

  const phaseRenderers: Record<RecordingPhase, () => React.ReactElement> = {
    idle: () => (
      <Card radius="medium" shadow="subtle">
        <div className={cameraRecorderStyles.statusCard}>
          <h2 className={cameraRecorderStyles.statusHeading}>Ready when you are</h2>
          <p className={cameraRecorderStyles.statusMessage}>
            The playground asks for camera and microphone access, captures frames with WebCodecs, and muxes an AVC plus
            AAC MP4 entirely in memory. Grant permission in the browser prompt once recording starts.
          </p>
          <div className={cameraRecorderStyles.actionRow}>
            <DarkButton onClick={inputs.onStart}>Start Recording</DarkButton>
          </div>
        </div>
      </Card>
    ),
    preparing: () => (
      <Card radius="medium" shadow="subtle">
        <div className={cameraRecorderStyles.statusCard}>
          <h2 className={cameraRecorderStyles.statusHeading}>Initializing camera and encoders</h2>
          <p className={cameraRecorderStyles.statusMessage}>
            Requesting track access, configuring the AVC and AAC encoders, and priming the muxer. The recording begins
            once both decoder configuration records arrive.
          </p>
        </div>
      </Card>
    ),
    recording: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={cameraRecorderStyles.previewCard}>
            <h2 className={cameraRecorderStyles.previewHeading}>Live preview</h2>
            <video
              ref={inputs.livePreviewElementRef}
              className={cameraRecorderStyles.previewVideo}
              muted
              autoPlay
              playsInline
            />
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={cameraRecorderStyles.statusCard}>
            <h2 className={cameraRecorderStyles.statusHeading}>Telemetry</h2>
            <Stats entries={statsEntries} />
            <div className={cameraRecorderStyles.actionRow}>
              <PillButton variant="nav-active" onClick={inputs.onStop}>
                Stop Recording
              </PillButton>
            </div>
          </div>
        </Card>
      </>
    ),
    stopping: () => (
      <Card radius="medium" shadow="subtle">
        <div className={cameraRecorderStyles.statusCard}>
          <h2 className={cameraRecorderStyles.statusHeading}>Finalizing MP4</h2>
          <p className={cameraRecorderStyles.statusMessage}>
            Flushing encoders, writing the moov atom, and snapshotting the buffer into a playable file.
          </p>
        </div>
      </Card>
    ),
    stopped: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={cameraRecorderStyles.previewCard}>
            <h2 className={cameraRecorderStyles.previewHeading}>Recorded playback</h2>
            {inputs.playbackObjectUrl !== null ? (
              <video
                key={inputs.playbackObjectUrl}
                className={cameraRecorderStyles.previewVideo}
                src={inputs.playbackObjectUrl}
                controls
                playsInline
              />
            ) : null}
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={cameraRecorderStyles.statusCard}>
            <h2 className={cameraRecorderStyles.statusHeading}>Summary</h2>
            <Stats entries={statsEntries} />
            <div className={cameraRecorderStyles.actionRow}>
              <DarkButton onClick={inputs.onSave}>Save MP4</DarkButton>
              <PillButton variant="nav" onClick={inputs.onReset}>
                Record Again
              </PillButton>
            </div>
            <p className={cameraRecorderStyles.helperText}>
              The save dialog uses the File System Access API when available and falls back to a Blob download in other
              browsers.
            </p>
          </div>
        </Card>
      </>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={cameraRecorderStyles.statusCard}>
          <h2 className={cameraRecorderStyles.statusHeading}>Recording failed</h2>
          <p className={cameraRecorderStyles.errorMessage}>
            {inputs.errorMessage !== ''
              ? inputs.errorMessage
              : 'An unknown error occurred while setting up the recording.'}
          </p>
          <div className={cameraRecorderStyles.actionRow}>
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

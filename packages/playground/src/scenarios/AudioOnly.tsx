import { Card } from '@/components/Card'
import { DarkButton } from '@/components/DarkButton'
import { PillButton } from '@/components/PillButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { saveBytesToDisk } from '@/lib/download'
import { createAudioEncoderPipeline } from '@/lib/encoders'
import type { AudioEncoderPipelineHandle } from '@/lib/encoders'
import audioOnlyStyles from '@/scenarios/AudioOnly.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phases of the audio-only recording session. The UI renders a different
 * layout per phase and only the legal transitions are reachable from each.
 */
type RecordingPhase = 'idle' | 'preparing' | 'recording' | 'stopping' | 'stopped' | 'error'

/**
 * WebCodecs Opus codec string. Opus is self-describing on the wire but the
 * muxer still needs the OpusSpecificBox payload surfaced via
 * `AudioDecoderConfig.description` on the first encoded chunk. See the
 * Opus-in-ISOBMFF spec §4.3.2 for the `dOps` layout.
 */
const AUDIO_CODEC_STRING = 'opus'

/** Byte length of the `OpusHead` magic prefix that opens an Ogg Identification Header. */
const OPUS_HEAD_MAGIC_LENGTH = 8

/** Byte length of the fixed `OpusHead` body (magic plus version through ChannelMappingFamily). */
const OPUS_HEAD_FIXED_LENGTH = 19

/** Byte length of the fixed `dOps` OpusSpecificBox body (without optional channel mapping). */
const OPUS_SPECIFIC_BOX_FIXED_LENGTH = 11

/**
 * Converts an Ogg `OpusHead` Identification Header (RFC 7845 §5.1) into the
 * `dOps` OpusSpecificBox payload required by Opus-in-ISOBMFF §4.3.2. Chrome's
 * WebCodecs `AudioEncoder` surfaces the decoder configuration as an OpusHead
 * buffer (8-byte `OpusHead` magic, little-endian multi-byte fields, version 1)
 * because that is the Ogg-native representation. The MP4 muxer expects the
 * OpusSpecificBox body instead, which drops the magic, uses big-endian for the
 * multi-byte fields, and mandates version 0. The byte-swap layout is:
 *
 * - OpusHead bytes 0 to 7: `"OpusHead"` magic (dropped from the output).
 * - OpusHead byte 8: version (discarded; `dOps` version is always 0).
 * - OpusHead byte 9: OutputChannelCount (passed through).
 * - OpusHead bytes 10 to 11 (little-endian u16): PreSkip (re-emitted big-endian).
 * - OpusHead bytes 12 to 15 (little-endian u32): InputSampleRate (re-emitted big-endian).
 * - OpusHead bytes 16 to 17 (little-endian i16): OutputGain (re-emitted big-endian).
 * - OpusHead byte 18: ChannelMappingFamily (passed through).
 * - OpusHead bytes 19 onwards: ChannelMappingTable when ChannelMappingFamily is non-zero
 *   (copied verbatim, matching layout between the two container formats).
 *
 * @param opusHeadBytes - Bytes emitted by Chrome's Opus `VideoDecoderConfig.description`.
 * @returns The 11+ byte `dOps` payload suitable for {@link OpusAudioTrackConfig.description}.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7845#section-5.1 | RFC 7845 §5.1 OpusHead}
 * @see {@link https://opus-codec.org/docs/opus_in_isobmff.html | Opus-in-ISOBMFF §4.3.2}
 */
function convertOpusHeadToOpusSpecificBoxPayload(opusHeadBytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (opusHeadBytes.byteLength < OPUS_HEAD_FIXED_LENGTH) {
    throw new Error(
      `OpusHead Identification Header is too short: expected at least ${OPUS_HEAD_FIXED_LENGTH} bytes, received ${opusHeadBytes.byteLength}.`
    )
  }
  const opusHeadMagic = String.fromCharCode(...opusHeadBytes.subarray(0, OPUS_HEAD_MAGIC_LENGTH))
  if (opusHeadMagic !== 'OpusHead') {
    throw new Error(`Expected OpusHead Identification Header magic, received '${opusHeadMagic}'.`)
  }
  const opusHeadView = new DataView(opusHeadBytes.buffer, opusHeadBytes.byteOffset, opusHeadBytes.byteLength)
  const outputChannelCount = opusHeadBytes[9] ?? 0
  const preSkipSamples = opusHeadView.getUint16(10, true)
  const inputSampleRate = opusHeadView.getUint32(12, true)
  const outputGainQ78 = opusHeadView.getInt16(16, true)
  const channelMappingFamily = opusHeadBytes[18] ?? 0
  const channelMappingTableLength = channelMappingFamily === 0 ? 0 : opusHeadBytes.byteLength - OPUS_HEAD_FIXED_LENGTH
  const payloadBytes = new Uint8Array(new ArrayBuffer(OPUS_SPECIFIC_BOX_FIXED_LENGTH + channelMappingTableLength))
  const payloadView = new DataView(payloadBytes.buffer)
  payloadBytes[0] = 0
  payloadBytes[1] = outputChannelCount
  payloadView.setUint16(2, preSkipSamples, false)
  payloadView.setUint32(4, inputSampleRate, false)
  payloadView.setInt16(8, outputGainQ78, false)
  payloadBytes[10] = channelMappingFamily
  if (channelMappingFamily !== 0) {
    payloadBytes.set(opusHeadBytes.subarray(OPUS_HEAD_FIXED_LENGTH), OPUS_SPECIFIC_BOX_FIXED_LENGTH)
  }
  return payloadBytes
}

/**
 * Normalizes a WebCodecs `AudioDecoderConfig.description` buffer to a plain
 * `Uint8Array` view so the OpusHead-to-dOps converter can inspect the bytes
 * without assuming the input is already a `Uint8Array`.
 *
 * @param description - `ArrayBuffer` or `ArrayBufferView` as produced by WebCodecs.
 * @returns A `Uint8Array` view over the same bytes without copying.
 */
function viewDescriptionAsBytes(description: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (description instanceof ArrayBuffer) {
    return new Uint8Array(description)
  }
  return new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
}

/** Opus natively operates at 48 kHz and the scenario mirrors that. */
const TARGET_AUDIO_SAMPLE_RATE = 48_000

/** Mono capture keeps the waveform preview and the encoded output straightforward. */
const TARGET_AUDIO_CHANNELS = 1

/**
 * Encoded audio bitrate. Opus remains crisp on speech down to roughly 32 kbps;
 * 96 kbps gives comfortable headroom for ambient capture without inflating the
 * recorded file.
 */
const TARGET_AUDIO_BITRATE = 96_000

/** UI telemetry refresh cadence in milliseconds. */
const UI_REFRESH_INTERVAL_MS = 100

/**
 * Opus emits frames of 960 samples at 48 kHz (a 20 ms packet). The trailing
 * chunk has no successor timestamp, so its sample duration defaults to one
 * 20 ms frame. Expressed in microseconds for direct use in the muxer API.
 */
const DEFAULT_OPUS_FRAME_DURATION_US = Math.round((960 * 1_000_000) / TARGET_AUDIO_SAMPLE_RATE)

/**
 * Width of the on-screen waveform canvas in CSS pixels. The canvas bitmap
 * grows with the container via CSS; the bitmap-space coordinates used by the
 * drawing code stay fixed so the number of rendered bars stays constant.
 */
const WAVEFORM_CANVAS_WIDTH = 960

/** Height of the on-screen waveform canvas in CSS pixels. */
const WAVEFORM_CANVAS_HEIGHT = 540

/**
 * Number of time-domain bars the waveform renderer draws per frame. Chosen to
 * balance visual density against the `AnalyserNode.fftSize` window below.
 */
const WAVEFORM_BAR_COUNT = 64

/**
 * FFT size of the `AnalyserNode` behind the waveform preview. 1024 samples at
 * 48 kHz spans roughly 21 ms of audio per render frame, which matches the
 * requestAnimationFrame cadence on a 60 Hz display without visible aliasing.
 *
 * @see {@link https://webaudio.github.io/web-audio-api/#AnalyserNode | Web Audio API AnalyserNode}
 */
const WAVEFORM_FFT_SIZE = 1024

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
 * Formats an elapsed millisecond count as `m:ss`. Minutes grow without bound
 * so long recordings still render cleanly.
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
 * Encoded audio chunk plus the metadata that arrived with it. Held in the
 * pending slot until the next chunk arrives so the sample duration can be
 * derived from the delta between the two timestamps.
 */
type AudioChunkEntry = {
  chunk: EncodedAudioChunk
  metadata: EncodedAudioChunkMetadata | undefined
}

/**
 * Emits an audio chunk into the muxer with an explicit duration computed from
 * the supplied next-chunk timestamp. When no successor is available (the
 * trailing flushed chunk), the Opus 20 ms frame default applies so the sample
 * table still reports a non-zero length.
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
      : DEFAULT_OPUS_FRAME_DURATION_US
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
 * Renders one frame of the waveform preview by sampling the supplied
 * time-domain buffer. Draws bar-shaped vertical slices so the preview reads
 * well even with a small sample count, and stays visible during silence by
 * rendering a flat baseline on a dark surface.
 *
 * @param drawingContext - Target 2D rendering context for the waveform canvas.
 * @param timeDomainSamples - Unsigned-byte buffer populated by
 *   `AnalyserNode.getByteTimeDomainData`. Values are centred on 128 with the
 *   wave excursion encoded in the full 0..255 range.
 */
function drawWaveformFrame(drawingContext: CanvasRenderingContext2D, timeDomainSamples: Uint8Array): void {
  drawingContext.fillStyle = '#181e25'
  drawingContext.fillRect(0, 0, WAVEFORM_CANVAS_WIDTH, WAVEFORM_CANVAS_HEIGHT)

  const barWidth = WAVEFORM_CANVAS_WIDTH / WAVEFORM_BAR_COUNT
  const samplesPerBar = Math.max(1, Math.floor(timeDomainSamples.length / WAVEFORM_BAR_COUNT))

  drawingContext.fillStyle = '#60a5fa'
  for (let barIndex = 0; barIndex < WAVEFORM_BAR_COUNT; barIndex += 1) {
    let peakDeviation = 0
    for (let sampleOffset = 0; sampleOffset < samplesPerBar; sampleOffset += 1) {
      const sampleIndex = barIndex * samplesPerBar + sampleOffset
      const sampleValue = timeDomainSamples[sampleIndex]
      if (sampleValue === undefined) {
        continue
      }
      /*
       * `getByteTimeDomainData` centres silence on 128. The absolute
       * deviation from 128 encodes the instantaneous amplitude, scaled to
       * a 0..1 range by dividing by 128.
       */
      const deviation = Math.abs(sampleValue - 128) / 128
      if (deviation > peakDeviation) {
        peakDeviation = deviation
      }
    }
    const barHeight = Math.max(2, peakDeviation * WAVEFORM_CANVAS_HEIGHT * 0.95)
    const barX = barIndex * barWidth
    const barY = (WAVEFORM_CANVAS_HEIGHT - barHeight) / 2
    drawingContext.fillRect(barX + barWidth * 0.1, barY, barWidth * 0.8, barHeight)
  }
}

/**
 * Mutable state that survives React renders without triggering them. Held
 * inside a single ref so teardown iterates one object instead of chasing
 * several independent fields.
 */
type RecordingSessionState = {
  muxer: Mp4Muxer<ArrayBufferTarget> | null
  target: ArrayBufferTarget | null
  audioPipeline: AudioEncoderPipelineHandle | null
  mediaStream: MediaStream | null
  audioReader: ReadableStreamDefaultReader<AudioData> | null
  audioContext: AudioContext | null
  analyserNode: AnalyserNode | null
  analyserSourceNode: MediaStreamAudioSourceNode | null
  /**
   * Audio chunks that arrived before the muxer was constructed. Drained once
   * the muxer exists, with per-sample durations derived from adjacent
   * timestamps.
   */
  earlyAudioChunks: AudioChunkEntry[]
  /**
   * The most recently observed audio chunk, held until the next chunk
   * arrives so the sample duration can be computed from the delta between
   * timestamps. Flushed during stop with the Opus-frame default.
   */
  pendingAudioChunk: AudioChunkEntry | null
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
  audioSampleCount: number
  bufferedBytes: number
}

const INITIAL_TELEMETRY: RecordingTelemetry = {
  elapsedMs: 0,
  audioSampleCount: 0,
  bufferedBytes: 0,
}

/**
 * Microphone-to-MP4 scenario. Captures a user-granted `MediaStream` via
 * `getUserMedia` with audio only, encodes the `AudioData` buffers with
 * WebCodecs `AudioEncoder` using the Opus codec, and muxes the encoded chunks
 * into an in-memory MP4 via {@link Mp4Muxer} wired to {@link ArrayBufferTarget}.
 * On stop the finalized bytes are offered as a download and as a playback
 * preview.
 *
 * The scenario also drives a live waveform preview through a Web Audio
 * `AnalyserNode` tapping the same microphone stream. The canvas renders a
 * silence-centred baseline in the idle phase and live time-domain bars in the
 * recording phase, per the Task 4 spec that calls the waveform out as the
 * scenario's visual centrepiece.
 *
 * Recording runs until the user clicks Stop; there is no fixed duration. The
 * trailing chunk's duration falls back to one Opus 20 ms frame
 * (`960 * 1_000_000 / sampleRate` microseconds) because the pending-chunk
 * pattern has no successor timestamp to subtract from.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification}
 * @see {@link https://w3c.github.io/mediacapture-transform/ | MediaStreamTrack Insertable Streams}
 * @see {@link https://opus-codec.org/docs/opus_in_isobmff.html | Opus in ISOBMFF (OpusSpecificBox §4.3.2)}
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function AudioOnly() {
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [telemetry, setTelemetry] = useState<RecordingTelemetry>(INITIAL_TELEMETRY)
  const [playbackObjectUrl, setPlaybackObjectUrl] = useState<string | null>(null)
  const [savedBytes, setSavedBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sessionRef = useRef<RecordingSessionState | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const animationFrameRef = useRef<number | null>(null)
  const lastTelemetryFlushRef = useRef<number>(0)
  const waveformAnimationFrameRef = useRef<number | null>(null)
  const idlePreviewAnimationFrameRef = useRef<number | null>(null)

  /*
   * Idle-phase preview loop. While `phase === "idle"` the effect paints a
   * silence-centred baseline on the waveform canvas so the hero preview card
   * is not empty before recording begins. The effect returns early for every
   * other phase. The `stopped` phase replaces the waveform card with a
   * playback card, so the baseline is intentionally not repainted there.
   */
  useEffect(() => {
    if (phase !== 'idle') {
      return
    }
    const canvasElement = waveformCanvasRef.current
    if (canvasElement === null) {
      return
    }
    const drawingContext = canvasElement.getContext('2d')
    if (drawingContext === null) {
      return
    }

    const silenceBuffer = new Uint8Array(WAVEFORM_FFT_SIZE)
    silenceBuffer.fill(128)

    const renderIdleFrame = (): void => {
      drawWaveformFrame(drawingContext, silenceBuffer)
      idlePreviewAnimationFrameRef.current = requestAnimationFrame(renderIdleFrame)
    }
    idlePreviewAnimationFrameRef.current = requestAnimationFrame(renderIdleFrame)

    return () => {
      if (idlePreviewAnimationFrameRef.current !== null) {
        cancelAnimationFrame(idlePreviewAnimationFrameRef.current)
        idlePreviewAnimationFrameRef.current = null
      }
    }
  }, [phase])

  /*
   * Schedules a throttled UI refresh pulling the latest counters from the
   * mutable session state. Running at ~10 Hz keeps React from re-rendering
   * on every encoded chunk.
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
        audioSampleCount: session.audioSampleCount,
        bufferedBytes: session.bufferedBytes,
      })
      scheduleTelemetryRefresh()
    })
  }, [])

  /*
   * Teardown every resource held by the session. Safe to call in any phase.
   * Individual close paths are each guarded for idempotency so repeated calls
   * from error and unmount paths remain harmless.
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
    if (waveformAnimationFrameRef.current !== null) {
      cancelAnimationFrame(waveformAnimationFrameRef.current)
      waveformAnimationFrameRef.current = null
    }
    if (session.audioReader !== null) {
      try {
        await session.audioReader.cancel()
      } catch {
        /* Reader cancellation errors do not affect teardown correctness. */
      }
    }
    if (session.audioPipeline !== null) {
      try {
        await session.audioPipeline.close()
      } catch {
        /* The encoder may already be closed if finalize ran first. */
      }
    }
    if (session.analyserSourceNode !== null) {
      try {
        session.analyserSourceNode.disconnect()
      } catch {
        /* Already disconnected nodes throw; ignoring keeps teardown idempotent. */
      }
    }
    if (session.audioContext !== null) {
      try {
        await session.audioContext.close()
      } catch {
        /* Closing a closed context throws; ignoring keeps teardown idempotent. */
      }
    }
    if (session.mediaStream !== null) {
      for (const mediaTrack of session.mediaStream.getTracks()) {
        mediaTrack.stop()
      }
    }
  }, [])

  /*
   * Drives the `getUserMedia` handshake, encoder construction, muxer start,
   * analyser wiring, and the sample-loop launch. Any thrown error routes into
   * the `error` phase so the UI can surface a single actionable message.
   */
  const beginRecordingSession = useCallback(async (): Promise<void> => {
    setPhase('preparing')
    setErrorMessage('')
    setTelemetry(INITIAL_TELEMETRY)

    if (typeof MediaStreamTrackProcessor === 'undefined') {
      setErrorMessage(
        'This browser does not expose MediaStreamTrackProcessor. Use Chrome 94 or newer to run the AudioOnly scenario.'
      )
      setPhase('error')
      return
    }

    const session: RecordingSessionState = {
      muxer: null,
      target: null,
      audioPipeline: null,
      mediaStream: null,
      audioReader: null,
      audioContext: null,
      analyserNode: null,
      analyserSourceNode: null,
      earlyAudioChunks: [],
      pendingAudioChunk: null,
      audioSampleCount: 0,
      bufferedBytes: 0,
      startTimestampMs: 0,
    }
    sessionRef.current = session

    /*
     * Stop the idle preview so the recording-phase waveform loop owns the
     * canvas without contention. The effect above cancels too, but the phase
     * state flip lags by one React render so clearing here closes the race.
     */
    if (idlePreviewAnimationFrameRef.current !== null) {
      cancelAnimationFrame(idlePreviewAnimationFrameRef.current)
      idlePreviewAnimationFrameRef.current = null
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: TARGET_AUDIO_CHANNELS },
          sampleRate: { ideal: TARGET_AUDIO_SAMPLE_RATE },
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })
      session.mediaStream = mediaStream

      const audioTrack = mediaStream.getAudioTracks()[0]
      if (audioTrack === undefined) {
        throw new Error('The granted media stream is missing an audio track.')
      }

      const target = new ArrayBufferTarget()
      session.target = target

      const audioPipeline = createAudioEncoderPipeline({
        codec: AUDIO_CODEC_STRING,
        numberOfChannels: TARGET_AUDIO_CHANNELS,
        sampleRate: TARGET_AUDIO_SAMPLE_RATE,
        bitrate: TARGET_AUDIO_BITRATE,
        onChunk: (chunk, metadata) => {
          const activeSession = sessionRef.current
          if (activeSession === null) {
            return
          }
          /*
           * `EncodedAudioChunk.duration` is undefined for samples pulled off
           * a `MediaStreamTrack`, so the scenario computes per-sample
           * durations from timestamp deltas. Pending-slot carries the
           * predecessor until its successor arrives. Early arrivals queue
           * until the muxer exists.
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
       * Build the analyser graph from a clone of the captured track so the
       * encoder path and the preview path never contend for the same track
       * consumer. `MediaStreamTrack.clone()` produces an independent live
       * track that stops when the original track stops, which keeps the
       * teardown story uniform.
       */
      const analyserTrack = audioTrack.clone()
      const analyserStream = new MediaStream([analyserTrack])
      const audioContext = new AudioContext({
        sampleRate: TARGET_AUDIO_SAMPLE_RATE,
      })
      session.audioContext = audioContext
      const analyserSourceNode = audioContext.createMediaStreamSource(analyserStream)
      session.analyserSourceNode = analyserSourceNode
      const analyserNode = audioContext.createAnalyser()
      analyserNode.fftSize = WAVEFORM_FFT_SIZE
      analyserSourceNode.connect(analyserNode)
      session.analyserNode = analyserNode

      const audioProcessor = new MediaStreamTrackProcessor<AudioData>({
        track: audioTrack,
      })
      const audioReader = audioProcessor.readable.getReader()
      session.audioReader = audioReader

      /*
       * Audio sample loop. Runs concurrently with the encoder-description
       * handshake below so the encoder has samples to digest while the
       * scenario awaits the OpusSpecificBox payload.
       */
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
      void audioLoop()

      /*
       * Guard against the encoder never emitting a decoder configuration.
       * A race with a timeout lets the scenario surface an actionable
       * message rather than hang forever at "preparing".
       */
      const DESCRIPTION_TIMEOUT_MS = 8000
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for the Opus decoder configuration after ${DESCRIPTION_TIMEOUT_MS}ms. Check the browser DevTools console for encoder errors.`
            )
          )
        }, DESCRIPTION_TIMEOUT_MS)
      })
      const audioDescription = await Promise.race([audioPipeline.firstDescription, timeoutPromise])
      /*
       * Chrome's WebCodecs `AudioEncoder` surfaces the Opus decoder
       * configuration as an Ogg `OpusHead` Identification Header, not as
       * the MP4 `dOps` OpusSpecificBox body. Passing the OpusHead bytes
       * directly into the muxer would yield an .mp4 whose `dOps` payload
       * begins with the ASCII magic `OpusHead` and stores the sample rate
       * in little-endian order, which QuickTime and other strict demuxers
       * reject as malformed. The conversion below rewrites the payload
       * into the big-endian, magic-free `dOps` layout per
       * Opus-in-ISOBMFF §4.3.2 so the produced MP4 plays across browsers
       * and desktop players alike.
       */
      const opusSpecificBoxPayload = convertOpusHeadToOpusSpecificBoxPayload(viewDescriptionAsBytes(audioDescription))

      const muxer = new Mp4Muxer<ArrayBufferTarget>({
        target,
        fastStart: 'in-memory',
        audio: {
          codec: 'opus',
          description: opusSpecificBoxPayload,
          channels: TARGET_AUDIO_CHANNELS,
          sampleRate: TARGET_AUDIO_SAMPLE_RATE,
        },
      })
      session.muxer = muxer

      /*
       * Drain the chunks that arrived from the encoder before the muxer
       * existed. Each drained entry borrows its duration from the timestamp
       * of the chunk that follows it, and the trailing entry becomes the
       * new `pendingAudioChunk` so the next live arrival computes its
       * duration as usual.
       */
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
       * Waveform render loop. Pulls a fresh time-domain buffer from the
       * analyser on each animation frame and repaints the canvas bars. The
       * loop exits when the session is cleared or when the canvas element
       * disappears from the DOM.
       */
      const canvasElement = waveformCanvasRef.current
      const drawingContext = canvasElement !== null ? canvasElement.getContext('2d') : null
      if (canvasElement !== null && drawingContext !== null) {
        const timeDomainSamples = new Uint8Array(analyserNode.fftSize)
        const renderWaveformFrame = (): void => {
          const activeSession = sessionRef.current
          if (activeSession === null || activeSession.analyserNode === null) {
            return
          }
          activeSession.analyserNode.getByteTimeDomainData(timeDomainSamples)
          drawWaveformFrame(drawingContext, timeDomainSamples)
          waveformAnimationFrameRef.current = requestAnimationFrame(renderWaveformFrame)
        }
        waveformAnimationFrameRef.current = requestAnimationFrame(renderWaveformFrame)
      }

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
   * Drains the encoder, finalizes the muxer, and captures the resulting
   * bytes plus an object URL for playback. Transitions through `stopping`
   * so the UI can communicate that the save path is running.
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
    if (waveformAnimationFrameRef.current !== null) {
      cancelAnimationFrame(waveformAnimationFrameRef.current)
      waveformAnimationFrameRef.current = null
    }

    if (session.audioReader !== null) {
      try {
        await session.audioReader.cancel()
      } catch {
        /* Ignored: a cancel on an already-closed reader is not an error. */
      }
    }

    try {
      if (session.audioPipeline !== null) {
        await session.audioPipeline.close()
      }
      if (session.muxer === null || session.target === null) {
        throw new Error('Muxer was not constructed before stop was requested.')
      }
      /*
       * Flush the last chunk waiting for a successor. Its duration falls
       * back to the Opus-frame default so the sample table still reads as
       * a real frame-length entry in the stts table.
       */
      if (session.pendingAudioChunk !== null) {
        emitAudioChunkToMuxer(session.muxer, session.pendingAudioChunk, null)
        session.pendingAudioChunk = null
      }
      await session.muxer.finalize()

      if (session.analyserSourceNode !== null) {
        try {
          session.analyserSourceNode.disconnect()
        } catch {
          /* Already disconnected nodes throw; ignoring keeps teardown idempotent. */
        }
      }
      if (session.audioContext !== null) {
        try {
          await session.audioContext.close()
        } catch {
          /* Closing a closed context throws; ignoring keeps teardown idempotent. */
        }
      }
      if (session.mediaStream !== null) {
        for (const mediaTrack of session.mediaStream.getTracks()) {
          mediaTrack.stop()
        }
        session.mediaStream = null
      }

      const finalizedBytes = new Uint8Array(session.target.buffer)
      const playbackBlob = new Blob([finalizedBytes], { type: 'audio/mp4' })
      const objectUrl = URL.createObjectURL(playbackBlob)

      if (!isMountedRef.current) {
        URL.revokeObjectURL(objectUrl)
        sessionRef.current = null
        return
      }

      setSavedBytes(finalizedBytes)
      setPlaybackObjectUrl(objectUrl)
      setTelemetry({
        elapsedMs: performance.now() - session.startTimestampMs,
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
   * Return the scenario to the `idle` phase, releasing the previous
   * recording's object URL and bytes so a second recording starts from a
   * clean slate.
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
    await saveBytesToDisk('audio-only.mp4', savedBytes, 'audio/mp4')
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
   * Teardown on unmount so a user navigating away mid-recording does not
   * leave capture resources or encoders dangling.
   */
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      void releaseSessionResources()
    }
  }, [releaseSessionResources])

  return (
    <ScenarioFrame title="Audio Only" description="Microphone capture encoded with Opus into an audio-only MP4.">
      <div className={audioOnlyStyles.layout}>
        {renderPhaseContent({
          phase,
          errorMessage,
          telemetry,
          waveformCanvasRef,
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
 * Arguments accepted by {@link renderPhaseContent}. Packaging the render
 * inputs inside a single record keeps the outer component body focused on
 * lifecycle wiring rather than branching UI.
 */
type PhaseRenderInputs = {
  phase: RecordingPhase
  errorMessage: string
  telemetry: RecordingTelemetry
  waveformCanvasRef: React.RefObject<HTMLCanvasElement>
  playbackObjectUrl: string | null
  onStart: () => void
  onStop: () => void
  onSave: () => void
  onReset: () => void
  onRetry: () => void
}

/**
 * Renders the correct card layout for the current recording phase. A single
 * dispatch table keeps the phase-to-view mapping centralized so new phases
 * are added in one place.
 *
 * @param inputs - Current phase plus the telemetry and callbacks required to
 *   render and drive it.
 * @returns The JSX for the active phase.
 */
function renderPhaseContent(inputs: PhaseRenderInputs) {
  const statsEntries: readonly StatsEntry[] = [
    { label: 'Elapsed', value: formatElapsed(inputs.telemetry.elapsedMs) },
    {
      label: 'Audio samples',
      value: inputs.telemetry.audioSampleCount.toString(),
    },
    {
      label: 'Bytes buffered',
      value: formatBytes(inputs.telemetry.bufferedBytes),
    },
  ]

  const liveWaveformPreview = (
    <Card radius="medium" shadow="glow">
      <div className={audioOnlyStyles.previewCard}>
        <h2 className={audioOnlyStyles.previewHeading}>Live waveform</h2>
        <canvas
          ref={inputs.waveformCanvasRef}
          className={audioOnlyStyles.previewCanvas}
          width={WAVEFORM_CANVAS_WIDTH}
          height={WAVEFORM_CANVAS_HEIGHT}
        />
      </div>
    </Card>
  )

  const phaseRenderers: Record<RecordingPhase, () => React.ReactElement> = {
    idle: () => (
      <>
        {liveWaveformPreview}
        <Card radius="medium" shadow="subtle">
          <div className={audioOnlyStyles.statusCard}>
            <h2 className={audioOnlyStyles.statusHeading}>Ready when you are</h2>
            <p className={audioOnlyStyles.statusMessage}>
              The scenario asks for microphone access, encodes the capture with Opus, and muxes an audio-only MP4
              entirely in memory. Recording continues until you click Stop.
            </p>
            <div className={audioOnlyStyles.actionRow}>
              <DarkButton onClick={inputs.onStart}>Start Recording</DarkButton>
            </div>
          </div>
        </Card>
      </>
    ),
    preparing: () => (
      <>
        {liveWaveformPreview}
        <Card radius="medium" shadow="subtle">
          <div className={audioOnlyStyles.statusCard}>
            <h2 className={audioOnlyStyles.statusHeading}>Initializing microphone and encoder</h2>
            <p className={audioOnlyStyles.statusMessage}>
              Requesting microphone access, configuring the Opus encoder, and priming the muxer. The recording begins
              once the OpusSpecificBox payload arrives on the first encoded chunk.
            </p>
          </div>
        </Card>
      </>
    ),
    recording: () => (
      <>
        {liveWaveformPreview}
        <Card radius="medium" shadow="subtle">
          <div className={audioOnlyStyles.statusCard}>
            <h2 className={audioOnlyStyles.statusHeading}>Telemetry</h2>
            <Stats entries={statsEntries} />
            <div className={audioOnlyStyles.actionRow}>
              <PillButton variant="nav-active" onClick={inputs.onStop}>
                Stop Recording
              </PillButton>
            </div>
            <p className={audioOnlyStyles.helperText}>
              The waveform above mirrors the live microphone via an AnalyserNode. Encoded Opus chunks arrive every 20 ms
              and flow into the in-memory muxer.
            </p>
          </div>
        </Card>
      </>
    ),
    stopping: () => (
      <Card radius="medium" shadow="subtle">
        <div className={audioOnlyStyles.statusCard}>
          <h2 className={audioOnlyStyles.statusHeading}>Finalizing MP4</h2>
          <p className={audioOnlyStyles.statusMessage}>
            Flushing the encoder, writing the moov atom, and snapshotting the buffer into a playable file.
          </p>
        </div>
      </Card>
    ),
    stopped: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={audioOnlyStyles.previewCard}>
            <h2 className={audioOnlyStyles.previewHeading}>Recorded playback</h2>
            {inputs.playbackObjectUrl !== null ? (
              <audio
                key={inputs.playbackObjectUrl}
                className={audioOnlyStyles.playbackAudio}
                src={inputs.playbackObjectUrl}
                controls
              />
            ) : null}
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={audioOnlyStyles.statusCard}>
            <h2 className={audioOnlyStyles.statusHeading}>Summary</h2>
            <Stats entries={statsEntries} />
            <div className={audioOnlyStyles.actionRow}>
              <DarkButton onClick={inputs.onSave}>Save MP4</DarkButton>
              <PillButton variant="nav" onClick={inputs.onReset}>
                Record Again
              </PillButton>
            </div>
            <p className={audioOnlyStyles.helperText}>
              The save dialog uses the File System Access API when available and falls back to a Blob download in other
              browsers.
            </p>
          </div>
        </Card>
      </>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={audioOnlyStyles.statusCard}>
          <h2 className={audioOnlyStyles.statusHeading}>Recording failed</h2>
          <p className={audioOnlyStyles.errorMessage}>
            {inputs.errorMessage !== ''
              ? inputs.errorMessage
              : 'An unknown error occurred while setting up the recording.'}
          </p>
          <div className={audioOnlyStyles.actionRow}>
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

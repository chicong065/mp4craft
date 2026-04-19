import { Card } from '@/components/Card'
import { CodecSelector } from '@/components/CodecSelector'
import { DarkButton } from '@/components/DarkButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { buildSyntheticAudioTrackConfig, buildSyntheticVideoTrackConfig } from '@/lib/synthetic-codec-config'
import type { SyntheticAudioCodec, SyntheticFastStart, SyntheticVideoCodec } from '@/lib/synthetic-codec-config'
import stressTestStyles from '@/scenarios/StressTest.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import { useCallback, useState } from 'react'

/**
 * Video codec options exposed in the stress-test codec selector. Mirrors every
 * codec accepted by the {@link VideoTrackConfig} discriminated union so the
 * benchmark exercises each decoder configuration record layout supported by
 * mp4craft. The byte constants and track-config builders live in
 * `@/lib/synthetic-codec-config` so this scenario and the CodecMatrix sweep
 * share a single source of truth.
 *
 * @see ISO/IEC 14496-15 §5.3.3 for AVCDecoderConfigurationRecord.
 * @see ISO/IEC 14496-15 §8.3.3 for HEVCDecoderConfigurationRecord.
 */
const VIDEO_CODEC_OPTIONS = ['avc', 'hevc', 'vp9', 'av1'] as const satisfies readonly SyntheticVideoCodec[]

/**
 * Audio codec options exposed in the stress-test codec selector. Mirrors every
 * codec accepted by the {@link AudioTrackConfig} discriminated union.
 */
const AUDIO_CODEC_OPTIONS = ['aac', 'opus', 'mp3', 'flac', 'pcm'] as const satisfies readonly SyntheticAudioCodec[]

/**
 * Fast-start modes exercised by the benchmark. Progressive mode
 * (`fastStart: false`) is intentionally omitted because `ArrayBufferTarget.seek`
 * is a no-op and the ScreenRecorder scenario already exercises the progressive
 * path against a seekable file-system target.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 */
const FAST_START_OPTIONS = ['in-memory', 'fragmented'] as const satisfies readonly SyntheticFastStart[]

/**
 * Synthetic keyframe payload size in bytes. 80 KB matches a roughly
 * mid-quality 1080p AVC keyframe at realistic bitrates, which gives the
 * throughput numbers a believable shape.
 */
const SYNTHETIC_VIDEO_KEYFRAME_BYTES = 80 * 1024

/**
 * Synthetic delta-frame payload size in bytes. 12 KB approximates the average
 * inter-frame size that AVC produces at the same quality target.
 */
const SYNTHETIC_VIDEO_DELTA_BYTES = 12 * 1024

/**
 * Synthetic audio-frame payload size in bytes. 4 KB is a comfortable envelope
 * for every audio codec exercised by the scenario at the configured sample
 * rate and channel count.
 */
const SYNTHETIC_AUDIO_FRAME_BYTES = 4 * 1024

/** Frames per second of the synthetic video stream. */
const SYNTHETIC_VIDEO_FRAMERATE = 30

/** Keyframe cadence. One key every thirty frames at 30 fps is one per second. */
const SYNTHETIC_VIDEO_KEYFRAME_INTERVAL_FRAMES = 30

/**
 * Audio frame rate of the synthetic audio stream in frames per second.
 * 50 frames per second corresponds to a 20 ms packet cadence, which matches
 * the Opus default and is close enough for AAC and FLAC benchmarking.
 */
const SYNTHETIC_AUDIO_FRAME_RATE = 50

/** Sample rate shared by every synthetic audio track in Hertz. */
const SYNTHETIC_AUDIO_SAMPLE_RATE = 48_000

/** Channel count shared by every synthetic audio track. */
const SYNTHETIC_AUDIO_CHANNEL_COUNT = 2

/**
 * Coded video frame width in pixels. 1920x1080 matches the keyframe-size
 * heuristic above so the muxer records a realistic-looking track geometry.
 */
const SYNTHETIC_VIDEO_WIDTH = 1920

/** Coded video frame height in pixels. */
const SYNTHETIC_VIDEO_HEIGHT = 1080

/** Microseconds per second, the unit-conversion factor used by the muxer API. */
const MICROSECONDS_PER_SECOND = 1_000_000

/**
 * Bytes per mebibyte used to derive the mebibytes-per-second throughput readout.
 * The value is 1024 squared so the throughput number agrees with
 * {@link formatBytes} which also divides by 1024 at every threshold.
 */
const BYTES_PER_MEBIBYTE = 1024 * 1024

/** Minimum duration accepted by the slider, in seconds. */
const DURATION_MIN_SECONDS = 1

/** Maximum duration accepted by the slider, in seconds. */
const DURATION_MAX_SECONDS = 60

/** Default duration pre-selected when the scenario mounts, in seconds. */
const DEFAULT_DURATION_SECONDS = 10

/**
 * Phase of the stress-test UI. Purely presentational: the benchmark runs
 * synchronously once `run` starts, so the phase only controls which card body
 * is visible and whether the run button is disabled.
 */
type BenchmarkPhase = 'idle' | 'running' | 'complete' | 'error'

/**
 * Telemetry captured on each completed benchmark run. Every field is the raw
 * measurement; the {@link Stats} entries below format the values for display.
 */
type BenchmarkResult = {
  wallClockMilliseconds: number
  totalSampleCount: number
  bytesWritten: number
  throughputBytesPerSecond: number
}

/**
 * Synchronously runs a single benchmark configured by the supplied parameters
 * and returns the resulting measurement. Every muxer call path is exercised in
 * wall-clock time so the returned throughput reflects mp4craft's real-world
 * cost: sample append, fragment emission when `fastStart` is fragmented, and
 * final `moov` or `moof` flush during `finalize`.
 *
 * @param benchmarkInputs - Video codec, audio codec, fast-start mode, and
 *   duration selected by the user.
 * @returns The captured throughput measurement.
 */
async function runBenchmarkOnce(benchmarkInputs: {
  videoCodec: SyntheticVideoCodec
  audioCodec: SyntheticAudioCodec
  fastStart: SyntheticFastStart
  durationSeconds: number
}): Promise<BenchmarkResult> {
  const arrayBufferTarget = new ArrayBufferTarget()
  const muxer = new Mp4Muxer<ArrayBufferTarget>({
    target: arrayBufferTarget,
    fastStart: benchmarkInputs.fastStart,
    video: buildSyntheticVideoTrackConfig(benchmarkInputs.videoCodec, SYNTHETIC_VIDEO_WIDTH, SYNTHETIC_VIDEO_HEIGHT),
    audio: buildSyntheticAudioTrackConfig(
      benchmarkInputs.audioCodec,
      SYNTHETIC_AUDIO_CHANNEL_COUNT,
      SYNTHETIC_AUDIO_SAMPLE_RATE
    ),
  })

  const totalVideoFrameCount = benchmarkInputs.durationSeconds * SYNTHETIC_VIDEO_FRAMERATE
  const totalAudioFrameCount = benchmarkInputs.durationSeconds * SYNTHETIC_AUDIO_FRAME_RATE
  const videoFrameDurationMicroseconds = Math.round(MICROSECONDS_PER_SECOND / SYNTHETIC_VIDEO_FRAMERATE)
  const audioFrameDurationMicroseconds = Math.round(MICROSECONDS_PER_SECOND / SYNTHETIC_AUDIO_FRAME_RATE)

  /*
   * Pre-allocate one synthetic keyframe buffer and one synthetic delta-frame
   * buffer per run. The muxer reads each sample synchronously and releases it
   * before the next call, so re-using the same underlying buffer avoids
   * megabytes of allocator churn that would otherwise dominate the benchmark.
   * Every sample handed to the muxer is a fresh `Uint8Array` view so the
   * muxer's caller-reuses-buffer contract still holds.
   */
  const syntheticKeyframeBytes = new Uint8Array(SYNTHETIC_VIDEO_KEYFRAME_BYTES)
  const syntheticDeltaFrameBytes = new Uint8Array(SYNTHETIC_VIDEO_DELTA_BYTES)
  const syntheticAudioFrameBytes = new Uint8Array(SYNTHETIC_AUDIO_FRAME_BYTES)

  const benchmarkStartMilliseconds = performance.now()

  for (let videoFrameIndex = 0; videoFrameIndex < totalVideoFrameCount; videoFrameIndex += 1) {
    const isKeyFrame = videoFrameIndex % SYNTHETIC_VIDEO_KEYFRAME_INTERVAL_FRAMES === 0
    const frameBytes = isKeyFrame
      ? new Uint8Array(syntheticKeyframeBytes.buffer)
      : new Uint8Array(syntheticDeltaFrameBytes.buffer)
    muxer.addVideoSample({
      data: frameBytes,
      timestamp: videoFrameIndex * videoFrameDurationMicroseconds,
      duration: videoFrameDurationMicroseconds,
      isKeyFrame,
    })
  }

  for (let audioFrameIndex = 0; audioFrameIndex < totalAudioFrameCount; audioFrameIndex += 1) {
    muxer.addAudioSample({
      data: new Uint8Array(syntheticAudioFrameBytes.buffer),
      timestamp: audioFrameIndex * audioFrameDurationMicroseconds,
      duration: audioFrameDurationMicroseconds,
      isKeyFrame: true,
    })
  }

  await muxer.finalize()

  const benchmarkEndMilliseconds = performance.now()
  const wallClockMilliseconds = benchmarkEndMilliseconds - benchmarkStartMilliseconds
  const bytesWritten = arrayBufferTarget.buffer.byteLength
  const elapsedSeconds = wallClockMilliseconds / 1000
  const throughputBytesPerSecond = elapsedSeconds > 0 ? bytesWritten / elapsedSeconds : 0

  return {
    wallClockMilliseconds,
    totalSampleCount: totalVideoFrameCount + totalAudioFrameCount,
    bytesWritten,
    throughputBytesPerSecond,
  }
}

/**
 * Formats a byte count as a short human-readable string, for example
 * `1.42 MB`. Matches the formatting used by the CameraRecorder scenario so
 * the playground renders byte sizes consistently across every view.
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
 * Synthetic throughput benchmark. Feeds zero-filled encoded samples through
 * {@link Mp4Muxer} as fast as the event loop allows and reports the wall-clock
 * duration, total samples, output byte count, and mebibytes-per-second
 * throughput. Intended to expose the raw muxer cost without the encoder
 * pipeline that dominates the other scenarios.
 *
 * Every combination of video codec, audio codec, and fast-start mode in the
 * pill selectors produces a valid run. Progressive fast-start mode is omitted
 * because `ArrayBufferTarget.seek` is a no-op and the progressive path is
 * already exercised by the ScreenRecorder scenario against a real seekable
 * target.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function StressTest() {
  const [phase, setPhase] = useState<BenchmarkPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_DURATION_SECONDS)
  const [selectedVideoCodec, setSelectedVideoCodec] = useState<SyntheticVideoCodec>('avc')
  const [selectedAudioCodec, setSelectedAudioCodec] = useState<SyntheticAudioCodec>('aac')
  const [selectedFastStart, setSelectedFastStart] = useState<SyntheticFastStart>('in-memory')
  const [latestResult, setLatestResult] = useState<BenchmarkResult | null>(null)

  const handleDurationChange = useCallback((changeEvent: React.ChangeEvent<HTMLInputElement>) => {
    const parsedDurationSeconds = Number.parseInt(changeEvent.target.value, 10)
    if (Number.isFinite(parsedDurationSeconds)) {
      setDurationSeconds(parsedDurationSeconds)
    }
  }, [])

  const handleRunClick = useCallback(async (): Promise<void> => {
    setPhase('running')
    setErrorMessage('')
    try {
      /*
       * Yield once before the benchmark so React commits the "running"
       * layout and the disabled run button is visible before the loop
       * monopolises the main thread. Without this the UI appears frozen
       * while the synchronous sample loop executes.
       */
      await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0))
      const nextResult = await runBenchmarkOnce({
        videoCodec: selectedVideoCodec,
        audioCodec: selectedAudioCodec,
        fastStart: selectedFastStart,
        durationSeconds,
      })
      setLatestResult(nextResult)
      setPhase('complete')
    } catch (unknownReason) {
      const reasonMessage = unknownReason instanceof Error ? unknownReason.message : String(unknownReason)
      setErrorMessage(reasonMessage)
      setPhase('error')
    }
  }, [durationSeconds, selectedAudioCodec, selectedFastStart, selectedVideoCodec])

  return (
    <ScenarioFrame title="Stress Test" description="Throughput benchmark across codec, mode, and target combinations.">
      <div className={stressTestStyles.layout}>
        <Card radius="medium" shadow="subtle">
          <div className={stressTestStyles.statusCard}>
            <h2 className={stressTestStyles.statusHeading}>Benchmark configuration</h2>
            <p className={stressTestStyles.statusMessage}>
              Pick a duration, codec pair, and fast-start mode. The run feeds zero-filled encoded samples through an
              in-memory muxer as fast as the event loop allows, then reports the wall-clock cost and the throughput
              achieved.
            </p>
            <div className={stressTestStyles.controlsGrid}>
              <div className={stressTestStyles.durationControl}>
                <span className={stressTestStyles.durationLabel}>Duration</span>
                <div className={stressTestStyles.durationRow}>
                  <input
                    type="range"
                    className={stressTestStyles.durationSlider}
                    min={DURATION_MIN_SECONDS}
                    max={DURATION_MAX_SECONDS}
                    step={1}
                    value={durationSeconds}
                    onChange={handleDurationChange}
                    disabled={phase === 'running'}
                    aria-label="Duration in seconds"
                  />
                  <span className={stressTestStyles.durationValue}>{durationSeconds} s</span>
                </div>
              </div>
              <CodecSelector<SyntheticVideoCodec>
                label="Video codec"
                options={VIDEO_CODEC_OPTIONS}
                value={selectedVideoCodec}
                onChange={setSelectedVideoCodec}
              />
              <CodecSelector<SyntheticAudioCodec>
                label="Audio codec"
                options={AUDIO_CODEC_OPTIONS}
                value={selectedAudioCodec}
                onChange={setSelectedAudioCodec}
              />
              <CodecSelector<SyntheticFastStart>
                label="Fast start mode"
                options={FAST_START_OPTIONS}
                value={selectedFastStart}
                onChange={setSelectedFastStart}
              />
            </div>
            <div className={stressTestStyles.actionRow}>
              <DarkButton onClick={() => void handleRunClick()} disabled={phase === 'running'}>
                {phase === 'running' ? 'Running...' : 'Run Benchmark'}
              </DarkButton>
            </div>
            <p className={stressTestStyles.helperText}>
              Keyframes use an 80 KB payload every thirty video frames, delta frames use 12 KB, and audio frames use 4
              KB at fifty frames per second. Progressive fast-start is omitted because the ArrayBufferTarget seek method
              is a documented no-op.
            </p>
          </div>
        </Card>
        {renderResultContent({
          phase,
          errorMessage,
          latestResult,
        })}
      </div>
    </ScenarioFrame>
  )
}

/**
 * Inputs consumed by {@link renderResultContent}. Packaging the render inputs
 * inside a single record keeps the outer component body focused on state
 * transitions rather than branching UI.
 */
type ResultRenderInputs = {
  phase: BenchmarkPhase
  errorMessage: string
  latestResult: BenchmarkResult | null
}

/**
 * Renders the result card for the current benchmark phase. Keeps the
 * phase-to-view mapping centralized in a single {@link Record} dispatch table
 * so a future phase is added in one place.
 *
 * @param inputs - Current phase, error text, and latest measurement.
 * @returns The JSX for the active phase.
 */
function renderResultContent(inputs: ResultRenderInputs) {
  const statsEntries: readonly StatsEntry[] =
    inputs.latestResult !== null
      ? [
          {
            label: 'Wall-clock ms',
            value: inputs.latestResult.wallClockMilliseconds.toFixed(1),
          },
          {
            label: 'Total samples',
            value: inputs.latestResult.totalSampleCount.toLocaleString(),
          },
          {
            label: 'Bytes written',
            value: formatBytes(inputs.latestResult.bytesWritten),
          },
          {
            label: 'Throughput MiB/s',
            value: (inputs.latestResult.throughputBytesPerSecond / BYTES_PER_MEBIBYTE).toFixed(2),
          },
        ]
      : []

  const phaseRenderers: Record<BenchmarkPhase, () => React.ReactElement> = {
    idle: () => (
      <Card radius="medium" shadow="subtle">
        <div className={stressTestStyles.statusCard}>
          <h2 className={stressTestStyles.statusHeading}>Awaiting first run</h2>
          <p className={stressTestStyles.statusMessage}>
            Click Run Benchmark above to generate a throughput measurement. The numbers update in place on every
            subsequent run.
          </p>
        </div>
      </Card>
    ),
    running: () => (
      <Card radius="medium" shadow="subtle">
        <div className={stressTestStyles.statusCard}>
          <h2 className={stressTestStyles.statusHeading}>Feeding synthetic samples</h2>
          <p className={stressTestStyles.statusMessage}>
            The benchmark is running on the main thread. Results appear as soon as the muxer finalize call resolves.
          </p>
        </div>
      </Card>
    ),
    complete: () => (
      <Card radius="medium" shadow="subtle">
        <div className={stressTestStyles.statusCard}>
          <h2 className={stressTestStyles.statusHeading}>Latest run</h2>
          <Stats entries={statsEntries} />
          <p className={stressTestStyles.helperText}>
            Throughput counts the finalized MP4 byte size against the wall-clock duration of the full sample-append and
            finalize sequence.
          </p>
        </div>
      </Card>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={stressTestStyles.statusCard}>
          <h2 className={stressTestStyles.statusHeading}>Benchmark failed</h2>
          <p className={stressTestStyles.errorMessage}>
            {inputs.errorMessage !== ''
              ? inputs.errorMessage
              : 'An unknown error occurred while running the benchmark.'}
          </p>
        </div>
      </Card>
    ),
  }

  return phaseRenderers[inputs.phase]()
}

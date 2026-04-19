import { Card } from '@/components/Card'
import { PillButton } from '@/components/PillButton'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { buildSyntheticAudioTrackConfig, buildSyntheticVideoTrackConfig } from '@/lib/synthetic-codec-config'
import type { SyntheticAudioCodec, SyntheticFastStart, SyntheticVideoCodec } from '@/lib/synthetic-codec-config'
import codecMatrixStyles from '@/scenarios/CodecMatrix.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Every video codec tag accepted by {@link VideoTrackConfig}. The sweep
 * constructs one muxer per codec here paired with every audio codec and every
 * fast-start option. The byte constants and track-config builders live in
 * `@/lib/synthetic-codec-config` so this sweep and the StressTest benchmark
 * share a single source of truth.
 */
const VIDEO_CODECS = ['avc', 'hevc', 'vp9', 'av1'] as const satisfies readonly SyntheticVideoCodec[]

/**
 * Every audio codec tag accepted by {@link AudioTrackConfig}. Paired with
 * every entry in {@link VIDEO_CODECS} and {@link FAST_START_MODES}.
 */
const AUDIO_CODECS = ['aac', 'opus', 'mp3', 'flac', 'pcm'] as const satisfies readonly SyntheticAudioCodec[]

/**
 * Fast-start modes exercised by the sweep. Progressive mode (`false`) is
 * intentionally omitted because `ArrayBufferTarget.seek` is a documented
 * no-op, so a progressive run against `ArrayBufferTarget` only retraces the
 * append path rather than the seekable patch path. The ScreenRecorder
 * scenario already exercises progressive output against a real seekable
 * file-system target.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 */
const FAST_START_MODES = ['in-memory', 'fragmented'] as const satisfies readonly SyntheticFastStart[]

/** Video frame duration exercised by each sweep combination, in microseconds. */
const SWEEP_VIDEO_SAMPLE_DURATION_MICROSECONDS = 33_333

/** Audio frame duration exercised by each sweep combination, in microseconds. */
const SWEEP_AUDIO_SAMPLE_DURATION_MICROSECONDS = 20_000

/** Coded video frame width in pixels. */
const SWEEP_VIDEO_WIDTH = 320

/** Coded video frame height in pixels. */
const SWEEP_VIDEO_HEIGHT = 240

/** Sample rate used by every audio codec variant in the sweep, in Hertz. */
const SWEEP_AUDIO_SAMPLE_RATE = 48_000

/** Channel count used by every audio codec variant in the sweep. */
const SWEEP_AUDIO_CHANNEL_COUNT = 2

/**
 * Synthetic video sample payload size. Large enough to exercise the sample
 * table and fragment emission paths without bloating run time.
 */
const SWEEP_VIDEO_SAMPLE_BYTES = 1024

/** Synthetic audio sample payload size. */
const SWEEP_AUDIO_SAMPLE_BYTES = 256

/**
 * Outcome captured for a single `(videoCodec, audioCodec, fastStart)` triple.
 * The UI renders a green pill when `didPass` is true and a red pill with the
 * `failureMessage` otherwise.
 */
type CombinationOutcome = {
  videoCodec: SyntheticVideoCodec
  audioCodec: SyntheticAudioCodec
  fastStart: SyntheticFastStart
  didPass: boolean
  failureMessage: string | null
}

/**
 * Runs exactly one `(videoCodec, audioCodec, fastStart)` combination end-to-end
 * through mp4craft: constructs the muxer, appends two synthetic video samples
 * and two synthetic audio samples, awaits `finalize`, and returns whether the
 * sequence completed without throwing. The single `try` / `catch` reflects the
 * user guideline that the scenario trusts the muxer's own validation rather
 * than pre-checking inputs.
 *
 * @param combinationInputs - The codec pair and fast-start mode to exercise.
 * @returns The captured pass or fail outcome, including the raw error message
 *   when the combination throws.
 */
async function runCombination(combinationInputs: {
  videoCodec: SyntheticVideoCodec
  audioCodec: SyntheticAudioCodec
  fastStart: SyntheticFastStart
}): Promise<CombinationOutcome> {
  try {
    const arrayBufferTarget = new ArrayBufferTarget()
    const muxer = new Mp4Muxer<ArrayBufferTarget>({
      target: arrayBufferTarget,
      fastStart: combinationInputs.fastStart,
      video: buildSyntheticVideoTrackConfig(combinationInputs.videoCodec, SWEEP_VIDEO_WIDTH, SWEEP_VIDEO_HEIGHT),
      audio: buildSyntheticAudioTrackConfig(
        combinationInputs.audioCodec,
        SWEEP_AUDIO_CHANNEL_COUNT,
        SWEEP_AUDIO_SAMPLE_RATE
      ),
    })
    for (let videoSampleIndex = 0; videoSampleIndex < 2; videoSampleIndex += 1) {
      muxer.addVideoSample({
        data: new Uint8Array(SWEEP_VIDEO_SAMPLE_BYTES),
        timestamp: videoSampleIndex * SWEEP_VIDEO_SAMPLE_DURATION_MICROSECONDS,
        duration: SWEEP_VIDEO_SAMPLE_DURATION_MICROSECONDS,
        isKeyFrame: videoSampleIndex === 0,
      })
    }
    for (let audioSampleIndex = 0; audioSampleIndex < 2; audioSampleIndex += 1) {
      muxer.addAudioSample({
        data: new Uint8Array(SWEEP_AUDIO_SAMPLE_BYTES),
        timestamp: audioSampleIndex * SWEEP_AUDIO_SAMPLE_DURATION_MICROSECONDS,
        duration: SWEEP_AUDIO_SAMPLE_DURATION_MICROSECONDS,
        isKeyFrame: true,
      })
    }
    await muxer.finalize()
    return {
      videoCodec: combinationInputs.videoCodec,
      audioCodec: combinationInputs.audioCodec,
      fastStart: combinationInputs.fastStart,
      didPass: true,
      failureMessage: null,
    }
  } catch (unknownReason) {
    const reasonMessage = unknownReason instanceof Error ? unknownReason.message : String(unknownReason)
    return {
      videoCodec: combinationInputs.videoCodec,
      audioCodec: combinationInputs.audioCodec,
      fastStart: combinationInputs.fastStart,
      didPass: false,
      failureMessage: reasonMessage,
    }
  }
}

/**
 * Iterates every `(videoCodec, audioCodec, fastStart)` triple and resolves
 * with the full list of captured outcomes. Sweeps are deterministic: the
 * ordering of the three input arrays drives the ordering of the returned
 * outcomes so the rendered grid is stable across re-runs.
 *
 * @returns The list of captured outcomes in sweep order.
 */
async function runFullSweep(): Promise<readonly CombinationOutcome[]> {
  const capturedOutcomes: CombinationOutcome[] = []
  for (const videoCodec of VIDEO_CODECS) {
    for (const audioCodec of AUDIO_CODECS) {
      for (const fastStart of FAST_START_MODES) {
        const nextOutcome = await runCombination({ videoCodec, audioCodec, fastStart })
        capturedOutcomes.push(nextOutcome)
      }
    }
  }
  return capturedOutcomes
}

/** Phase of the sweep UI. Matches the reruns allowed by the action button. */
type SweepPhase = 'running' | 'complete'

/**
 * Deterministic codec-coverage audit. Iterates every combination of video
 * codec, audio codec, and fast-start mode, feeds two synthetic samples per
 * track through {@link Mp4Muxer}, awaits `finalize`, and records the pass or
 * fail outcome. The grid of pass and fail cards doubles as a live readout of
 * mp4craft's public-API coverage.
 *
 * Progressive fast-start mode is omitted because `ArrayBufferTarget.seek` is
 * a documented no-op, so a progressive sweep against `ArrayBufferTarget`
 * would only re-exercise the append path. That leaves the documented four
 * video codecs, five audio codecs, and two fast-start modes for a total of
 * forty combinations per sweep.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function CodecMatrix() {
  const [phase, setPhase] = useState<SweepPhase>('running')
  const [outcomes, setOutcomes] = useState<readonly CombinationOutcome[]>([])
  const isMountedRef = useRef<boolean>(true)

  const triggerSweep = useCallback(async (): Promise<void> => {
    /*
     * Clear the previous outcomes and flip the phase to `running` before
     * starting the sweep so the click produces a visible transition. Without
     * clearing, the stale grid stays on-screen while `runFullSweep` churns
     * through 40 back-to-back muxer finalizations in the microtask queue,
     * and the final `setOutcomes(...)` re-renders identical data, so the
     * user perceives the button as dead. Yielding a macrotask afterwards gives
     * React a chance to commit the running layout and paint before the
     * synchronous-in-microtasks loop resumes.
     */
    setOutcomes([])
    setPhase('running')
    await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0))
    const capturedOutcomes = await runFullSweep()
    if (!isMountedRef.current) {
      return
    }
    setOutcomes(capturedOutcomes)
    setPhase('complete')
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    void triggerSweep()
    return () => {
      isMountedRef.current = false
    }
  }, [triggerSweep])

  const passedCount = outcomes.reduce(
    (runningTotal, combinationOutcome) => (combinationOutcome.didPass ? runningTotal + 1 : runningTotal),
    0
  )
  const failedCount = outcomes.length - passedCount

  return (
    <ScenarioFrame
      title="Codec Matrix"
      description="Programmatic sweep verifying every codec and container-mode combination."
    >
      <div className={codecMatrixStyles.layout}>
        {renderSweepContent({
          phase,
          outcomes,
          passedCount,
          failedCount,
          onRerun: () => void triggerSweep(),
        })}
      </div>
    </ScenarioFrame>
  )
}

/**
 * Inputs consumed by {@link renderSweepContent}. Packaging the render inputs
 * inside a single record keeps the outer component body focused on
 * orchestration rather than branching UI.
 */
type SweepRenderInputs = {
  phase: SweepPhase
  outcomes: readonly CombinationOutcome[]
  passedCount: number
  failedCount: number
  onRerun: () => void
}

/**
 * Renders the header card and the matrix grid for the current sweep phase. A
 * {@link Record} dispatch table keeps the phase-to-view mapping centralized.
 *
 * @param inputs - Current phase, outcomes, and the rerun callback.
 * @returns The JSX for the active phase.
 */
function renderSweepContent(inputs: SweepRenderInputs) {
  const phaseRenderers: Record<SweepPhase, () => React.ReactElement> = {
    running: () => (
      <Card radius="medium" shadow="subtle">
        <div className={codecMatrixStyles.statusCard}>
          <h2 className={codecMatrixStyles.statusHeading}>Running sweep</h2>
          <p className={codecMatrixStyles.statusMessage}>
            Constructing one mp4craft muxer per codec pair and fast-start mode and feeding two synthetic samples per
            track. The pass or fail grid renders once every combination finalizes.
          </p>
        </div>
      </Card>
    ),
    complete: () => (
      <>
        <Card radius="medium" shadow="subtle">
          <div className={codecMatrixStyles.statusCard}>
            <h2 className={codecMatrixStyles.statusHeading}>Sweep complete</h2>
            <div className={codecMatrixStyles.summary}>
              <div>
                <div className={codecMatrixStyles.summaryLabel}>Passed</div>
                <div className={codecMatrixStyles.summaryValue}>
                  {inputs.passedCount} / {inputs.outcomes.length}
                </div>
              </div>
              <div>
                <div className={codecMatrixStyles.summaryLabel}>Failed</div>
                <div className={codecMatrixStyles.summaryValue}>{inputs.failedCount}</div>
              </div>
            </div>
            <p className={codecMatrixStyles.helperText}>
              Progressive fast-start is omitted because ArrayBufferTarget.seek is a no-op. The forty exercised
              combinations cover every discriminated-union variant of VideoTrackConfig and AudioTrackConfig in both
              in-memory and fragmented layouts.
            </p>
            <div className={codecMatrixStyles.actionRow}>
              <PillButton variant="nav-active" onClick={inputs.onRerun}>
                Re-run sweep
              </PillButton>
            </div>
          </div>
        </Card>
        <div className={codecMatrixStyles.matrixGrid}>
          {inputs.outcomes.map((combinationOutcome) => (
            <CombinationBadge
              key={`${combinationOutcome.videoCodec}-${combinationOutcome.audioCodec}-${combinationOutcome.fastStart}`}
              outcome={combinationOutcome}
            />
          ))}
        </div>
      </>
    ),
  }

  return phaseRenderers[inputs.phase]()
}

/**
 * Props accepted by {@link CombinationBadge}.
 */
type CombinationBadgeProps = {
  /** The outcome captured by the sweep runner for this combination. */
  outcome: CombinationOutcome
}

/**
 * Renders one combination card inside the matrix grid. The card uses a green
 * border and pill when the combination passed and a red border and pill when
 * it failed. The pill text uses the words "pass" and "fail" rather than icons
 * so the semantic meaning is unambiguous to screen readers.
 *
 * @param props - The captured outcome to render.
 * @returns The styled combination card.
 *
 * @see DESIGN.md section 4 "AI Product Cards" for the small-radius card treatment.
 */
function CombinationBadge(props: CombinationBadgeProps) {
  const { outcome } = props
  const contentClassName = outcome.didPass
    ? `${codecMatrixStyles.combinationContent} ${codecMatrixStyles.combinationPass}`
    : `${codecMatrixStyles.combinationContent} ${codecMatrixStyles.combinationFail}`
  const badgeClassName = outcome.didPass
    ? `${codecMatrixStyles.combinationBadge} ${codecMatrixStyles.badgePass}`
    : `${codecMatrixStyles.combinationBadge} ${codecMatrixStyles.badgeFail}`
  const badgeText = outcome.didPass ? 'pass' : 'fail'
  return (
    <Card radius="small" shadow="subtle">
      <div className={contentClassName}>
        <div className={codecMatrixStyles.combinationHeader}>
          <h3 className={codecMatrixStyles.combinationTitle}>
            {outcome.videoCodec} + {outcome.audioCodec}
          </h3>
          <span className={badgeClassName}>{badgeText}</span>
        </div>
        <p className={codecMatrixStyles.combinationMeta}>{outcome.fastStart}</p>
        {outcome.failureMessage !== null ? (
          <p className={codecMatrixStyles.combinationDetail}>{outcome.failureMessage}</p>
        ) : null}
      </div>
    </Card>
  )
}

import { Card } from '@/components/Card'
import { CodecSelector } from '@/components/CodecSelector'
import { DarkButton } from '@/components/DarkButton'
import { PillButton } from '@/components/PillButton'
import { Stats } from '@/components/Stats'
import type { StatsEntry } from '@/components/Stats'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { saveBytesToDisk } from '@/lib/download'
import { parseMp4Bytes } from '@/lib/parse-mp4-bytes'
import type { ParsedAudioTrack, ParsedMp4, ParsedSample, ParsedVideoTrack } from '@/lib/parse-mp4-bytes'
import type { SyntheticFastStart } from '@/lib/synthetic-codec-config'
import fileReplayStyles from '@/scenarios/FileReplay.module.css'
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'
import type { AacAudioTrackConfig, MuxerOptions, VideoTrackConfig } from 'mp4craft'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phases of the FileReplay scenario. The `"idle"` phase covers both the
 * first-visit empty drop zone and the post-parse "ready to rebuild" view
 * distinguished by the presence of {@link ReplaySession.parsedMp4}. This
 * avoids a dedicated "ready" phase whose only purpose would be to gate which
 * card renders.
 */
type ReplayPhase = 'idle' | 'parsing' | 'rebuilding' | 'stopped' | 'error'

/**
 * Fast-start modes exposed by the scenario's selector. Mirrors the same two
 * choices as StressTest, deliberately omitting progressive (`fastStart: false`)
 * because `ArrayBufferTarget.seek` is a no-op and the progressive path is
 * already exercised by ScreenRecorder against a seekable file-system target.
 */
const FAST_START_OPTIONS = ['in-memory', 'fragmented'] as const satisfies readonly SyntheticFastStart[]

/**
 * Successfully parsed session ready to be muxed. Carries the bytes the output
 * muxer needs and the original file name so the default save name mirrors the
 * upload.
 */
type ParsedReplaySession = {
  readonly sourceFileName: string
  readonly parsedMp4: ParsedMp4
  readonly totalVideoSampleCount: number
  readonly totalAudioSampleCount: number
}

/**
 * Result of a successful rebuild. The finalized bytes flow into a Blob for
 * playback and back through {@link saveBytesToDisk} when the user clicks Save.
 */
type CompletedReplay = {
  readonly sourceFileName: string
  readonly bytesWritten: Uint8Array<ArrayBuffer>
  readonly objectUrl: string
  readonly videoSamplesReplayed: number
  readonly audioSamplesReplayed: number
}

/**
 * In-flight rebuild telemetry. Exposed to the `Stats` component so the user
 * sees the progress of both sample streams independently. The output byte
 * count is deliberately absent because the muxer only reveals the finalized
 * buffer length after `finalize`, so it belongs on the completed-summary card
 * rather than the in-flight readout.
 */
type RebuildTelemetry = {
  videoSamplesReplayed: number
  audioSamplesReplayed: number
}

/** Initial telemetry snapshot so the component can reset to a zeroed state. */
const INITIAL_REBUILD_TELEMETRY: RebuildTelemetry = {
  videoSamplesReplayed: 0,
  audioSamplesReplayed: 0,
}

/**
 * Formats a byte count as a short human-readable string, for example
 * `1.42 MB`. Matches the formatter used elsewhere in the playground so byte
 * counts stay consistent across scenarios.
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
 * Produces the default output file name from the uploaded source name. The
 * `-rebuilt.mp4` suffix makes repeat rebuilds discoverable in the downloads
 * folder without clobbering the original file.
 *
 * @param sourceFileName - Name of the uploaded file.
 * @returns A default save name ending in `.mp4`.
 */
function buildRebuiltFileName(sourceFileName: string): string {
  const extensionIndex = sourceFileName.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? sourceFileName.slice(0, extensionIndex) : sourceFileName
  return `${baseName}-rebuilt.mp4`
}

/**
 * Builds the {@link VideoTrackConfig} for the parsed AVC video track. The
 * helper exists as a named function so the `addVideoSample` timebase stays in
 * sync with the `VideoTrackConfig.timescale` the muxer honours.
 *
 * @param parsedVideoTrack - Video track extracted from the source MP4.
 * @returns A ready-to-use `VideoTrackConfig`.
 */
function buildOutputVideoConfig(parsedVideoTrack: ParsedVideoTrack): VideoTrackConfig {
  return {
    codec: 'avc',
    width: parsedVideoTrack.width,
    height: parsedVideoTrack.height,
    description: parsedVideoTrack.avcDecoderConfigRecord,
    timescale: parsedVideoTrack.timescale,
  }
}

/**
 * Builds the {@link AacAudioTrackConfig} for the parsed AAC audio track.
 *
 * @param parsedAudioTrack - Audio track extracted from the source MP4.
 * @returns A ready-to-use `AacAudioTrackConfig`.
 */
function buildOutputAudioConfig(parsedAudioTrack: ParsedAudioTrack): AacAudioTrackConfig {
  return {
    codec: 'aac',
    description: parsedAudioTrack.audioSpecificConfig,
    channels: parsedAudioTrack.channels,
    sampleRate: parsedAudioTrack.sampleRate,
    timescale: parsedAudioTrack.timescale,
  }
}

/**
 * Merges the video and audio sample lists into a single timestamp-ordered
 * stream using a two-pointer merge. Fragmented MP4 output requires the next
 * fragment's samples to be presented in ascending-timestamp order so the
 * emitted `moof` honours the fragment-duration boundary, and in-memory mode
 * also benefits because the muxer emits the sample tables in the same order.
 *
 * When a video sample and an audio sample share the same timestamp the video
 * sample is emitted first (the comparison uses `<=`). This guarantees that a
 * fragmented-mode fragment boundary always opens on a video sample, which is
 * the only sample that could be a keyframe candidate and therefore the only
 * valid starting point for a new fragment under ISO/IEC 14496-12 §8.8.
 *
 * @param videoSamples - Ordered video sample list.
 * @param audioSamples - Ordered audio sample list.
 * @returns A single interleaved array tagged with the originating track kind.
 */
function interleaveSamplesByTimestamp(
  videoSamples: readonly ParsedSample[],
  audioSamples: readonly ParsedSample[]
): { kind: 'video' | 'audio'; sample: ParsedSample }[] {
  const interleavedSamples: { kind: 'video' | 'audio'; sample: ParsedSample }[] = []
  let videoCursor = 0
  let audioCursor = 0
  while (videoCursor < videoSamples.length || audioCursor < audioSamples.length) {
    const nextVideoSample = videoSamples[videoCursor]
    const nextAudioSample = audioSamples[audioCursor]
    if (nextVideoSample === undefined && nextAudioSample !== undefined) {
      interleavedSamples.push({ kind: 'audio', sample: nextAudioSample })
      audioCursor += 1
      continue
    }
    if (nextAudioSample === undefined && nextVideoSample !== undefined) {
      interleavedSamples.push({ kind: 'video', sample: nextVideoSample })
      videoCursor += 1
      continue
    }
    if (nextVideoSample === undefined || nextAudioSample === undefined) {
      break
    }
    if (nextVideoSample.timestampMicroseconds <= nextAudioSample.timestampMicroseconds) {
      interleavedSamples.push({ kind: 'video', sample: nextVideoSample })
      videoCursor += 1
    } else {
      interleavedSamples.push({ kind: 'audio', sample: nextAudioSample })
      audioCursor += 1
    }
  }
  return interleavedSamples
}

/**
 * FileReplay scenario. The user uploads an existing MP4 file containing one
 * AVC video track and one AAC audio track, the scenario extracts the encoded
 * samples from the source `mdat` plus the decoder configuration records from
 * the `moov`, and replays the samples through mp4craft's raw
 * `addVideoSample` / `addAudioSample` API to rebuild the container in the
 * user-selected fast-start mode. The result is offered as a playback preview
 * and as a Save MP4 download.
 *
 * The scenario is the only one in the playground that exercises the
 * Node-oriented raw-sample API in the browser. Every other scenario feeds the
 * muxer via `addVideoChunk` / `addAudioChunk` because the samples originate
 * from WebCodecs `EncodedVideoChunk` / `EncodedAudioChunk`.
 *
 * Design choices documented in this component's JSDoc rather than in an
 * external comment:
 *
 * - Progressive (`fastStart: false`) is deliberately omitted from the mode
 *   selector because `ArrayBufferTarget.seek` is a no-op, the same rationale
 *   used by StressTest.
 * - The idle and "parsed" sub-states share the `"idle"` phase because the
 *   card layout only differs in whether the drop zone or the rebuild CTA is
 *   shown; gating on the presence of a parsed session keeps the phase table
 *   tidy.
 * - B-frame presentation timestamps are not preserved. The parser treats
 *   every sample's PTS as its DTS, which is exact for every file produced by
 *   the other playground scenarios.
 *
 * @returns The scenario page content, wrapped in the shared {@link ScenarioFrame}.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 layout.
 * @see {@link Mp4Muxer} in the mp4craft public API.
 */
export function FileReplay() {
  const [phase, setPhase] = useState<ReplayPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [selectedFastStart, setSelectedFastStart] = useState<SyntheticFastStart>('in-memory')
  const [parsedSession, setParsedSession] = useState<ParsedReplaySession | null>(null)
  const [rebuildTelemetry, setRebuildTelemetry] = useState<RebuildTelemetry>(INITIAL_REBUILD_TELEMETRY)
  const [completedReplay, setCompletedReplay] = useState<CompletedReplay | null>(null)
  const [isDragActive, setIsDragActive] = useState<boolean>(false)

  const isMountedRef = useRef<boolean>(true)
  const fileInputElementRef = useRef<HTMLInputElement | null>(null)

  /*
   * Generation counter guarding against a file-swap race. When the user drops
   * file A and then file B before A finishes parsing, the later invocation
   * must not let A's completion or error handlers overwrite B's state. Each
   * call to `handleParseUploadedFile` increments this counter and captures the
   * new value locally, then compares it back before every state setter. A
   * mismatch means a newer parse has superseded this one, so the stale result
   * is discarded.
   */
  const activeParseGenerationRef = useRef<number>(0)

  /*
   * Track the current completed replay in a ref so the cleanup effect revokes
   * the right object URL when the component unmounts or when a new rebuild
   * replaces the old one. Mirroring state into a ref avoids re-running the
   * cleanup effect on every unrelated render.
   */
  const completedReplayRef = useRef<CompletedReplay | null>(null)
  useEffect(() => {
    completedReplayRef.current = completedReplay
  }, [completedReplay])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      const pendingReplay = completedReplayRef.current
      if (pendingReplay !== null) {
        URL.revokeObjectURL(pendingReplay.objectUrl)
      }
    }
  }, [])

  const revokeCompletedReplay = useCallback((): void => {
    if (completedReplay !== null) {
      URL.revokeObjectURL(completedReplay.objectUrl)
    }
    setCompletedReplay(null)
  }, [completedReplay])

  const resetScenario = useCallback((): void => {
    revokeCompletedReplay()
    setParsedSession(null)
    setRebuildTelemetry(INITIAL_REBUILD_TELEMETRY)
    setErrorMessage('')
    setPhase('idle')
    const fileInputElement = fileInputElementRef.current
    if (fileInputElement !== null) {
      fileInputElement.value = ''
    }
  }, [revokeCompletedReplay])

  const handleParseUploadedFile = useCallback(
    async (uploadedFile: File): Promise<void> => {
      activeParseGenerationRef.current += 1
      const currentParseGeneration = activeParseGenerationRef.current
      setErrorMessage('')
      setPhase('parsing')
      setParsedSession(null)
      revokeCompletedReplay()
      try {
        const sourceArrayBuffer = await uploadedFile.arrayBuffer()
        const sourceBytes = new Uint8Array(sourceArrayBuffer)
        const parsedMp4 = parseMp4Bytes(sourceBytes)
        if (!isMountedRef.current) {
          return
        }
        if (currentParseGeneration !== activeParseGenerationRef.current) {
          return
        }
        const nextParsedSession: ParsedReplaySession = {
          sourceFileName: uploadedFile.name,
          parsedMp4,
          totalVideoSampleCount: parsedMp4.videoTrack?.samples.length ?? 0,
          totalAudioSampleCount: parsedMp4.audioTrack?.samples.length ?? 0,
        }
        setParsedSession(nextParsedSession)
        setPhase('idle')
      } catch (unknownReason) {
        const reasonMessage = unknownReason instanceof Error ? unknownReason.message : String(unknownReason)
        if (!isMountedRef.current) {
          return
        }
        if (currentParseGeneration !== activeParseGenerationRef.current) {
          return
        }
        setErrorMessage(reasonMessage)
        setPhase('error')
      }
    },
    [revokeCompletedReplay]
  )

  const handleRebuildContainer = useCallback(async (): Promise<void> => {
    if (parsedSession === null) {
      return
    }
    setErrorMessage('')
    setRebuildTelemetry(INITIAL_REBUILD_TELEMETRY)
    setPhase('rebuilding')

    try {
      /*
       * Yield once before the synchronous sample loop so React commits the
       * "rebuilding" card layout before the event loop is monopolised by the
       * mux path. Without this the UI appears frozen while the loop runs.
       */
      await new Promise<void>((resolveFirstTick) => setTimeout(resolveFirstTick, 0))

      const outputTarget = new ArrayBufferTarget()
      const muxerOptions: MuxerOptions<ArrayBufferTarget> = {
        target: outputTarget,
        fastStart: selectedFastStart,
      }
      if (parsedSession.parsedMp4.videoTrack !== null) {
        muxerOptions.video = buildOutputVideoConfig(parsedSession.parsedMp4.videoTrack)
      }
      if (parsedSession.parsedMp4.audioTrack !== null) {
        muxerOptions.audio = buildOutputAudioConfig(parsedSession.parsedMp4.audioTrack)
      }
      const muxer = new Mp4Muxer<ArrayBufferTarget>(muxerOptions)

      const videoSamples = parsedSession.parsedMp4.videoTrack?.samples ?? []
      const audioSamples = parsedSession.parsedMp4.audioTrack?.samples ?? []
      const interleavedSamples = interleaveSamplesByTimestamp(videoSamples, audioSamples)

      let videoSamplesReplayed = 0
      let audioSamplesReplayed = 0

      /*
       * Batch telemetry updates so the React commit cost does not dominate the
       * replay on files with tens of thousands of samples. The batch threshold
       * is deliberately generous so a twenty-second file produces only a
       * handful of intermediate commits.
       */
      const TELEMETRY_UPDATE_INTERVAL_SAMPLES = 256

      for (let interleavedIndex = 0; interleavedIndex < interleavedSamples.length; interleavedIndex += 1) {
        const currentEntry = interleavedSamples[interleavedIndex]
        if (currentEntry === undefined) {
          continue
        }
        if (currentEntry.kind === 'video') {
          muxer.addVideoSample({
            data: currentEntry.sample.data,
            timestamp: currentEntry.sample.timestampMicroseconds,
            duration: currentEntry.sample.durationMicroseconds,
            isKeyFrame: currentEntry.sample.isKeyFrame,
          })
          videoSamplesReplayed += 1
        } else {
          muxer.addAudioSample({
            data: currentEntry.sample.data,
            timestamp: currentEntry.sample.timestampMicroseconds,
            duration: currentEntry.sample.durationMicroseconds,
            isKeyFrame: currentEntry.sample.isKeyFrame,
          })
          audioSamplesReplayed += 1
        }
        if ((interleavedIndex + 1) % TELEMETRY_UPDATE_INTERVAL_SAMPLES === 0) {
          if (!isMountedRef.current) {
            return
          }
          setRebuildTelemetry({
            videoSamplesReplayed,
            audioSamplesReplayed,
          })
          /* Yield to the event loop so React can paint the updated counter. */
          await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0))
        }
      }

      await muxer.finalize()

      const finalizedBytes = new Uint8Array(outputTarget.buffer)
      const playbackBlob = new Blob([finalizedBytes], { type: 'video/mp4' })
      const objectUrl = URL.createObjectURL(playbackBlob)

      if (!isMountedRef.current) {
        URL.revokeObjectURL(objectUrl)
        return
      }

      setRebuildTelemetry({
        videoSamplesReplayed,
        audioSamplesReplayed,
      })
      setCompletedReplay({
        sourceFileName: parsedSession.sourceFileName,
        bytesWritten: finalizedBytes,
        objectUrl,
        videoSamplesReplayed,
        audioSamplesReplayed,
      })
      setPhase('stopped')
    } catch (unknownReason) {
      const reasonMessage = unknownReason instanceof Error ? unknownReason.message : String(unknownReason)
      if (!isMountedRef.current) {
        return
      }
      setErrorMessage(reasonMessage)
      setPhase('error')
    }
  }, [parsedSession, selectedFastStart])

  const handleSaveRebuiltFile = useCallback(async (): Promise<void> => {
    if (completedReplay === null) {
      return
    }
    await saveBytesToDisk(buildRebuiltFileName(completedReplay.sourceFileName), completedReplay.bytesWritten)
  }, [completedReplay])

  const handleFileInputChange = useCallback(
    (changeEvent: React.ChangeEvent<HTMLInputElement>): void => {
      const pickedFile = changeEvent.target.files?.[0]
      if (pickedFile === undefined) {
        return
      }
      void handleParseUploadedFile(pickedFile)
    },
    [handleParseUploadedFile]
  )

  const handleDropZoneClick = useCallback((): void => {
    fileInputElementRef.current?.click()
  }, [])

  const handleDropZoneKeyDown = useCallback((keyboardEvent: React.KeyboardEvent<HTMLDivElement>): void => {
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
      return
    }
    keyboardEvent.preventDefault()
    fileInputElementRef.current?.click()
  }, [])

  const handleDragOver = useCallback((dragEvent: React.DragEvent<HTMLDivElement>): void => {
    dragEvent.preventDefault()
    setIsDragActive(true)
  }, [])

  const handleDragLeave = useCallback((): void => {
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (dragEvent: React.DragEvent<HTMLDivElement>): void => {
      dragEvent.preventDefault()
      setIsDragActive(false)
      const droppedFile = dragEvent.dataTransfer.files[0]
      if (droppedFile === undefined) {
        return
      }
      void handleParseUploadedFile(droppedFile)
    },
    [handleParseUploadedFile]
  )

  return (
    <ScenarioFrame
      title="File Replay"
      description="Upload an existing AVC plus AAC MP4, extract its encoded samples, and replay them through the raw addVideoSample and addAudioSample APIs."
    >
      <div className={fileReplayStyles.layout}>
        {renderPhaseContent({
          phase,
          errorMessage,
          parsedSession,
          completedReplay,
          rebuildTelemetry,
          selectedFastStart,
          isDragActive,
          fileInputElementRef,
          onFileInputChange: handleFileInputChange,
          onDropZoneClick: handleDropZoneClick,
          onDropZoneKeyDown: handleDropZoneKeyDown,
          onDragOver: handleDragOver,
          onDragLeave: handleDragLeave,
          onDrop: handleDrop,
          onFastStartChange: setSelectedFastStart,
          onRebuild: () => void handleRebuildContainer(),
          onSave: () => void handleSaveRebuiltFile(),
          onReset: resetScenario,
        })}
      </div>
    </ScenarioFrame>
  )
}

/**
 * Inputs consumed by {@link renderPhaseContent}. Packaging the render inputs
 * inside a single record keeps the outer component body focused on state
 * transitions rather than branching UI.
 */
type PhaseRenderInputs = {
  phase: ReplayPhase
  errorMessage: string
  parsedSession: ParsedReplaySession | null
  completedReplay: CompletedReplay | null
  rebuildTelemetry: RebuildTelemetry
  selectedFastStart: SyntheticFastStart
  isDragActive: boolean
  fileInputElementRef: React.MutableRefObject<HTMLInputElement | null>
  onFileInputChange: (changeEvent: React.ChangeEvent<HTMLInputElement>) => void
  onDropZoneClick: () => void
  onDropZoneKeyDown: (keyboardEvent: React.KeyboardEvent<HTMLDivElement>) => void
  onDragOver: (dragEvent: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (dragEvent: React.DragEvent<HTMLDivElement>) => void
  onFastStartChange: (nextFastStart: SyntheticFastStart) => void
  onRebuild: () => void
  onSave: () => void
  onReset: () => void
}

/**
 * Renders the correct card layout for the current replay phase. A single
 * `Record<ReplayPhase, () => React.ReactElement>` dispatch table keeps the
 * phase-to-view mapping centralised so new phases are added in one place.
 *
 * @param inputs - Current phase plus the session data and callbacks needed to
 *   render it.
 * @returns The JSX for the active phase.
 */
function renderPhaseContent(inputs: PhaseRenderInputs) {
  const dropZoneCard = (
    <Card radius="medium" shadow="subtle">
      <div
        className={`${fileReplayStyles.dropZone} ${inputs.isDragActive ? fileReplayStyles.dropZoneActive : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload an MP4 file"
        onClick={inputs.onDropZoneClick}
        onKeyDown={inputs.onDropZoneKeyDown}
        onDragOver={inputs.onDragOver}
        onDragEnter={inputs.onDragOver}
        onDragLeave={inputs.onDragLeave}
        onDrop={inputs.onDrop}
      >
        <h2 className={fileReplayStyles.dropZoneHeading}>Drop an MP4 here</h2>
        <p className={fileReplayStyles.dropZoneHint}>
          Or click to browse. Expects one AVC video track and one AAC audio track.
        </p>
        <input
          ref={inputs.fileInputElementRef}
          type="file"
          accept="video/mp4"
          className={fileReplayStyles.fileInput}
          onChange={inputs.onFileInputChange}
        />
      </div>
    </Card>
  )

  const fastStartSelectorCard = (nextAction: 'ready' | 'rebuilding') => (
    <Card radius="medium" shadow="subtle">
      <div className={fileReplayStyles.statusCard}>
        <h2 className={fileReplayStyles.statusHeading}>Rebuild options</h2>
        <p className={fileReplayStyles.statusMessage}>
          Pick the fast-start mode for the rebuilt container. Progressive mode is omitted because the ArrayBufferTarget
          seek method is a documented no-op.
        </p>
        <CodecSelector<SyntheticFastStart>
          label="Fast start mode"
          options={FAST_START_OPTIONS}
          value={inputs.selectedFastStart}
          onChange={inputs.onFastStartChange}
        />
        {inputs.parsedSession !== null ? <Stats entries={buildParsedSessionStats(inputs.parsedSession)} /> : null}
        <div className={fileReplayStyles.actionRow}>
          <DarkButton onClick={inputs.onRebuild} disabled={nextAction === 'rebuilding'}>
            {nextAction === 'rebuilding' ? 'Rebuilding...' : 'Rebuild MP4'}
          </DarkButton>
          <PillButton variant="nav" onClick={inputs.onReset}>
            Choose another file
          </PillButton>
        </div>
      </div>
    </Card>
  )

  const phaseRenderers: Record<ReplayPhase, () => React.ReactElement> = {
    idle: () =>
      inputs.parsedSession === null ? (
        dropZoneCard
      ) : (
        <>
          <Card radius="medium" shadow="subtle">
            <div className={fileReplayStyles.statusCard}>
              <h2 className={fileReplayStyles.statusHeading}>Parsed source</h2>
              <p className={fileReplayStyles.statusMessage}>
                <span className={fileReplayStyles.sourceFileName}>{inputs.parsedSession.sourceFileName}</span> is ready
                to replay. Review the totals and choose a fast-start mode, then rebuild.
              </p>
            </div>
          </Card>
          {fastStartSelectorCard('ready')}
        </>
      ),
    parsing: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fileReplayStyles.statusCard}>
          <h2 className={fileReplayStyles.statusHeading}>Parsing MP4</h2>
          <p className={fileReplayStyles.statusMessage}>
            Walking the top-level boxes, reading the sample tables, and slicing the encoded sample bytes out of the
            source container.
          </p>
        </div>
      </Card>
    ),
    rebuilding: () => (
      <>
        <Card radius="medium" shadow="subtle">
          <div className={fileReplayStyles.statusCard}>
            <h2 className={fileReplayStyles.statusHeading}>Replaying samples</h2>
            <Stats entries={buildRebuildTelemetryStats(inputs.rebuildTelemetry)} />
            <p className={fileReplayStyles.helperText}>
              Samples are fed through addVideoSample and addAudioSample in ascending timestamp order so fragmented mode
              emits well-ordered moof boxes.
            </p>
          </div>
        </Card>
        {fastStartSelectorCard('rebuilding')}
      </>
    ),
    stopped: () => (
      <>
        <Card radius="medium" shadow="glow">
          <div className={fileReplayStyles.previewCard}>
            <h2 className={fileReplayStyles.previewHeading}>Rebuilt playback</h2>
            {inputs.completedReplay !== null ? (
              <video
                key={inputs.completedReplay.objectUrl}
                className={fileReplayStyles.previewVideo}
                src={inputs.completedReplay.objectUrl}
                controls
                playsInline
              />
            ) : null}
          </div>
        </Card>
        <Card radius="medium" shadow="subtle">
          <div className={fileReplayStyles.statusCard}>
            <h2 className={fileReplayStyles.statusHeading}>Summary</h2>
            {inputs.completedReplay !== null ? (
              <Stats entries={buildCompletedReplayStats(inputs.completedReplay)} />
            ) : null}
            <div className={fileReplayStyles.actionRow}>
              <DarkButton onClick={inputs.onSave}>Save MP4</DarkButton>
              <PillButton variant="nav-active" onClick={inputs.onReset}>
                Replay another file
              </PillButton>
            </div>
            <p className={fileReplayStyles.helperText}>
              The save dialog uses the File System Access API when available and falls back to a Blob download in other
              browsers.
            </p>
          </div>
        </Card>
      </>
    ),
    error: () => (
      <Card radius="medium" shadow="subtle">
        <div className={fileReplayStyles.statusCard}>
          <h2 className={fileReplayStyles.statusHeading}>Replay failed</h2>
          <p className={fileReplayStyles.errorMessage}>
            {inputs.errorMessage !== '' ? inputs.errorMessage : 'An unknown error occurred while replaying the file.'}
          </p>
          <div className={fileReplayStyles.actionRow}>
            <PillButton variant="nav-active" onClick={inputs.onReset}>
              Try another file
            </PillButton>
          </div>
        </div>
      </Card>
    ),
  }

  return phaseRenderers[inputs.phase]()
}

/**
 * Builds the {@link StatsEntry} list shown once the source file has been
 * parsed but before the rebuild starts.
 *
 * @param parsedSession - The parsed session produced by {@link parseMp4Bytes}.
 * @returns The readout entries.
 */
function buildParsedSessionStats(parsedSession: ParsedReplaySession): readonly StatsEntry[] {
  const videoTrack = parsedSession.parsedMp4.videoTrack
  const audioTrack = parsedSession.parsedMp4.audioTrack
  const videoSummary =
    videoTrack !== null
      ? `${videoTrack.width}x${videoTrack.height}, ${parsedSession.totalVideoSampleCount} samples`
      : 'absent'
  const audioSummary =
    audioTrack !== null
      ? `${audioTrack.channels}ch at ${audioTrack.sampleRate} Hz, ${parsedSession.totalAudioSampleCount} samples`
      : 'absent'
  return [
    { label: 'Video track', value: videoSummary },
    { label: 'Audio track', value: audioSummary },
  ]
}

/**
 * Builds the {@link StatsEntry} list for the in-flight rebuild telemetry.
 * The rebuild loop only updates the sample counters between yields, so the
 * bytes-written total is omitted here and surfaced on the completed-summary
 * card once the muxer finalizes and the final buffer length is known.
 *
 * @param rebuildTelemetry - Live replay counters.
 * @returns The readout entries.
 */
function buildRebuildTelemetryStats(rebuildTelemetry: RebuildTelemetry): readonly StatsEntry[] {
  return [
    {
      label: 'Video samples',
      value: rebuildTelemetry.videoSamplesReplayed.toLocaleString(),
    },
    {
      label: 'Audio samples',
      value: rebuildTelemetry.audioSamplesReplayed.toLocaleString(),
    },
  ]
}

/**
 * Builds the {@link StatsEntry} list shown on the completed-replay summary
 * card.
 *
 * @param completedReplay - The rebuild result.
 * @returns The readout entries.
 */
function buildCompletedReplayStats(completedReplay: CompletedReplay): readonly StatsEntry[] {
  return [
    {
      label: 'Video samples',
      value: completedReplay.videoSamplesReplayed.toLocaleString(),
    },
    {
      label: 'Audio samples',
      value: completedReplay.audioSamplesReplayed.toLocaleString(),
    },
    {
      label: 'Bytes written',
      value: formatBytes(completedReplay.bytesWritten.byteLength),
    },
  ]
}

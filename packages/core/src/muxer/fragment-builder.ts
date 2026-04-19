import { writeBox } from '@/boxes/box'
import { MDAT_HEADER_SIZE_32, writeMdatHeader32 } from '@/boxes/mdat'
import { createMfhd } from '@/boxes/mfhd'
import { createMoof } from '@/boxes/moof'
import { createTfdt } from '@/boxes/tfdt'
import { createTfhd } from '@/boxes/tfhd'
import { createTraf } from '@/boxes/traf'
import { createTrun, encodeTrunSampleFlags, type TrunSample } from '@/boxes/trun'
import { Writer } from '@/io/writer'
import { StateError } from '@/types/errors'

/**
 * Per-track identity and timing information supplied to a {@link FragmentBuilder} at
 * construction time.
 */
export type FragmentTrackSpec = {
  /** Track identifier, matching the `tkhd.trackId` of the corresponding `trak` box. */
  trackId: number
  /** Track timescale in ticks per second. Sample durations are converted from microseconds to this unit. */
  timescale: number
  /**
   * Whether this is a video track, used to decide keyframe semantics. Audio tracks treat
   * every frame as a sync sample.
   */
  isVideo: boolean
}

/**
 * Options for constructing a {@link FragmentBuilder}.
 */
export type FragmentBuilderOptions = {
  /** One entry per track in the movie. Order is preserved in every `moof.traf[]` that follows. */
  tracks: FragmentTrackSpec[]
  /**
   * Minimum elapsed microseconds since the last flush before a new fragment may be flushed.
   * Set to 0 to flush on every keyframe, or to a larger value to bound fragment count for
   * long recordings. WebCodecs uses microseconds as its timestamp unit.
   *
   * @see {@link https://w3c.github.io/webcodecs/#timestamps | WebCodecs timestamps}
   */
  minimumFragmentDurationMicroseconds: number
}

/**
 * A sample ready to be appended to the currently pending fragment.
 */
export type FragmentSampleInput = {
  /** Track identifier the sample belongs to. Must match one of the configured tracks. */
  trackId: number
  /** Sample timestamp in microseconds, matching the WebCodecs convention. */
  timestampMicroseconds: number
  /** Sample duration in microseconds. */
  durationMicroseconds: number
  /** Whether this sample is a sync (random-access) sample. Audio callers pass `true` for every frame. */
  isKeyFrame: boolean
  /** Encoded sample bytes. */
  data: Uint8Array
}

/**
 * Lightweight variant of {@link FragmentSampleInput} used by
 * {@link FragmentBuilder.shouldFlushBefore}. Instead of carrying the sample bytes this
 * variant carries only the byte length, so the caller can ask whether appending this
 * sample would cross a fragment boundary without allocating.
 */
export type FragmentSamplePreview = {
  /** Track identifier the sample belongs to. Must match one of the configured tracks. */
  trackId: number
  /** Sample timestamp in microseconds, matching the WebCodecs convention. */
  timestampMicroseconds: number
  /** Sample duration in microseconds. */
  durationMicroseconds: number
  /** Whether this sample is a sync (random-access) sample. Audio callers pass `true` for every frame. */
  isKeyFrame: boolean
  /** Encoded sample byte length, used to weigh fragment-size heuristics without allocating. */
  dataByteLength: number
}

/**
 * The byte payload and metadata describing a single flushed fragment.
 */
export type FragmentFlushResult = {
  /** The serialized `moof` plus `mdat` bytes, ready to be written to the target. */
  bytes: Uint8Array
  /** The `mfhd.sequence_number` of this fragment. */
  sequenceNumber: number
  /**
   * Byte length of the serialized `moof` portion only. Used by the outer muxer to populate
   * `tfra` random-access entries.
   */
  moofByteLength: number
  /**
   * Per-track first-sample decode time in the track timescale for this fragment, used to
   * populate `tfra` random-access entries.
   */
  firstSampleDecodeTimesByTrackId: Map<number, bigint>
}

type PendingSample = {
  timestampMicroseconds: number
  durationMicroseconds: number
  isKeyFrame: boolean
  data: Uint8Array
}

type TrackState = {
  spec: FragmentTrackSpec
  pendingSamples: PendingSample[]
  cumulativeDurationInTrackTimescale: bigint
}

/**
 * Accumulates per-track samples and emits `moof` plus `mdat` byte pairs on demand.
 *
 * The builder is intentionally synchronous and target-agnostic. Callers hand it samples
 * via {@link FragmentBuilder.appendSample}, consult {@link FragmentBuilder.shouldFlushBefore}
 * to decide when to cut a fragment, and call {@link FragmentBuilder.flush} to serialize
 * the pending samples and advance the sequence number.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link https://w3c.github.io/mse-byte-stream-format-isobmff/ | MSE byte stream format for ISO BMFF}
 */
export class FragmentBuilder {
  private readonly minimumFragmentDurationMicroseconds: number
  private readonly trackStatesById: Map<number, TrackState>
  private readonly orderedTrackIds: number[]
  private nextSequenceNumber = 1
  private currentFragmentStartTimestampMicroseconds: number | null = null

  /**
   * Constructs a fragment builder.
   *
   * @param options - Per-track specs and the minimum duration gate between flushes.
   */
  constructor(options: FragmentBuilderOptions) {
    this.minimumFragmentDurationMicroseconds = options.minimumFragmentDurationMicroseconds
    this.trackStatesById = new Map()
    this.orderedTrackIds = []
    for (const trackSpec of options.tracks) {
      this.trackStatesById.set(trackSpec.trackId, {
        spec: trackSpec,
        pendingSamples: [],
        cumulativeDurationInTrackTimescale: 0n,
      })
      this.orderedTrackIds.push(trackSpec.trackId)
    }
  }

  /**
   * Returns `true` when appending the described sample should trigger a flush of the
   * currently pending fragment.
   *
   * @remarks
   * The rule implements the spec-level contract. A fragment boundary may be placed only at
   * a keyframe, and at least `minimumFragmentDurationMicroseconds` of media must have
   * elapsed since the previous flush. Audio-only files treat every sample as a keyframe,
   * so the duration check is the only effective gate.
   *
   * @param preview - Metadata for the sample about to be appended.
   * @returns Whether the caller should flush the pending fragment before appending.
   */
  shouldFlushBefore(preview: FragmentSamplePreview): boolean {
    if (this.currentFragmentStartTimestampMicroseconds === null) {
      return false
    }
    if (!preview.isKeyFrame) {
      return false
    }
    const elapsedMicroseconds = preview.timestampMicroseconds - this.currentFragmentStartTimestampMicroseconds
    return elapsedMicroseconds >= this.minimumFragmentDurationMicroseconds
  }

  /**
   * Appends a sample to the currently pending fragment. The caller is responsible for
   * consulting {@link FragmentBuilder.shouldFlushBefore} and calling
   * {@link FragmentBuilder.flush} before appending the sample when a flush is warranted.
   *
   * @param sample - The sample to append.
   * @throws Error When `sample.trackId` does not match any track declared at construction.
   */
  appendSample(sample: FragmentSampleInput): void {
    const trackState = this.trackStatesById.get(sample.trackId)
    if (!trackState) {
      throw new Error(`FragmentBuilder received sample for unknown trackId ${sample.trackId}`)
    }
    if (this.currentFragmentStartTimestampMicroseconds === null) {
      this.currentFragmentStartTimestampMicroseconds = sample.timestampMicroseconds
    }
    trackState.pendingSamples.push({
      timestampMicroseconds: sample.timestampMicroseconds,
      durationMicroseconds: sample.durationMicroseconds,
      isKeyFrame: sample.isKeyFrame,
      data: sample.data,
    })
  }

  /**
   * Serializes every track's pending samples as a single `moof` plus `mdat` fragment,
   * advances the sequence number, and resets the pending buffers.
   *
   * @returns The flushed fragment bytes and metadata, or `null` when no samples are
   *   pending across any track.
   */
  flush(): FragmentFlushResult | null {
    const tracksWithSamples = this.orderedTrackIds
      .map((trackId) => {
        const trackState = this.trackStatesById.get(trackId)
        if (trackState === undefined) {
          throw new StateError(
            `FragmentBuilder invariant broken: track id ${trackId} is listed in orderedTrackIds but absent from trackStatesById.`
          )
        }
        return trackState
      })
      .filter((trackState) => trackState.pendingSamples.length > 0)
    if (tracksWithSamples.length === 0) {
      return null
    }

    const sequenceNumber = this.nextSequenceNumber++

    // The trun flag combination produces a stable per-sample record size, so the moof
    // byte length is deterministic before the trun bodies are written.
    const perTrackBodyByteLengths = tracksWithSamples.map((trackState) => {
      const sampleCount = trackState.pendingSamples.length
      const trafHeaderBytes = 8
      const tfhdBytes = 16
      const tfdtBytes = 20
      const trunBytes = 8 + 4 + 4 + 4 + sampleCount * 12
      return trafHeaderBytes + tfhdBytes + tfdtBytes + trunBytes
    })
    const mfhdBytes = 16
    const moofHeaderBytes = 8
    const moofByteLength =
      moofHeaderBytes + mfhdBytes + perTrackBodyByteLengths.reduce((total, value) => total + value, 0)

    const firstSampleDecodeTimesByTrackId = new Map<number, bigint>()
    const trafBoxes = tracksWithSamples.map((trackState, trackIndex) => {
      const firstSampleDecodeTime = trackState.cumulativeDurationInTrackTimescale
      firstSampleDecodeTimesByTrackId.set(trackState.spec.trackId, firstSampleDecodeTime)

      const trunSamples: TrunSample[] = trackState.pendingSamples.map((pending) => {
        const sampleDurationInTrackTimescale = Math.round(
          (pending.durationMicroseconds * trackState.spec.timescale) / 1_000_000
        )
        trackState.cumulativeDurationInTrackTimescale += BigInt(sampleDurationInTrackTimescale)
        return {
          duration: sampleDurationInTrackTimescale,
          size: pending.data.length,
          // Audio callers pass isKeyFrame:true for every sample, so the ternary collapses
          // to `true` for audio tracks regardless of the caller's value.
          flags: encodeTrunSampleFlags(trackState.spec.isVideo ? pending.isKeyFrame : true),
        }
      })

      const precedingTrackSampleBytes = tracksWithSamples.slice(0, trackIndex).reduce((total, precedingTrack) => {
        let runningTotal = total
        for (const precedingSample of precedingTrack.pendingSamples) {
          runningTotal += precedingSample.data.length
        }
        return runningTotal
      }, 0)
      const trunDataOffset = moofByteLength + MDAT_HEADER_SIZE_32 + precedingTrackSampleBytes

      return createTraf({
        tfhd: createTfhd({ trackId: trackState.spec.trackId }),
        tfdt: createTfdt({ baseMediaDecodeTimeInTrackTimescale: firstSampleDecodeTime }),
        trun: createTrun({ dataOffset: trunDataOffset, samples: trunSamples }),
      })
    })

    const moofBox = createMoof({
      mfhd: createMfhd({ sequenceNumber }),
      trafs: trafBoxes,
    })
    const moofWriter = new Writer()
    writeBox(moofWriter, moofBox)
    const actualMoofByteLength = moofWriter.length
    if (actualMoofByteLength !== moofByteLength) {
      throw new Error(`FragmentBuilder moof size mismatch: predicted ${moofByteLength}, wrote ${actualMoofByteLength}`)
    }

    let totalSampleBytes = 0
    for (const trackState of tracksWithSamples) {
      for (const pending of trackState.pendingSamples) totalSampleBytes += pending.data.length
    }
    const mdatHeaderWriter = new Writer()
    writeMdatHeader32(mdatHeaderWriter, MDAT_HEADER_SIZE_32 + totalSampleBytes)

    const fragmentBytes = new Uint8Array(actualMoofByteLength + MDAT_HEADER_SIZE_32 + totalSampleBytes)
    fragmentBytes.set(moofWriter.toBytes(), 0)
    fragmentBytes.set(mdatHeaderWriter.toBytes(), actualMoofByteLength)
    let sampleWriteCursor = actualMoofByteLength + MDAT_HEADER_SIZE_32
    for (const trackState of tracksWithSamples) {
      for (const pending of trackState.pendingSamples) {
        fragmentBytes.set(pending.data, sampleWriteCursor)
        sampleWriteCursor += pending.data.length
      }
      trackState.pendingSamples = []
    }

    this.currentFragmentStartTimestampMicroseconds = null

    return {
      bytes: fragmentBytes,
      sequenceNumber,
      moofByteLength: actualMoofByteLength,
      firstSampleDecodeTimesByTrackId,
    }
  }

  /**
   * Returns whether the builder currently holds at least one pending sample.
   *
   * @returns `true` when at least one track has a pending sample awaiting a flush.
   */
  hasPendingSamples(): boolean {
    for (const trackState of this.trackStatesById.values()) {
      if (trackState.pendingSamples.length > 0) {
        return true
      }
    }
    return false
  }
}

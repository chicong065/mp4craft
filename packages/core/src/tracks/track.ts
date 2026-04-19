import type { Box } from '@/boxes/box'
import { createHdlr } from '@/boxes/hdlr'
import { createMdhd } from '@/boxes/mdhd'
import { createMdia } from '@/boxes/mdia'
import { createMinf } from '@/boxes/minf'
import { createStbl } from '@/boxes/stbl'
import { createStco, createCo64 } from '@/boxes/stco'
import { createStsc } from '@/boxes/stsc'
import { createStsd } from '@/boxes/stsd'
import { createStss } from '@/boxes/stss'
import { createStsz } from '@/boxes/stsz'
import { createStts } from '@/boxes/stts'
import { createTkhd } from '@/boxes/tkhd'
import { createTrak } from '@/boxes/trak'
import type { Codec } from '@/codecs/codec'
import { SampleTable, type SampleInfo } from '@/tracks/sample-table'
import { TimestampTracker, type FirstTimestampBehavior } from '@/tracks/timestamp-tracker'

/**
 * Options shared by both {@link VideoTrack} and {@link AudioTrack} constructors.
 */
export type TrackOptions = {
  /** Track identifier written into the `tkhd` box (MP4 track IDs are 1-based). */
  trackId: number
  /** Codec adapter that produces the `stsd` sample entry for this track. */
  codec: Codec
  /**
   * Media timescale in ticks per second. Sample durations and the `mdhd` duration are all
   * expressed in this unit.
   */
  timescale: number
  /** Policy describing how the first observed sample timestamp is handled. */
  firstTimestampBehavior: FirstTimestampBehavior
  /**
   * ISO 639-2/T three-letter language code written into `mdhd`. Defaults to `"und"`
   * (undetermined) when omitted.
   */
  language?: string
  /**
   * Displayed width in pixels, written into `tkhd` as 16.16 fixed-point. Optional and
   * irrelevant for audio tracks.
   */
  width?: number
  /**
   * Displayed height in pixels, written into `tkhd` as 16.16 fixed-point. Optional and
   * irrelevant for audio tracks.
   */
  height?: number
}

/**
 * A sample handed to {@link Track.appendSample} by the muxer after the raw bytes have been
 * committed to the container's sample region.
 */
export type AppendedSample = {
  /** Encoded sample bytes. Only the length is recorded by the track, not the bytes themselves. */
  data: Uint8Array
  /** Presentation timestamp in microseconds, following the WebCodecs convention. */
  timestamp: number
  /** Sample duration in microseconds, following the WebCodecs convention. */
  duration: number
  /** True when the sample is a keyframe (random-access point). */
  isKeyFrame: boolean
  /**
   * Byte offset of this sample's chunk. Absolute (from the start of the file) in progressive
   * mode, relative to the in-memory sample buffer in `fastStart: "in-memory"` mode. The track
   * stores the value as given, and {@link Track.buildTrak} adds the `chunkOffsetBase` at
   * build time.
   */
  chunkOffset: number
}

/**
 * Abstract base class for media tracks.
 *
 * Concrete subclasses ({@link VideoTrack}, {@link AudioTrack}) supply the media header box
 * (`vmhd` or `smhd`) and the handler type fourcc (`vide` or `soun`). The base class owns the
 * {@link SampleTable} and {@link TimestampTracker} instances and orchestrates `appendSample`
 * calls plus the final `trak` build.
 */
export abstract class Track {
  protected readonly sampleTable: SampleTable
  protected readonly timestampTracker: TimestampTracker

  /**
   * Constructs the track state. Called only by subclass constructors.
   *
   * @param options - Shared track configuration.
   * @param isVideoTrack - Whether the track is a video track. Passed to the sample table so it
   *   knows whether to accumulate a sync-sample list for `stss`.
   */
  constructor(
    protected readonly options: TrackOptions,
    isVideoTrack: boolean
  ) {
    this.sampleTable = new SampleTable({ isVideo: isVideoTrack })
    this.timestampTracker = new TimestampTracker(options.firstTimestampBehavior)
  }

  /**
   * Records one encoded sample in the track's sample table.
   *
   * Called by the muxer once per encoded chunk after the payload bytes have been committed to
   * the container. The raw timestamp is first routed through the
   * {@link TimestampTracker#adjust | first-timestamp policy}, the microsecond duration is
   * converted to the track's media timescale, then the resulting {@link SampleInfo} is pushed
   * into the {@link SampleTable}.
   *
   * @param appendedSample - The sample metadata, including data length, timing, keyframe flag,
   *   and chunk offset.
   * @returns The {@link SampleInfo} actually stored in the sample table, with durations in the
   *   media timescale.
   * @throws {@link StateError} When the first-timestamp policy is `"strict"` and the first
   *   sample timestamp is non-zero.
   */
  appendSample(appendedSample: AppendedSample): SampleInfo {
    this.timestampTracker.adjust(appendedSample.timestamp)
    const durationInTimescale = Math.round((appendedSample.duration * this.options.timescale) / 1_000_000)
    const sampleInfo: SampleInfo = {
      size: appendedSample.data.length,
      duration: durationInTimescale,
      isKeyFrame: appendedSample.isKeyFrame,
      chunkOffset: appendedSample.chunkOffset,
    }
    this.sampleTable.addSample(sampleInfo)
    return sampleInfo
  }

  /** Four-character handler type, either `"vide"` (video) or `"soun"` (audio). */
  abstract get handlerType(): 'vide' | 'soun'
  /** Media header child box of `minf`: `vmhd` for video, `smhd` for audio. */
  abstract get mediaHeader(): Box
  /** Discriminant used internally for video-only logic (for example, `stss` emission). */
  abstract get isVideo(): boolean

  /**
   * Track identifier. Matches the `tkhd.trackId` of the emitted `trak` box and is unique
   * within a movie.
   */
  get trackId(): number {
    return this.options.trackId
  }

  /**
   * Track timescale in ticks per second. Sample durations are converted from microseconds
   * to this unit before being written into `stts` or `trun` entries.
   */
  get timescale(): number {
    return this.options.timescale
  }

  /**
   * Finalizes the track's sample table and emits the `trak` box.
   *
   * Supports the two-pass build used by `fastStart: "in-memory"` mode. Any optional
   * `chunkOffsetBase` is added to every stored chunk offset so the same accumulated sample-
   * table state can be reused across passes without duplication. If any resulting absolute
   * offset exceeds `0xFFFFFFFF`, the builder automatically switches from `stco` to the 64-bit
   * `co64` variant.
   *
   * @param buildContext - The movie timescale (used to convert the track duration for `tkhd`)
   *   and an optional additive base for chunk offsets. When omitted, offsets are emitted
   *   as-stored.
   * @returns The assembled `trak` box along with the track duration in the media timescale
   *   and in the movie timescale.
   */
  buildTrak(buildContext: { movieTimescale: number; chunkOffsetBase?: number }): {
    trak: Box
    durationInTimescale: number
    durationInMovieTimescale: number
  } {
    const buildResult = this.sampleTable.build()
    const chunkOffsetBase = buildContext.chunkOffsetBase ?? 0
    const absoluteChunkOffsets = buildResult.chunkOffsets.map((storedOffset) => storedOffset + chunkOffsetBase)
    const needsCo64 = absoluteChunkOffsets.some((offset) => offset > 0xffffffff)
    const stsd = createStsd(this.options.codec.createSampleEntry())
    const stts = createStts(buildResult.sttsEntries)
    const stsc = createStsc(buildResult.stscEntries)
    const stsz = createStsz({ sizes: buildResult.sampleSizes })
    const stco = needsCo64
      ? createCo64(absoluteChunkOffsets.map((offset) => BigInt(offset)))
      : createStco(absoluteChunkOffsets)
    const stss = this.isVideo && buildResult.syncSamples ? createStss(buildResult.syncSamples) : undefined
    const stbl = createStbl({ stsd, stts, stsc, stsz, stco, ...(stss ? { stss } : {}) })

    const mdhd = createMdhd({
      timescale: this.options.timescale,
      duration: buildResult.totalDuration,
      language: this.options.language ?? 'und',
    })
    const hdlr = createHdlr({
      handlerType: this.handlerType,
      name: this.isVideo ? 'VideoHandler' : 'SoundHandler',
    })
    const minf = createMinf({ mediaHeader: this.mediaHeader, stbl })
    const mdia = createMdia({ mdhd, hdlr, minf })

    const durationInMovieTimescale = Math.round(
      (buildResult.totalDuration * buildContext.movieTimescale) / this.options.timescale
    )

    const tkhd = createTkhd({
      trackId: this.options.trackId,
      duration: durationInMovieTimescale,
      width: this.isVideo ? this.videoWidth : 0,
      height: this.isVideo ? this.videoHeight : 0,
      isAudio: !this.isVideo,
    })
    const trak = createTrak({ tkhd, mdia })
    return { trak, durationInTimescale: buildResult.totalDuration, durationInMovieTimescale }
  }

  /**
   * Displayed video width for the `tkhd` box. Audio tracks return `0` (no display region).
   * Subclasses override to source the value from {@link TrackOptions.width}.
   */
  protected get videoWidth(): number {
    return 0
  }
  /**
   * Displayed video height for the `tkhd` box. Audio tracks return `0` (no display region).
   * Subclasses override to source the value from {@link TrackOptions.height}.
   */
  protected get videoHeight(): number {
    return 0
  }
}

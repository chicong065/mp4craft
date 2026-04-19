import { writeBox, type Box } from '@/boxes/box'
import { createFtyp } from '@/boxes/ftyp'
import { MDAT_HEADER_SIZE_32, writeMdatHeader32 } from '@/boxes/mdat'
import { createMfra } from '@/boxes/mfra'
import { createMoov } from '@/boxes/moov'
import { createMvex } from '@/boxes/mvex'
import { createMvhd } from '@/boxes/mvhd'
import { createTfra, type TfraEntry } from '@/boxes/tfra'
import { createTrex } from '@/boxes/trex'
import { computeCompatibleBrands, createAudioCodec, createVideoCodec } from '@/codecs/factory'
import { Writer } from '@/io/writer'
import { FragmentBuilder, type FragmentTrackSpec } from '@/muxer/fragment-builder'
import { StateMachine } from '@/muxer/state-machine'
import { StreamTarget } from '@/targets/stream-target'
import type { Target } from '@/targets/target'
import { AudioTrack } from '@/tracks/audio-track'
import type { Track } from '@/tracks/track'
import { VideoTrack } from '@/tracks/video-track'
import type { VideoSampleInput, AudioSampleInput } from '@/types/chunk'
import type { MuxerOptions } from '@/types/config'
import { assertNever, ConfigError, StateError } from '@/types/errors'

const MOVIE_TIMESCALE = 1000

/**
 * Orchestrates MP4 / ISO BMFF container output for a single video track, a single audio track,
 * or both. Samples are written to the supplied `target` either progressively (the default,
 * with `moov` at end of file), buffered for a fast-start layout (`moov` before `mdat`), or
 * emitted as a fragmented MP4 (`ftyp` plus empty `moov` up front followed by one `moof` plus
 * `mdat` per fragment, closed out with an `mfra` random-access index at end of file).
 *
 * @typeParam T - The concrete `Target` type, preserved on the returned `muxer.target` so that
 *   built-in targets such as `ArrayBufferTarget` expose their output type-safely.
 *
 * @remarks
 * Supported codecs in the current release: AVC (H.264), HEVC (H.265), VP9, and AV1 for
 * video, plus AAC, Opus, MP3, FLAC, and raw integer PCM for audio. Fragmented MP4 is
 * available via `fastStart: "fragmented"`, which suits live-streaming and multi-hour
 * recordings because memory use stays bounded by
 * {@link MuxerOptions.minimumFragmentDuration}.
 *
 * @example
 * ```ts
 * const target = new ArrayBufferTarget();
 * const muxer = new Mp4Muxer({
 *   target,
 *   fastStart: "in-memory",
 *   video: { codec: "avc", width: 1920, height: 1080, description: avcConfigRecord },
 * });
 * muxer.addVideoChunk(encodedChunk, metadata);
 * await muxer.finalize();
 * const mp4Bytes = new Uint8Array(target.buffer);
 * ```
 *
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification (EncodedVideoChunk, EncodedAudioChunk)}
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4 Registration Authority sample-entry registry}
 * @see {@link https://w3c.github.io/mse-byte-stream-format-isobmff/ | MSE byte stream format for ISO BMFF}
 * @see ISO/IEC 14496-12 (ISO Base Media File Format), the definitive specification for ftyp, moov, mdat, trak, and the full box hierarchy.
 */
export class Mp4Muxer<T extends Target = Target> {
  /**
   * The `Target` instance passed to the constructor, preserved with its concrete type.
   * Access `target.buffer` on an `ArrayBufferTarget` after `finalize()` to retrieve the
   * produced MP4 bytes.
   */
  readonly target: T
  private readonly stateMachine = new StateMachine()
  private readonly videoTrack?: VideoTrack
  private readonly audioTrack?: AudioTrack
  private readonly tracks: Track[] = []
  private readonly inMemorySampleWriter: Writer | null
  /**
   * Set in `fastStart: "fragmented"` mode. Owns per-track sample accumulation and fragment
   * serialization. Null in the other two modes.
   */
  private readonly fragmentBuilder: FragmentBuilder | null
  /**
   * Per-track random-access entries accumulated during fragmented writes. One entry is
   * recorded for every track on every fragment flush, pointing at the fragment's `moof`
   * byte offset and the track's first-sample decode time. The collected entries are
   * serialized as a tail `mfra` block during {@link Mp4Muxer.finalizeFragmented}.
   *
   * Null in every mode other than `fastStart: "fragmented"`.
   */
  private readonly tfraEntriesByTrackId: Map<number, TfraEntry[]> | null

  private mdatHeaderOffset = 0
  private mdatSize = 0
  private writeCursor = 0
  /**
   * Promise chain used in fragmented mode to serialize asynchronous writes against targets
   * such as {@link StreamTarget} that report completion via a returned promise. Each write
   * request appended to the chain runs only after the previous one has settled, which keeps
   * the sequential-offset invariant of {@link StreamTarget} intact even though the surface
   * API of `addVideoSample` / `addAudioSample` is synchronous.
   */
  private fragmentedWriteChain: Promise<void> = Promise.resolve()

  /**
   * Constructs a muxer for the given tracks and container mode.
   *
   * @param options - Container configuration: target sink, optional video and audio track
   *   descriptors, fast-start mode, and first-timestamp policy. At least one of
   *   `options.video` or `options.audio` must be provided.
   *
   * @throws {@link ConfigError} When no track is configured, or when `fastStart: false`
   *   (progressive) is used with a non-seekable target such as `StreamTarget`.
   */
  constructor(private readonly options: MuxerOptions<T>) {
    this.target = options.target
    validateOptions(options)

    if (options.video) {
      const codec = createVideoCodec(options.video)
      this.videoTrack = new VideoTrack({
        trackId: 1,
        codec,
        timescale: options.video.timescale ?? 90000,
        firstTimestampBehavior: options.firstTimestampBehavior ?? 'offset',
        width: options.video.width,
        height: options.video.height,
      })
      this.tracks.push(this.videoTrack)
    }
    if (options.audio) {
      const codec = createAudioCodec(options.audio)
      this.audioTrack = new AudioTrack({
        trackId: this.videoTrack ? 2 : 1,
        codec,
        timescale: options.audio.timescale ?? options.audio.sampleRate,
        firstTimestampBehavior: options.firstTimestampBehavior ?? 'offset',
      })
      this.tracks.push(this.audioTrack)
    }

    const fastStartValue = options.fastStart ?? false
    switch (fastStartValue) {
      case 'fragmented': {
        this.inMemorySampleWriter = null
        this.fragmentBuilder = createFragmentBuilder(options, this.tracks)
        const tfraEntriesByTrackId = new Map<number, TfraEntry[]>()
        for (const track of this.tracks) {
          tfraEntriesByTrackId.set(track.trackId, [])
        }
        this.tfraEntriesByTrackId = tfraEntriesByTrackId
        this.writeFtypAndEmptyMoovForFragmentedMode(options)
        break
      }
      case 'in-memory':
        this.inMemorySampleWriter = new Writer()
        this.fragmentBuilder = null
        this.tfraEntriesByTrackId = null
        break
      case false:
        this.inMemorySampleWriter = null
        this.fragmentBuilder = null
        this.tfraEntriesByTrackId = null
        this.writeHeaderAndMdatPlaceholder()
        break
      default:
        assertNever(fastStartValue, `Unsupported fastStart: ${String(fastStartValue)}`)
    }
  }

  /**
   * Appends a WebCodecs `EncodedVideoChunk` to the configured video track.
   *
   * @param chunk - An encoded video chunk produced by `VideoEncoder.output`.
   * @param _metadata - Present to match the WebCodecs `VideoEncoder.output` callback signature.
   *   Its fields are not consumed by the muxer because the decoder configuration is already
   *   supplied up front via `MuxerOptions.video.description`.
   *
   * @throws {@link ConfigError} When no video track is configured.
   * @throws {@link StateError} When called after `finalize()`.
   *
   * @see {@link https://w3c.github.io/webcodecs/#encodedvideochunk-interface | WebCodecs EncodedVideoChunk}
   * @see {@link https://w3c.github.io/webcodecs/#dictdef-encodedvideochunkmetadata | WebCodecs EncodedVideoChunkMetadata}
   */
  addVideoChunk(chunk: EncodedVideoChunk, _metadata?: EncodedVideoChunkMetadata): void {
    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)
    this.addVideoSample({
      data,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? 0,
      isKeyFrame: chunk.type === 'key',
    })
  }

  /**
   * Appends a WebCodecs `EncodedAudioChunk` to the configured audio track.
   *
   * @param chunk - An encoded audio chunk produced by `AudioEncoder.output`.
   * @param _metadata - Present to match the WebCodecs `AudioEncoder.output` callback signature.
   *   Its fields are not consumed by the muxer because the decoder configuration is already
   *   supplied up front via `MuxerOptions.audio.description`.
   *
   * @throws {@link ConfigError} When no audio track is configured.
   * @throws {@link StateError} When called after `finalize()`.
   *
   * @see {@link https://w3c.github.io/webcodecs/#encodedaudiochunk-interface | WebCodecs EncodedAudioChunk}
   * @see {@link https://w3c.github.io/webcodecs/#dictdef-encodedaudiochunkmetadata | WebCodecs EncodedAudioChunkMetadata}
   */
  addAudioChunk(chunk: EncodedAudioChunk, _metadata?: EncodedAudioChunkMetadata): void {
    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)
    this.addAudioSample({
      data,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? 0,
      isKeyFrame: chunk.type === 'key',
    })
  }

  /**
   * Appends a raw video sample to the configured video track, bypassing the WebCodecs layer.
   * Intended for Node.js pipelines and custom encoders that produce encoded bytes directly.
   *
   * @param videoSample - The encoded sample bytes and its timing metadata. `timestamp` and
   *   `duration` are expressed in microseconds, matching the WebCodecs convention.
   *
   * @throws {@link ConfigError} When no video track is configured.
   * @throws {@link StateError} When called after `finalize()`.
   *
   * @see {@link https://w3c.github.io/webcodecs/#timestamps | WebCodecs timestamp and duration units (microseconds)}
   */
  addVideoSample(videoSample: VideoSampleInput): void {
    if (!this.videoTrack) {
      throw new ConfigError('No video track configured')
    }
    this.stateMachine.onSample()
    if (this.fragmentBuilder !== null) {
      this.handleFragmentedSample({
        trackId: this.videoTrack.trackId,
        timestampMicroseconds: videoSample.timestamp,
        durationMicroseconds: videoSample.duration,
        isKeyFrame: videoSample.isKeyFrame,
        data: videoSample.data,
      })
      return
    }
    if (this.inMemorySampleWriter !== null) {
      const relativeOffset = this.inMemorySampleWriter.length
      this.inMemorySampleWriter.bytes(videoSample.data)
      this.videoTrack.appendSample({ ...videoSample, chunkOffset: relativeOffset })
      return
    }
    const absoluteChunkOffset = this.writeCursor
    /*
     * Progressive mode is only reachable with a seekable target; see
     * `validateOptions`. `Target.write` may still return `Promise<void>`
     * for custom seekable targets, but the muxer's progressive path has a
     * synchronous public API contract. The `void` operator pins that
     * assumption and silences the no-floating-promises lint.
     */
    void this.target.write(absoluteChunkOffset, videoSample.data)
    this.writeCursor += videoSample.data.length
    this.mdatSize += videoSample.data.length
    this.videoTrack.appendSample({ ...videoSample, chunkOffset: absoluteChunkOffset })
  }

  /**
   * Appends a raw audio sample to the configured audio track, bypassing the WebCodecs layer.
   *
   * @param audioSample - The encoded sample bytes and its timing metadata. `timestamp` and
   *   `duration` are expressed in microseconds. When `isKeyFrame` is omitted, the muxer treats
   *   the sample as a keyframe (the common case for lossy audio codecs where every frame is
   *   independently decodable).
   *
   * @throws {@link ConfigError} When no audio track is configured.
   * @throws {@link StateError} When called after `finalize()`.
   *
   * @see {@link https://w3c.github.io/webcodecs/#timestamps | WebCodecs timestamp and duration units (microseconds)}
   */
  addAudioSample(audioSample: AudioSampleInput): void {
    if (!this.audioTrack) {
      throw new ConfigError('No audio track configured')
    }
    this.stateMachine.onSample()
    if (this.fragmentBuilder !== null) {
      this.handleFragmentedSample({
        trackId: this.audioTrack.trackId,
        timestampMicroseconds: audioSample.timestamp,
        durationMicroseconds: audioSample.duration,
        isKeyFrame: audioSample.isKeyFrame ?? true,
        data: audioSample.data,
      })
      return
    }
    if (this.inMemorySampleWriter !== null) {
      const relativeOffset = this.inMemorySampleWriter.length
      this.inMemorySampleWriter.bytes(audioSample.data)
      this.audioTrack.appendSample({
        ...audioSample,
        isKeyFrame: audioSample.isKeyFrame ?? true,
        chunkOffset: relativeOffset,
      })
      return
    }
    const absoluteChunkOffset = this.writeCursor
    // See addVideoSample for the progressive-mode synchronous-write contract.
    void this.target.write(absoluteChunkOffset, audioSample.data)
    this.writeCursor += audioSample.data.length
    this.mdatSize += audioSample.data.length
    this.audioTrack.appendSample({
      ...audioSample,
      isKeyFrame: audioSample.isKeyFrame ?? true,
      chunkOffset: absoluteChunkOffset,
    })
  }

  /**
   * Flushes the remaining metadata to the target and closes it. In progressive mode, this
   * patches the `mdat` header size and appends `moov`. In `fastStart: "in-memory"` mode,
   * this serializes `ftyp`, runs a two-pass `moov` build to determine its size and absolute
   * chunk offsets, then writes `moov`, the `mdat` header, and the buffered sample bytes in
   * order. In `fastStart: "fragmented"` mode, this flushes any pending samples as a final
   * `moof` plus `mdat` pair, awaits every queued fragment write, and then closes the target.
   *
   * @returns Resolves once the target has been fully written and closed.
   *
   * @throws {@link ConfigError} When the resulting `mdat` payload would exceed 4 GiB, which
   *   the 32-bit size field cannot represent. Switch to fragmented mode to avoid the limit.
   *
   * @see ISO/IEC 14496-12 §8.1.1 for MediaDataBox (mdat) size field semantics.
   * @see ISO/IEC 14496-12 §8.2.1 for MovieBox (moov) placement (end of file for progressive,
   *   preceding mdat for fast-start playback).
   * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 layout used in `"fragmented"` mode.
   */
  async finalize(): Promise<void> {
    this.stateMachine.onFinalize()
    if (this.fragmentBuilder !== null) {
      await this.finalizeFragmented(this.fragmentBuilder)
      return
    }
    if (this.inMemorySampleWriter !== null) {
      await this.finalizeInMemory(this.inMemorySampleWriter)
      return
    }
    await this.finalizeProgressive()
  }

  /**
   * Flushes any pending fragment, appends the tail `mfra` random-access index, awaits every
   * queued fragmented write, and closes the target. Used by {@link Mp4Muxer.finalize} when
   * the muxer is in `fastStart: "fragmented"` mode.
   *
   * @param builder - The fragment builder owning the pending per-track samples.
   */
  private async finalizeFragmented(builder: FragmentBuilder): Promise<void> {
    if (builder.hasPendingSamples()) {
      this.writePendingFragment(builder)
    }
    this.writeMfra()
    await this.fragmentedWriteChain
    await this.target.finish()
  }

  /**
   * Builds and enqueues the tail `mfra` box. The box size depends on its own contents, so
   * this runs a two-pass measurement: the first pass writes a placeholder total to learn
   * the serialized byte length, and the second pass writes the final `mfra` with that
   * measured value declared in the closing `mfro`. The measurement trick works because the
   * `mfro` box is a fixed 16 bytes regardless of the declared `mfraByteLength`.
   */
  private writeMfra(): void {
    const tfraEntriesByTrackId = this.tfraEntriesByTrackId
    if (tfraEntriesByTrackId === null) {
      throw new StateError(
        'writeMfra invoked before the tfra entry registry was initialised. Fragmented mode must construct the registry during muxer setup.'
      )
    }
    const tfraBoxes = this.tracks.map((track) =>
      createTfra({
        trackId: track.trackId,
        entries: tfraEntriesByTrackId.get(track.trackId) ?? [],
      })
    )
    const placeholderMfra = createMfra({ tfras: tfraBoxes, totalByteLength: 0 })
    const measurementWriter = new Writer()
    writeBox(measurementWriter, placeholderMfra)
    const mfraByteLength = measurementWriter.length
    const finalMfra = createMfra({ tfras: tfraBoxes, totalByteLength: mfraByteLength })
    const finalMfraWriter = new Writer()
    writeBox(finalMfraWriter, finalMfra)
    this.enqueueFragmentedWrite(this.writeCursor, finalMfraWriter.toBytes())
    this.writeCursor += finalMfraWriter.length
  }

  /**
   * Routes a single fragmented-mode sample through the builder. The builder first decides
   * whether appending the sample should cross a fragment boundary, in which case the pending
   * fragment is flushed to the target, and then the sample is appended to the new pending
   * fragment. Called from both `addVideoSample` and `addAudioSample` when `fragmentBuilder`
   * is non-null.
   *
   * @param sample - The sample metadata and encoded bytes, already normalized to microseconds.
   */
  private handleFragmentedSample(sample: {
    trackId: number
    timestampMicroseconds: number
    durationMicroseconds: number
    isKeyFrame: boolean
    data: Uint8Array
  }): void {
    const builder = this.fragmentBuilder
    if (builder === null) {
      throw new StateError(
        'handleFragmentedSample invoked outside fragmented mode. This indicates a dispatch bug in addVideoSample or addAudioSample.'
      )
    }
    const shouldFlush = builder.shouldFlushBefore({
      trackId: sample.trackId,
      timestampMicroseconds: sample.timestampMicroseconds,
      durationMicroseconds: sample.durationMicroseconds,
      isKeyFrame: sample.isKeyFrame,
      dataByteLength: sample.data.length,
    })
    if (shouldFlush) {
      this.writePendingFragment(builder)
    }
    builder.appendSample(sample)
  }

  /**
   * Serializes the builder's pending fragment and enqueues the resulting `moof` plus `mdat`
   * bytes for writing. The `writeCursor` is advanced synchronously so subsequent fragments
   * compute correct offsets, while the actual `target.write` invocation runs on the
   * fragmented write chain. Before the cursor advances, one random-access entry per track
   * is recorded so that the tail `mfra` written in {@link Mp4Muxer.finalizeFragmented} can
   * point parsers at each fragment's `moof` byte offset.
   *
   * @param builder - The fragment builder whose pending samples should be flushed.
   */
  private writePendingFragment(builder: FragmentBuilder): void {
    const flushResult = builder.flush()
    if (!flushResult) {
      return
    }
    const moofOffsetFromFileStart = BigInt(this.writeCursor)
    const tfraEntries = this.tfraEntriesByTrackId
    if (tfraEntries === null) {
      throw new StateError('FragmentBuilder produced a flush result, but tfra entries were never initialised.')
    }
    for (const [trackId, firstSampleDecodeTime] of flushResult.firstSampleDecodeTimesByTrackId) {
      const trackEntries = tfraEntries.get(trackId)
      if (trackEntries === undefined) {
        throw new StateError(
          `FragmentBuilder flushed track id ${trackId} but the track is missing from the tfra registry.`
        )
      }
      trackEntries.push({
        timeInTrackTimescale: firstSampleDecodeTime,
        moofOffsetFromFileStart,
        trafNumber: 1,
        trunNumber: 1,
        sampleNumber: 1,
      })
    }
    this.enqueueFragmentedWrite(this.writeCursor, flushResult.bytes)
    this.writeCursor += flushResult.bytes.length
  }

  /**
   * Schedules a fragmented-mode write behind any previously queued writes. The synchronous
   * caller advances `writeCursor` immediately while the actual `target.write` invocation
   * waits for all prior writes to settle, which preserves {@link StreamTarget}'s strictly
   * sequential offset invariant.
   */
  private enqueueFragmentedWrite(offset: number, data: Uint8Array): void {
    this.fragmentedWriteChain = this.fragmentedWriteChain.then(() => this.target.write(offset, data))
  }

  private async finalizeProgressive(): Promise<void> {
    const mdatTotalByteSize = MDAT_HEADER_SIZE_32 + this.mdatSize
    if (mdatTotalByteSize > 0xffffffff) {
      throw new ConfigError('Progressive mdat exceeds 4 GiB. Use fragmented mode.')
    }
    const mdatPatchWriter = new Writer()
    writeMdatHeader32(mdatPatchWriter, mdatTotalByteSize)
    if (!this.target.seek) {
      throw new ConfigError('Target does not support seek, which is required for progressive mode')
    }
    await this.target.seek(this.mdatHeaderOffset)
    await this.target.write(this.mdatHeaderOffset, mdatPatchWriter.toBytes())

    const moovBox = buildMoovBox(this.tracks, MOVIE_TIMESCALE, 0)
    const moovWriter = new Writer()
    writeBox(moovWriter, moovBox)
    await this.target.write(this.writeCursor, moovWriter.toBytes())
    this.writeCursor += moovWriter.length
    await this.target.finish()
  }

  private async finalizeInMemory(sampleWriter: Writer): Promise<void> {
    const compatibleBrands = computeCompatibleBrands(this.options)
    const ftyp = createFtyp({ majorBrand: 'isom', minorVersion: 512, compatibleBrands })
    const ftypWriter = new Writer()
    writeBox(ftypWriter, ftyp)
    const ftypBytes = ftypWriter.toBytes()

    // The serialized size of the stco box depends only on the entry count, not on the offset
    // values. A pass-1 moov built with chunkOffsetBase = 0 therefore has exactly the same byte
    // length as the final pass-2 moov with absolute offsets, so the base computed below is stable.
    const moovPass1 = buildMoovBox(this.tracks, MOVIE_TIMESCALE, 0)
    const moovPass1Writer = new Writer()
    writeBox(moovPass1Writer, moovPass1)
    const moovByteLength = moovPass1Writer.length

    const chunkOffsetBase = ftypBytes.length + moovByteLength + MDAT_HEADER_SIZE_32
    const moovPass2 = buildMoovBox(this.tracks, MOVIE_TIMESCALE, chunkOffsetBase)
    const moovPass2Writer = new Writer()
    writeBox(moovPass2Writer, moovPass2)

    const sampleBytes = sampleWriter.toBytes()
    const mdatTotalByteSize = MDAT_HEADER_SIZE_32 + sampleBytes.length
    if (mdatTotalByteSize > 0xffffffff) {
      throw new ConfigError('In-memory mdat exceeds 4 GiB. Use fragmented mode.')
    }
    const mdatHeaderWriter = new Writer()
    writeMdatHeader32(mdatHeaderWriter, mdatTotalByteSize)

    let writePosition = 0
    await this.target.write(writePosition, ftypBytes)
    writePosition += ftypBytes.length
    await this.target.write(writePosition, moovPass2Writer.toBytes())
    writePosition += moovPass2Writer.length
    await this.target.write(writePosition, mdatHeaderWriter.toBytes())
    writePosition += mdatHeaderWriter.length
    await this.target.write(writePosition, sampleBytes)
    await this.target.finish()
  }

  private writeFtypAndEmptyMoovForFragmentedMode(options: MuxerOptions<T>): void {
    const compatibleBrands = computeCompatibleBrands(options)
    const ftyp = createFtyp({ majorBrand: 'isom', minorVersion: 512, compatibleBrands })
    const ftypWriter = new Writer()
    writeBox(ftypWriter, ftyp)
    const ftypBytes = ftypWriter.toBytes()
    this.enqueueFragmentedWrite(this.writeCursor, ftypBytes)
    this.writeCursor += ftypBytes.length

    // The moov is written up front with zero-duration sample tables. Fragmented playback
    // relies on the mvex.trex defaults and the per-fragment moof / mdat pairs that follow.
    const trakBuildResults = this.tracks.map((track) =>
      track.buildTrak({ movieTimescale: MOVIE_TIMESCALE, chunkOffsetBase: 0 })
    )
    const mvhd = createMvhd({
      timescale: MOVIE_TIMESCALE,
      duration: 0,
      nextTrackId: this.tracks.length + 1,
    })
    const trexChildren = this.tracks.map((track) =>
      createTrex({
        trackId: track.trackId,
        defaultSampleDescriptionIndex: 1,
        defaultSampleDuration: 0,
        defaultSampleSize: 0,
        defaultSampleFlags: 0,
      })
    )
    const mvex = createMvex({ trex: trexChildren })
    const moovBox = createMoov({
      mvhd,
      traks: trakBuildResults.map((trakBuildResult) => trakBuildResult.trak),
      mvex,
    })
    const moovWriter = new Writer()
    writeBox(moovWriter, moovBox)
    const moovBytes = moovWriter.toBytes()
    this.enqueueFragmentedWrite(this.writeCursor, moovBytes)
    this.writeCursor += moovBytes.length
  }

  private writeHeaderAndMdatPlaceholder(): void {
    const compatibleBrands = computeCompatibleBrands(this.options)
    const ftyp = createFtyp({ majorBrand: 'isom', minorVersion: 512, compatibleBrands })
    const ftypWriter = new Writer()
    writeBox(ftypWriter, ftyp)
    // See addVideoSample for the progressive-mode synchronous-write contract.
    void this.target.write(0, ftypWriter.toBytes())
    this.writeCursor = ftypWriter.length
    this.mdatHeaderOffset = this.writeCursor

    const mdatPlaceholderWriter = new Writer()
    writeMdatHeader32(mdatPlaceholderWriter, 0)
    void this.target.write(this.writeCursor, mdatPlaceholderWriter.toBytes())
    this.writeCursor += mdatPlaceholderWriter.length
  }
}

function createFragmentBuilder(options: MuxerOptions, tracks: Track[]): FragmentBuilder {
  const trackSpecs: FragmentTrackSpec[] = tracks.map((track) => ({
    trackId: track.trackId,
    timescale: track.timescale,
    isVideo: track.isVideo,
  }))
  return new FragmentBuilder({
    tracks: trackSpecs,
    minimumFragmentDurationMicroseconds: options.minimumFragmentDuration ?? 1_000_000,
  })
}

function buildMoovBox(tracks: Track[], movieTimescale: number, chunkOffsetBase: number): Box {
  const trakBuildResults = tracks.map((track) => track.buildTrak({ movieTimescale, chunkOffsetBase }))
  const movieDuration = Math.max(0, ...trakBuildResults.map((trakResult) => trakResult.durationInMovieTimescale))
  const mvhd = createMvhd({
    timescale: movieTimescale,
    duration: movieDuration,
    nextTrackId: tracks.length + 1,
  })
  return createMoov({ mvhd, traks: trakBuildResults.map((trakResult) => trakResult.trak) })
}

function validateOptions(options: MuxerOptions): void {
  if (!options.video && !options.audio) {
    throw new ConfigError('Must configure at least one of `video` or `audio`')
  }
  if (options.target instanceof StreamTarget && (options.fastStart ?? false) === false) {
    throw new ConfigError(
      "fastStart:false (progressive) requires a seekable target. Use ArrayBufferTarget or fastStart:'in-memory'."
    )
  }
}

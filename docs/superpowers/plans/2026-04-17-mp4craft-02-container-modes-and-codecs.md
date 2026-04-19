# mp4craft Plan 2: Container Modes and Codecs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fastStart:'in-memory'` mode (moov before mdat), `HevcCodec`, `Vp9Codec`, and `OpusCodec`.

**Architecture:** In-memory mode buffers all sample data in a `Writer` object during `add*` calls. At `finalize()` it writes ftyp, runs a two-pass moov build — pass 1 with `chunkOffsetBase:0` to measure moov byte length, pass 2 with the correct base (`ftypSize + moovSize + mdatHeaderSize`) — then writes moov, mdat header, and sample data sequentially. This works with both `ArrayBufferTarget` and `StreamTarget`. New video codecs (`HevcCodec`, `Vp9Codec`) take explicit `width`/`height` since they cannot parse dimensions from their opaque configuration records; this requires threading dimensions through `TrackOptions` and replacing the `AvcCodec` cast in `VideoTrack`.

**Tech Stack:** TypeScript strict mode, Vitest 4.x, pnpm workspace, tsup ESM, mp4box v2.3.0 (integration tests only).

---

## File Map

**Modified:**

| File                                      | Change                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/tracks/track.ts`       | Add `width?`/`height?` to `TrackOptions`; add `chunkOffsetBase?` to `buildTrak` context; compute absolute offsets from stored offsets + base |
| `packages/core/src/tracks/video-track.ts` | Read width/height from `this.options` instead of casting codec to `AvcCodec`                                                                 |
| `packages/core/src/types/config.ts`       | `FastStart = false \| 'in-memory'`; `VideoCodec` adds `"hevc" \| "vp9"`; `AudioCodec` adds `"opus"`                                          |
| `packages/core/src/muxer/mp4-muxer.ts`    | In-memory sample collection; two-pass finalize; pass `width`/`height` to `VideoTrack`; dispatch new codecs                                   |

**Created:**

| File                                                           | Purpose                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/core/src/codecs/hevc.ts`                             | `hvc1` visual sample entry + `hvcC` child box                  |
| `packages/core/src/codecs/vp9.ts`                              | `vp09` visual sample entry + `vpcC` child FullBox              |
| `packages/core/src/codecs/opus.ts`                             | `Opus` audio sample entry + `dOps` child box                   |
| `packages/core/src/boxes/dops.ts`                              | `dOps` (OpusSpecificBox) builder                               |
| `packages/core/tests/unit/track.test.ts`                       | Unit tests for `TrackOptions` dimensions and `chunkOffsetBase` |
| `packages/core/tests/unit/hevc.test.ts`                        | Unit tests for `HevcCodec.createSampleEntry()`                 |
| `packages/core/tests/unit/vp9.test.ts`                         | Unit tests for `Vp9Codec.createSampleEntry()`                  |
| `packages/core/tests/unit/opus.test.ts`                        | Unit tests for `OpusCodec.createSampleEntry()`                 |
| `packages/core/tests/integration/in-memory-validation.test.ts` | mp4box validation of in-memory AVC output                      |

---

### Task 1: TrackOptions width/height + buildTrak chunkOffsetBase

**Files:**

- Modify: `packages/core/src/tracks/track.ts`
- Modify: `packages/core/src/tracks/video-track.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts`
- Create: `packages/core/tests/unit/track.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/track.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { VideoTrack } from '@/tracks/video-track'
import { AvcCodec } from '@/codecs/avc'
import { Writer } from '@/io/writer'
import { writeBox, type Box } from '@/boxes/box'

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640×480.
const avcc640x480 = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('VideoTrack', () => {
  it('uses width and height from TrackOptions rather than the codec', () => {
    // AvcCodec parses 640×480 from the avcC SPS; TrackOptions overrides with 1920×1080.
    const track = new VideoTrack({
      trackId: 1,
      codec: new AvcCodec(avcc640x480.buffer),
      timescale: 90000,
      firstTimestampBehavior: 'offset',
      width: 1920,
      height: 1080,
    })
    track.appendSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 3000,
      isKeyFrame: true,
      chunkOffset: 0,
    })
    const { trak } = track.buildTrak({ movieTimescale: 1000 })
    const trakBytes = serializeBox(trak)
    const dataView = new DataView(trakBytes.buffer)
    // tkhd stores width and height as consecutive u32 in 16.16 fixed-point after the matrix.
    const expectedWidth = 1920 * 0x10000
    const expectedHeight = 1080 * 0x10000
    let foundDimensionPair = false
    for (let byteOffset = 0; byteOffset <= trakBytes.length - 8; byteOffset++) {
      if (
        dataView.getUint32(byteOffset, false) === expectedWidth &&
        dataView.getUint32(byteOffset + 4, false) === expectedHeight
      ) {
        foundDimensionPair = true
        break
      }
    }
    expect(foundDimensionPair).toBe(true)
  })

  it('buildTrak shifts chunk offsets by chunkOffsetBase', () => {
    const track = new VideoTrack({
      trackId: 1,
      codec: new AvcCodec(avcc640x480.buffer),
      timescale: 90000,
      firstTimestampBehavior: 'offset',
      width: 640,
      height: 480,
    })
    track.appendSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 3000,
      isKeyFrame: true,
      chunkOffset: 50,
    })
    const { trak: trakNoBase } = track.buildTrak({ movieTimescale: 1000 })
    const { trak: trakWithBase } = track.buildTrak({ movieTimescale: 1000, chunkOffsetBase: 500 })
    expect(readFirstStcoOffset(serializeBox(trakNoBase))).toBe(50)
    expect(readFirstStcoOffset(serializeBox(trakWithBase))).toBe(550)
  })
})

function serializeBox(box: Box): Uint8Array {
  const boxWriter = new Writer()
  writeBox(boxWriter, box)
  return boxWriter.toBytes()
}

function readFirstStcoOffset(bytes: Uint8Array): number {
  // stco FullBox layout from box start: size(4) + fourcc(4) + version(1) + flags(3) + entry_count(4) + offset_0(4)
  // First offset entry is at byte 16 from the start of the stco box.
  for (let index = 4; index < bytes.length - 3; index++) {
    if (bytes[index] === 0x73 && bytes[index + 1] === 0x74 && bytes[index + 2] === 0x63 && bytes[index + 3] === 0x6f) {
      const stcoBoxStart = index - 4
      return new DataView(bytes.buffer).getUint32(stcoBoxStart + 16, false)
    }
  }
  throw new Error('stco box not found')
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/track.test.ts
```

Expected: FAIL — `foundDimensionPair` is `false` (VideoTrack currently reads width/height from `AvcCodec`, not `TrackOptions`); second test fails because `chunkOffsetBase` is ignored.

- [ ] **Step 3: Implement TrackOptions width/height + buildTrak chunkOffsetBase**

Replace `packages/core/src/tracks/track.ts` with:

```typescript
import type { Box } from '@/boxes/box'
import type { Codec } from '@/codecs/codec'
import { SampleTable, type SampleInfo } from '@/tracks/sample-table'
import { TimestampTracker, type FirstTimestampBehavior } from '@/tracks/timestamp-tracker'
import { createTkhd } from '@/boxes/tkhd'
import { createMdia } from '@/boxes/mdia'
import { createMdhd } from '@/boxes/mdhd'
import { createHdlr } from '@/boxes/hdlr'
import { createMinf } from '@/boxes/minf'
import { createStbl } from '@/boxes/stbl'
import { createStsd } from '@/boxes/stsd'
import { createStts } from '@/boxes/stts'
import { createStsc } from '@/boxes/stsc'
import { createStsz } from '@/boxes/stsz'
import { createStco, createCo64 } from '@/boxes/stco'
import { createStss } from '@/boxes/stss'
import { createTrak } from '@/boxes/trak'

export type TrackOptions = {
  trackId: number
  codec: Codec
  timescale: number
  firstTimestampBehavior: FirstTimestampBehavior
  language?: string
  width?: number
  height?: number
}

export type AppendedSample = {
  data: Uint8Array
  timestamp: number
  duration: number
  isKeyFrame: boolean
  chunkOffset: number
}

export abstract class Track {
  protected readonly sampleTable: SampleTable
  protected readonly timestampTracker: TimestampTracker

  constructor(
    protected readonly options: TrackOptions,
    isVideoTrack: boolean
  ) {
    this.sampleTable = new SampleTable({ isVideo: isVideoTrack })
    this.timestampTracker = new TimestampTracker(options.firstTimestampBehavior)
  }

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

  abstract get handlerType(): 'vide' | 'soun'
  abstract get mediaHeader(): Box
  abstract get isVideo(): boolean

  buildTrak(buildContext: { movieTimescale: number; chunkOffsetBase?: number }): {
    trak: Box
    durationInTimescale: number
    durationInMovieTimescale: number
  } {
    const buildResult = this.sampleTable.build()

    const baseOffset = buildContext.chunkOffsetBase ?? 0
    const absoluteChunkOffsets = buildResult.chunkOffsets.map((storedOffset) => storedOffset + baseOffset)
    const needsCo64 = absoluteChunkOffsets.some((absoluteOffset) => absoluteOffset > 0xffffffff)

    const stsd = createStsd(this.options.codec.createSampleEntry())
    const stts = createStts(buildResult.sttsEntries)
    const stsc = createStsc(buildResult.stscEntries)
    const stsz = createStsz({ sizes: buildResult.sampleSizes })
    const stco = needsCo64
      ? createCo64(absoluteChunkOffsets.map((absoluteOffset) => BigInt(absoluteOffset)))
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

  protected get videoWidth(): number {
    return 0
  }
  protected get videoHeight(): number {
    return 0
  }
}
```

Replace `packages/core/src/tracks/video-track.ts` with:

```typescript
import { createVmhd } from '@/boxes/vmhd'
import type { Box } from '@/boxes/box'
import { Track, type TrackOptions } from '@/tracks/track'

export class VideoTrack extends Track {
  constructor(options: TrackOptions) {
    super(options, true)
  }

  override get handlerType(): 'vide' {
    return 'vide'
  }
  override get mediaHeader(): Box {
    return createVmhd()
  }
  override get isVideo(): true {
    return true
  }

  protected override get videoWidth(): number {
    return this.options.width ?? 0
  }
  protected override get videoHeight(): number {
    return this.options.height ?? 0
  }
}
```

In `packages/core/src/muxer/mp4-muxer.ts`, add `width` and `height` to the VideoTrack constructor call (find the existing block and replace it):

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/track.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 5: Run full suite and typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tracks/track.ts \
        packages/core/src/tracks/video-track.ts \
        packages/core/src/muxer/mp4-muxer.ts \
        packages/core/tests/unit/track.test.ts
git commit -m "feat: thread width/height through TrackOptions; add chunkOffsetBase to buildTrak"
```

---

### Task 2: fastStart: 'in-memory' mode

**Files:**

- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts`
- Modify: `packages/core/tests/unit/mp4-muxer.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Add a second `describe` block to `packages/core/tests/unit/mp4-muxer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Mp4Muxer } from '@/muxer/mp4-muxer'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { StreamTarget } from '@/targets/stream-target'
import { ConfigError, StateError } from '@/types/errors'

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640×480 — matches AvcCodec SPS parsing expectations.
const avcc = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('Mp4Muxer (progressive)', () => {
  // ... existing tests unchanged ...
})

describe('Mp4Muxer (in-memory)', () => {
  it('places moov before mdat', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(200),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const bytes = new Uint8Array(target.buffer)
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('ftyp')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeGreaterThan(-1)
    expect(text.indexOf('mdat')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
  })

  it('works with StreamTarget (sequential writes only)', async () => {
    const collectedChunks: Uint8Array[] = []
    const muxer = new Mp4Muxer({
      target: new StreamTarget({
        onData: ({ data }) => {
          collectedChunks.push(new Uint8Array(data))
        },
      }),
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(200),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const totalBytes = collectedChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const mergedBytes = new Uint8Array(totalBytes)
    let mergeOffset = 0
    for (const chunk of collectedChunks) {
      mergedBytes.set(chunk, mergeOffset)
      mergeOffset += chunk.length
    }
    const text = new TextDecoder('latin1').decode(mergedBytes)
    expect(text.indexOf('ftyp')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeGreaterThan(-1)
    expect(text.indexOf('mdat')).toBeGreaterThan(-1)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
  })

  it('blocks addSample after finalize', async () => {
    const muxer = new Mp4Muxer({
      target: new ArrayBufferTarget(),
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(10),
      timestamp: 0,
      duration: 1000,
      isKeyFrame: true,
    })
    await muxer.finalize()
    expect(() =>
      muxer.addVideoSample({
        data: new Uint8Array(10),
        timestamp: 2000,
        duration: 1000,
        isKeyFrame: true,
      })
    ).toThrow(StateError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/mp4-muxer.test.ts
```

Expected: FAIL — `fastStart: "in-memory"` is not yet in the `FastStart` type (TypeScript would reject it, and vitest esbuild transpilation may silently ignore the type — the in-memory code path doesn't exist so the muxer would behave like progressive mode, with moov AFTER mdat, failing the `moov < mdat` assertion).

- [ ] **Step 3: Expand FastStart type**

Replace `packages/core/src/types/config.ts` with:

```typescript
import type { Target } from '@/targets/target'
import type { FirstTimestampBehavior } from '@/tracks/timestamp-tracker'

export type VideoCodec = 'avc'
export type AudioCodec = 'aac'
export type FastStart = false | 'in-memory'

export type VideoTrackConfig = {
  codec: VideoCodec
  width: number
  height: number
  description: ArrayBuffer | ArrayBufferView
  timescale?: number
}

export type AudioTrackConfig = {
  codec: AudioCodec
  description: ArrayBuffer | ArrayBufferView
  channels: number
  sampleRate: number
  timescale?: number
}

export type MuxerOptions<T extends Target = Target> = {
  target: T
  video?: VideoTrackConfig
  audio?: AudioTrackConfig
  fastStart?: FastStart
  firstTimestampBehavior?: FirstTimestampBehavior
}
```

- [ ] **Step 4: Implement in-memory mode in mp4-muxer.ts**

Replace `packages/core/src/muxer/mp4-muxer.ts` with:

```typescript
import { writeBox, type Box } from '@/boxes/box'
import { createFtyp } from '@/boxes/ftyp'
import { createMoov } from '@/boxes/moov'
import { createMvhd } from '@/boxes/mvhd'
import { MDAT_HEADER_SIZE_32, writeMdatHeader32 } from '@/boxes/mdat'
import { AvcCodec } from '@/codecs/avc'
import { AacCodec } from '@/codecs/aac'
import { Writer } from '@/io/writer'
import { StreamTarget } from '@/targets/stream-target'
import { VideoTrack } from '@/tracks/video-track'
import { AudioTrack } from '@/tracks/audio-track'
import type { Track } from '@/tracks/track'
import { StateMachine } from '@/muxer/state-machine'
import { ConfigError } from '@/types/errors'
import type { MuxerOptions, VideoTrackConfig, AudioTrackConfig } from '@/types/config'
import type { VideoSampleInput, AudioSampleInput } from '@/types/chunk'
import type { Target } from '@/targets/target'

const MOVIE_TIMESCALE = 1000

export class Mp4Muxer<T extends Target = Target> {
  readonly target: T
  private readonly stateMachine = new StateMachine()
  private readonly videoTrack?: VideoTrack
  private readonly audioTrack?: AudioTrack
  private readonly tracks: Track[] = []
  private readonly inMemorySampleWriter: Writer | null

  private mdatHeaderOffset = 0
  private mdatSize = 0
  private writeCursor = 0

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

    if ((options.fastStart ?? false) === false) {
      this.inMemorySampleWriter = null
      this.writeHeaderAndMdatPlaceholder()
    } else {
      this.inMemorySampleWriter = new Writer()
    }
  }

  // Required by VideoEncoder.output callback signature — metadata carries no information for progressive muxing.
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

  // Required by AudioEncoder.output callback signature — metadata carries no information for progressive muxing.
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

  addVideoSample(videoSample: VideoSampleInput): void {
    if (!this.videoTrack) throw new ConfigError('No video track configured')
    this.stateMachine.onSample()
    if (this.inMemorySampleWriter !== null) {
      const relativeOffset = this.inMemorySampleWriter.length
      this.inMemorySampleWriter.bytes(videoSample.data)
      this.videoTrack.appendSample({ ...videoSample, chunkOffset: relativeOffset })
    } else {
      const offset = this.writeCursor
      this.target.write(offset, videoSample.data)
      this.writeCursor += videoSample.data.length
      this.mdatSize += videoSample.data.length
      this.videoTrack.appendSample({ ...videoSample, chunkOffset: offset })
    }
  }

  addAudioSample(audioSample: AudioSampleInput): void {
    if (!this.audioTrack) throw new ConfigError('No audio track configured')
    this.stateMachine.onSample()
    if (this.inMemorySampleWriter !== null) {
      const relativeOffset = this.inMemorySampleWriter.length
      this.inMemorySampleWriter.bytes(audioSample.data)
      this.audioTrack.appendSample({
        ...audioSample,
        isKeyFrame: audioSample.isKeyFrame ?? true,
        chunkOffset: relativeOffset,
      })
    } else {
      const offset = this.writeCursor
      this.target.write(offset, audioSample.data)
      this.writeCursor += audioSample.data.length
      this.mdatSize += audioSample.data.length
      this.audioTrack.appendSample({
        ...audioSample,
        isKeyFrame: audioSample.isKeyFrame ?? true,
        chunkOffset: offset,
      })
    }
  }

  async finalize(): Promise<void> {
    this.stateMachine.onFinalize()
    if (this.inMemorySampleWriter !== null) {
      await this.finalizeInMemory(this.inMemorySampleWriter)
    } else {
      await this.finalizeProgressive()
    }
  }

  private async finalizeProgressive(): Promise<void> {
    const mdatTotal = MDAT_HEADER_SIZE_32 + this.mdatSize
    if (mdatTotal > 0xffffffff) {
      throw new ConfigError('Progressive mdat exceeds 4 GiB; use fragmented mode')
    }
    const mdatPatchWriter = new Writer()
    writeMdatHeader32(mdatPatchWriter, mdatTotal)
    if (!this.target.seek) {
      throw new ConfigError('Target does not support seek — required for progressive mode')
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

    // Pass 1: build moov with zero base to measure its serialized byte length.
    // stco box size depends only on entry count, not entry values — so pass-2 size matches pass-1 exactly.
    const moovPass1 = buildMoovBox(this.tracks, MOVIE_TIMESCALE, 0)
    const moovPass1Writer = new Writer()
    writeBox(moovPass1Writer, moovPass1)
    const moovByteLength = moovPass1Writer.length

    // Pass 2: build moov with absolute chunk offsets (relative offset + base).
    const chunkOffsetBase = ftypBytes.length + moovByteLength + MDAT_HEADER_SIZE_32
    const moovPass2 = buildMoovBox(this.tracks, MOVIE_TIMESCALE, chunkOffsetBase)
    const moovPass2Writer = new Writer()
    writeBox(moovPass2Writer, moovPass2)

    const sampleBytes = sampleWriter.toBytes()
    const mdatTotalByteSize = MDAT_HEADER_SIZE_32 + sampleBytes.length
    if (mdatTotalByteSize > 0xffffffff) {
      throw new ConfigError('In-memory mdat exceeds 4 GiB; use fragmented mode')
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

  private writeHeaderAndMdatPlaceholder(): void {
    const compatibleBrands = computeCompatibleBrands(this.options)
    const ftyp = createFtyp({ majorBrand: 'isom', minorVersion: 512, compatibleBrands })
    const ftypWriter = new Writer()
    writeBox(ftypWriter, ftyp)
    this.target.write(0, ftypWriter.toBytes())
    this.writeCursor = ftypWriter.length
    this.mdatHeaderOffset = this.writeCursor

    const mdatPlaceholderWriter = new Writer()
    writeMdatHeader32(mdatPlaceholderWriter, 0)
    this.target.write(this.writeCursor, mdatPlaceholderWriter.toBytes())
    this.writeCursor += mdatPlaceholderWriter.length
  }
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

function computeCompatibleBrands(options: MuxerOptions): string[] {
  const brands: string[] = ['isom', 'iso2']
  if (options.video?.codec === 'avc') brands.push('avc1')
  else if (options.video?.codec === 'hevc') brands.push('hvc1')
  else if (options.video?.codec === 'vp9') brands.push('vp09')
  brands.push('mp41')
  return brands
}

function createVideoCodec(config: VideoTrackConfig): AvcCodec {
  if (config.codec !== 'avc') throw new ConfigError(`Unsupported video codec: ${config.codec}`)
  return new AvcCodec(toBuffer(config.description))
}

function createAudioCodec(config: AudioTrackConfig): AacCodec {
  if (config.codec !== 'aac') throw new ConfigError(`Unsupported audio codec: ${config.codec}`)
  return new AacCodec({
    description: toBuffer(config.description),
    channels: config.channels,
    sampleRate: config.sampleRate,
  })
}

function toBuffer(description: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (description instanceof ArrayBuffer) return description
  return (description.buffer as ArrayBuffer).slice(
    description.byteOffset,
    description.byteOffset + description.byteLength
  )
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/mp4-muxer.test.ts
```

Expected: all 7 tests (4 progressive + 3 in-memory) pass.

- [ ] **Step 6: Run full suite and typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/config.ts \
        packages/core/src/muxer/mp4-muxer.ts \
        packages/core/tests/unit/mp4-muxer.test.ts
git commit -m "feat: add fastStart:'in-memory' mode with two-pass moov build"
```

---

### Task 3: HevcCodec (hvc1 + hvcC)

**Files:**

- Create: `packages/core/src/codecs/hevc.ts`
- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts`
- Create: `packages/core/tests/unit/hevc.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/hevc.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { HevcCodec } from '@/codecs/hevc'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'

// Minimal HevcDecoderConfigurationRecord (version byte only — structural test, not a real stream).
const minimalHvcc = new Uint8Array([0x01])

describe('HevcCodec', () => {
  it('createSampleEntry produces hvc1 box containing hvcC child', () => {
    const codec = new HevcCodec(minimalHvcc.buffer, 1280, 720)
    expect(codec.kind).toBe('video')
    expect(codec.fourcc).toBe('hvc1')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('hvc1')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'hvcC')).toBeGreaterThan(-1)
  })

  it('encodes width and height into the visual sample entry', () => {
    const codec = new HevcCodec(minimalHvcc.buffer, 1280, 720)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Visual sample entry: size(4) + fourcc(4) + reserved(6) + data_ref_idx(2) + pre_defined(2)
    //   + reserved(2) + pre_defined2(12) + width(2) + height(2) = at byte 32
    expect(dataView.getUint16(32, false)).toBe(1280)
    expect(dataView.getUint16(34, false)).toBe(720)
  })
})

function findFourcc(bytes: Uint8Array, fourcc: string): number {
  const codes = fourcc.split('').map((character) => character.charCodeAt(0))
  for (let index = 0; index <= bytes.length - 4; index++) {
    if (
      bytes[index] === codes[0] &&
      bytes[index + 1] === codes[1] &&
      bytes[index + 2] === codes[2] &&
      bytes[index + 3] === codes[3]
    ) {
      return index
    }
  }
  return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/hevc.test.ts
```

Expected: FAIL — `HevcCodec` does not exist.

- [ ] **Step 3: Implement HevcCodec**

Create `packages/core/src/codecs/hevc.ts`:

```typescript
import { writeBox, type Box } from '@/boxes/box'
import type { Codec } from '@/codecs/codec'

export class HevcCodec implements Codec {
  readonly kind = 'video'
  readonly fourcc = 'hvc1'
  private readonly hvcc: Uint8Array
  private readonly width: number
  private readonly height: number

  constructor(description: ArrayBuffer | ArrayBufferView, width: number, height: number) {
    this.hvcc = toUint8Array(description)
    this.width = width
    this.height = height
  }

  createSampleEntry(): Box {
    return {
      type: 'hvc1',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.u16(0)
        writer.u16(0)
        writer.zeros(12)
        writer.u16(this.width)
        writer.u16(this.height)
        writer.u32(0x00480000)
        writer.u32(0x00480000)
        writer.u32(0)
        writer.u16(1)
        const compressorName = 'mp4craft HEVC'
        writer.u8(compressorName.length)
        writer.ascii(compressorName)
        writer.zeros(31 - compressorName.length)
        writer.u16(0x0018)
        writer.u16(0xffff)
        writeBox(writer, { type: 'hvcC', write: (innerWriter) => innerWriter.bytes(this.hvcc) })
      },
    }
  }
}

function toUint8Array(description: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description)
  return new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
}
```

Add `"hevc"` to `VideoCodec` in `packages/core/src/types/config.ts`:

```typescript
export type VideoCodec = 'avc' | 'hevc'
```

Add `HevcCodec` dispatch to `createVideoCodec` in `packages/core/src/muxer/mp4-muxer.ts`:

```typescript
import { HevcCodec } from '@/codecs/hevc'

// Replace createVideoCodec:
function createVideoCodec(config: VideoTrackConfig): AvcCodec | HevcCodec {
  if (config.codec === 'avc') return new AvcCodec(toBuffer(config.description))
  if (config.codec === 'hevc') return new HevcCodec(toBuffer(config.description), config.width, config.height)
  throw new ConfigError(`Unsupported video codec: ${config.codec as string}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/hevc.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 5: Run full suite and typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/codecs/hevc.ts \
        packages/core/src/types/config.ts \
        packages/core/src/muxer/mp4-muxer.ts \
        packages/core/tests/unit/hevc.test.ts
git commit -m "feat: add HevcCodec (hvc1 + hvcC sample entry)"
```

---

### Task 4: Vp9Codec (vp09 + vpcC)

**Files:**

- Create: `packages/core/src/codecs/vp9.ts`
- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts`
- Create: `packages/core/tests/unit/vp9.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/vp9.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Vp9Codec } from '@/codecs/vp9'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'

// Minimal VP codec configuration payload (vpcC body, 8 bytes):
// profile=0, level=41, bitDepth=8 | chromaSubsampling=1<<1 | fullRange=0, colorPrimaries=1,
// transferCharacteristics=1, matrixCoefficients=1, codecInitializationDataSize=0
const minimalVpccPayload = new Uint8Array([0x00, 0x29, 0x10, 0x01, 0x01, 0x01, 0x00, 0x00])

describe('Vp9Codec', () => {
  it('createSampleEntry produces vp09 box containing vpcC child FullBox', () => {
    const codec = new Vp9Codec(minimalVpccPayload.buffer, 1920, 1080)
    expect(codec.kind).toBe('video')
    expect(codec.fourcc).toBe('vp09')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('vp09')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'vpcC')).toBeGreaterThan(-1)
  })

  it('encodes width and height into the visual sample entry', () => {
    const codec = new Vp9Codec(minimalVpccPayload.buffer, 1920, 1080)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Visual sample entry width at byte 32, height at byte 34.
    expect(dataView.getUint16(32, false)).toBe(1920)
    expect(dataView.getUint16(34, false)).toBe(1080)
  })

  it('vpcC child is a FullBox (version=1, flags=0)', () => {
    const codec = new Vp9Codec(minimalVpccPayload.buffer, 1920, 1080)
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const vpcCPosition = findFourcc(entryBytes, 'vpcC')
    expect(vpcCPosition).toBeGreaterThan(-1)
    const dataView = new DataView(entryBytes.buffer)
    // FullBox header after fourcc: version(1 byte) then flags(3 bytes).
    const vpcCBodyStart = vpcCPosition + 4
    expect(dataView.getUint8(vpcCBodyStart)).toBe(1) // version=1
    expect(dataView.getUint8(vpcCBodyStart + 1)).toBe(0) // flags high
    expect(dataView.getUint8(vpcCBodyStart + 2)).toBe(0) // flags mid
    expect(dataView.getUint8(vpcCBodyStart + 3)).toBe(0) // flags low
  })
})

function findFourcc(bytes: Uint8Array, fourcc: string): number {
  const codes = fourcc.split('').map((character) => character.charCodeAt(0))
  for (let index = 0; index <= bytes.length - 4; index++) {
    if (
      bytes[index] === codes[0] &&
      bytes[index + 1] === codes[1] &&
      bytes[index + 2] === codes[2] &&
      bytes[index + 3] === codes[3]
    ) {
      return index
    }
  }
  return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/vp9.test.ts
```

Expected: FAIL — `Vp9Codec` does not exist.

- [ ] **Step 3: Implement Vp9Codec**

Create `packages/core/src/codecs/vp9.ts`:

```typescript
import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'
import type { Codec } from '@/codecs/codec'

export class Vp9Codec implements Codec {
  readonly kind = 'video'
  readonly fourcc = 'vp09'
  private readonly vpccPayload: Uint8Array
  private readonly width: number
  private readonly height: number

  constructor(description: ArrayBuffer | ArrayBufferView, width: number, height: number) {
    this.vpccPayload = toUint8Array(description)
    this.width = width
    this.height = height
  }

  createSampleEntry(): Box {
    return {
      type: 'vp09',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.u16(0)
        writer.u16(0)
        writer.zeros(12)
        writer.u16(this.width)
        writer.u16(this.height)
        writer.u32(0x00480000)
        writer.u32(0x00480000)
        writer.u32(0)
        writer.u16(1)
        const compressorName = 'mp4craft VP9'
        writer.u8(compressorName.length)
        writer.ascii(compressorName)
        writer.zeros(31 - compressorName.length)
        writer.u16(0x0018)
        writer.u16(0xffff)
        writeBox(writer, this.createVpccBox())
      },
    }
  }

  private createVpccBox(): FullBox {
    return {
      type: 'vpcC',
      version: 1,
      flags: 0,
      write: (writer) => writer.bytes(this.vpccPayload),
    }
  }
}

function toUint8Array(description: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description)
  return new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
}
```

Add `"vp9"` to `VideoCodec` in `packages/core/src/types/config.ts`:

```typescript
export type VideoCodec = 'avc' | 'hevc' | 'vp9'
```

Add `Vp9Codec` dispatch to `createVideoCodec` in `packages/core/src/muxer/mp4-muxer.ts`:

```typescript
import { Vp9Codec } from '@/codecs/vp9'

// Replace createVideoCodec:
function createVideoCodec(config: VideoTrackConfig): AvcCodec | HevcCodec | Vp9Codec {
  if (config.codec === 'avc') return new AvcCodec(toBuffer(config.description))
  if (config.codec === 'hevc') return new HevcCodec(toBuffer(config.description), config.width, config.height)
  if (config.codec === 'vp9') return new Vp9Codec(toBuffer(config.description), config.width, config.height)
  throw new ConfigError(`Unsupported video codec: ${config.codec as string}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/vp9.test.ts
```

Expected: PASS — all three tests green.

- [ ] **Step 5: Run full suite and typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/codecs/vp9.ts \
        packages/core/src/types/config.ts \
        packages/core/src/muxer/mp4-muxer.ts \
        packages/core/tests/unit/vp9.test.ts
git commit -m "feat: add Vp9Codec (vp09 + vpcC FullBox sample entry)"
```

---

### Task 5: OpusCodec (Opus + dOps)

**Files:**

- Create: `packages/core/src/boxes/dops.ts`
- Create: `packages/core/src/codecs/opus.ts`
- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts`
- Create: `packages/core/tests/unit/opus.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/opus.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { OpusCodec } from '@/codecs/opus'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'

// Minimal dOps payload for stereo 48 kHz Opus (11 bytes):
// version=0, outputChannelCount=2, preSkip=0 (u16), inputSampleRate=48000 (u32 big-endian),
// outputGain=0 (i16), channelMappingFamily=0
// inputSampleRate 48000 = 0x0000BB80 → bytes [0x00, 0x00, 0xBB, 0x80]
const dopsPayloadStereo48k = new Uint8Array([0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0xbb, 0x80, 0x00, 0x00, 0x00])

describe('OpusCodec', () => {
  it('createSampleEntry produces Opus box containing dOps child', () => {
    const codec = new OpusCodec({
      description: dopsPayloadStereo48k.buffer,
      channels: 2,
      sampleRate: 48000,
    })
    expect(codec.kind).toBe('audio')
    expect(codec.fourcc).toBe('Opus')
    const entry = codec.createSampleEntry()
    expect(entry.type).toBe('Opus')
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    expect(findFourcc(entryBytes, 'dOps')).toBeGreaterThan(-1)
  })

  it('hardcodes samplerate field to 48000 in 16.16 fixed-point per ISOBMFF Opus spec', () => {
    const codec = new OpusCodec({
      description: dopsPayloadStereo48k.buffer,
      channels: 2,
      sampleRate: 44100, // intentionally different from the mandatory 48 kHz presentation rate
    })
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // Audio sample entry: size(4) + fourcc(4) + reserved(6) + data_ref_idx(2) + reserved(8)
    //   + channelcount(2) + samplesize(2) + pre_defined(2) + reserved(2) + samplerate(4) = at byte 32
    // 48000 in 16.16 = 0xBB800000
    expect(dataView.getUint32(32, false)).toBe(0xbb800000)
  })

  it('writes channelcount into the audio sample entry', () => {
    const codec = new OpusCodec({
      description: dopsPayloadStereo48k.buffer,
      channels: 2,
      sampleRate: 48000,
    })
    const entry = codec.createSampleEntry()
    const entryWriter = new Writer()
    writeBox(entryWriter, entry)
    const entryBytes = entryWriter.toBytes()
    const dataView = new DataView(entryBytes.buffer)
    // channelcount is at byte 24 in the audio sample entry (after size+fourcc+reserved+data_ref_idx+reserved).
    // size(4)+fourcc(4)+reserved(6)+data_ref_idx(2)+reserved(8) = 24 bytes
    expect(dataView.getUint16(24, false)).toBe(2)
  })
})

function findFourcc(bytes: Uint8Array, fourcc: string): number {
  const codes = fourcc.split('').map((character) => character.charCodeAt(0))
  for (let index = 0; index <= bytes.length - 4; index++) {
    if (
      bytes[index] === codes[0] &&
      bytes[index + 1] === codes[1] &&
      bytes[index + 2] === codes[2] &&
      bytes[index + 3] === codes[3]
    ) {
      return index
    }
  }
  return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/opus.test.ts
```

Expected: FAIL — `OpusCodec` does not exist.

- [ ] **Step 3: Implement dOps box builder**

Create `packages/core/src/boxes/dops.ts`:

```typescript
import type { Box } from '@/boxes/box'

export function createDops(dopsPayload: Uint8Array): Box {
  return {
    type: 'dOps',
    write: (writer) => writer.bytes(dopsPayload),
  }
}
```

- [ ] **Step 4: Implement OpusCodec**

Create `packages/core/src/codecs/opus.ts`:

```typescript
import { writeBox, type Box } from '@/boxes/box'
import { createDops } from '@/boxes/dops'
import type { Codec } from '@/codecs/codec'

export type OpusCodecOptions = {
  description: ArrayBuffer | ArrayBufferView
  channels: number
  sampleRate: number
}

export class OpusCodec implements Codec {
  readonly kind = 'audio'
  readonly fourcc = 'Opus'
  readonly channels: number
  readonly sampleRate: number
  private readonly dopsPayload: Uint8Array

  constructor(options: OpusCodecOptions) {
    this.dopsPayload = toUint8Array(options.description)
    this.channels = options.channels
    this.sampleRate = options.sampleRate
  }

  createSampleEntry(): Box {
    return {
      type: 'Opus',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.zeros(8)
        writer.u16(this.channels)
        writer.u16(16)
        writer.u16(0)
        writer.u16(0)
        // ISO/IEC 23003-5 §5: Opus in ISOBMFF always declares 48000 Hz regardless of input rate.
        writer.u32(0xbb800000)
        writeBox(writer, createDops(this.dopsPayload))
      },
    }
  }
}

function toUint8Array(description: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description)
  return new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
}
```

- [ ] **Step 5: Expand AudioCodec type and wire up createAudioCodec**

Replace `AudioCodec` in `packages/core/src/types/config.ts`:

```typescript
export type AudioCodec = 'aac' | 'opus'
```

Add `OpusCodec` import and dispatch to `createAudioCodec` in `packages/core/src/muxer/mp4-muxer.ts`:

```typescript
import { OpusCodec } from '@/codecs/opus'

// Replace createAudioCodec:
function createAudioCodec(config: AudioTrackConfig): AacCodec | OpusCodec {
  if (config.codec === 'aac') {
    return new AacCodec({
      description: toBuffer(config.description),
      channels: config.channels,
      sampleRate: config.sampleRate,
    })
  }
  if (config.codec === 'opus') {
    return new OpusCodec({
      description: toBuffer(config.description),
      channels: config.channels,
      sampleRate: config.sampleRate,
    })
  }
  throw new ConfigError(`Unsupported audio codec: ${config.codec as string}`)
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter mp4craft exec vitest run tests/unit/opus.test.ts
```

Expected: PASS — all three tests green.

- [ ] **Step 7: Run full suite and typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/boxes/dops.ts \
        packages/core/src/codecs/opus.ts \
        packages/core/src/types/config.ts \
        packages/core/src/muxer/mp4-muxer.ts \
        packages/core/tests/unit/opus.test.ts
git commit -m "feat: add OpusCodec (Opus + dOps sample entry)"
```

---

### Task 6: Integration test — in-memory AVC output validated by mp4box

**Files:**

- Create: `packages/core/tests/integration/in-memory-validation.test.ts`

---

- [ ] **Step 1: Write the test**

Create `packages/core/tests/integration/in-memory-validation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { createFile, MP4BoxBuffer } from 'mp4box'
import { Mp4Muxer } from '@/muxer/mp4-muxer'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDirectory = resolve(fileURLToPath(new URL('../fixtures', import.meta.url)))

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640×480 — matches AvcCodec SPS parsing expectations.
const avcc = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

function parseMp4(buffer: ArrayBuffer): Promise<ReturnType<typeof createFile>> {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile()
    mp4boxFile.onReady = () => resolve(mp4boxFile)
    mp4boxFile.onError = (errorMessage: string) => reject(new Error(errorMessage))
    const mp4BoxBuffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0)
    mp4boxFile.appendBuffer(mp4BoxBuffer)
    mp4boxFile.flush()
  })
}

describe('in-memory AVC output (mp4box validation)', () => {
  it('produces a valid single-track AVC file with moov before mdat', async () => {
    const keyFrameData = readFileSync(resolve(fixturesDirectory, 'avc-key-frame.bin'))
    const deltaFrameData = readFileSync(resolve(fixturesDirectory, 'avc-delta-frame.bin'))

    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })

    muxer.addVideoSample({
      data: new Uint8Array(keyFrameData.buffer),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(deltaFrameData.buffer),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })

    await muxer.finalize()

    const outputBuffer = target.buffer
    const outputBytes = new Uint8Array(outputBuffer)
    const text = new TextDecoder('latin1').decode(outputBytes)

    // moov must appear before mdat in the byte stream.
    const moovBytePosition = text.indexOf('moov')
    const mdatBytePosition = text.indexOf('mdat')
    expect(moovBytePosition).toBeGreaterThan(0)
    expect(mdatBytePosition).toBeGreaterThan(0)
    expect(moovBytePosition).toBeLessThan(mdatBytePosition)

    // mp4box must parse it as a valid 1-track AVC file.
    const mp4boxFile = await parseMp4(outputBuffer)
    const movieInfo = mp4boxFile.getInfo()
    expect(movieInfo.tracks).toHaveLength(1)
    expect(movieInfo.tracks[0]!.codec).toMatch(/^avc1/)
    expect(movieInfo.tracks[0]!.nb_samples).toBe(2)
  })

  it('produces a valid audio-only in-memory file', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'in-memory',
      audio: {
        codec: 'aac',
        description: new Uint8Array([0x12, 0x10]),
        channels: 2,
        sampleRate: 44100,
      },
    })

    muxer.addAudioSample({
      data: new Uint8Array(500),
      timestamp: 0,
      duration: 23_000,
      isKeyFrame: true,
    })
    muxer.addAudioSample({
      data: new Uint8Array(500),
      timestamp: 23_000,
      duration: 23_000,
      isKeyFrame: true,
    })
    await muxer.finalize()

    const outputBuffer = target.buffer
    const mp4boxFile = await parseMp4(outputBuffer)
    const movieInfo = mp4boxFile.getInfo()
    expect(movieInfo.tracks).toHaveLength(1)
    expect(movieInfo.tracks[0]!.codec).toMatch(/^mp4a/)
    expect(movieInfo.tracks[0]!.nb_samples).toBe(2)

    const outputBytes = new Uint8Array(outputBuffer)
    const text = new TextDecoder('latin1').decode(outputBytes)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm --filter mp4craft exec vitest run tests/integration/in-memory-validation.test.ts
```

Expected: PASS — both tests green. mp4box parses the output correctly; moov precedes mdat.

If the test fails because `avc-key-frame.bin` or `avc-delta-frame.bin` are missing, run the fixture builder first:

```bash
node packages/core/tests/fixtures/build-fixtures.mjs
```

- [ ] **Step 3: Run full suite and typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/integration/in-memory-validation.test.ts
git commit -m "test: validate in-memory mode output with mp4box (moov before mdat)"
```

---

## Spec Coverage Self-Review

| Spec requirement                                                            | Task   |
| --------------------------------------------------------------------------- | ------ |
| `fastStart: 'in-memory'` → `ftyp + moov + mdat` layout                      | Task 2 |
| Works with `StreamTarget` (sequential writes)                               | Task 2 |
| Two-pass moov build with correct chunk offset base                          | Task 2 |
| `VideoCodec` includes `"hevc"`                                              | Task 3 |
| `hvc1` sample entry with `hvcC` child                                       | Task 3 |
| `VideoCodec` includes `"vp9"`                                               | Task 4 |
| `vp09` sample entry with `vpcC` FullBox child                               | Task 4 |
| `AudioCodec` includes `"opus"`                                              | Task 5 |
| `Opus` sample entry with `dOps` child; samplerate hardcoded to 48 kHz       | Task 5 |
| mp4box validation of in-memory AVC output                                   | Task 6 |
| `TrackOptions.width`/`height` decouples VideoTrack from AvcCodec cast       | Task 1 |
| `buildTrak` `chunkOffsetBase` enables two-pass moov without duplicate state | Task 1 |

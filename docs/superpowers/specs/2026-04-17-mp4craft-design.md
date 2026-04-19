# mp4craft — Design Spec

**Date:** 2026-04-17
**Status:** Draft, awaiting user review

## Summary

`mp4craft` is a TypeScript-first, zero-runtime-dependency MP4 muxer that runs identically in the browser and Node.js. It accepts encoded video/audio (WebCodecs chunks or raw byte buffers) and writes valid MP4 / ISO BMFF containers, including progressive (`moov` at end), faststart (`moov` at start), and fragmented MP4 (fMP4) for streaming.

The repo is a pnpm monorepo with two packages:

- `packages/core/` — the published library (`mp4craft` on npm)
- `packages/playground/` — a local React + Vite app for visualizing, stress-testing, and manually verifying the muxer

## Goals

1. **Zero runtime dependencies.** Published bundle is pure TypeScript output, nothing else.
2. **Modern by default.** ESM-only, ES2022 target, Node ≥20. No CJS, no legacy browser polyfills.
3. **TypeScript-first.** Fully typed public API using `type` declarations (never `interface`). Strict compiler flags, no `any`.
4. **WebCodecs-native, but not WebCodecs-only.** First-class support for `EncodedVideoChunk` / `EncodedAudioChunk`; raw byte path available for Node and non-WebCodecs encoders.
5. **Three container modes** covering all common use cases: progressive, faststart, fragmented.
6. **Testable internals.** Boxes modeled as a data tree, serialized by a separate writer — easy to unit-test and visualize.
7. **Absolute imports everywhere** (`@/...` → `src/...`) in both packages.

## Non-goals (v1)

- Video/audio **encoding** — out of scope. Users encode with WebCodecs, ffmpeg, etc.; we only mux.
- Multiple tracks of the same type (dual video, multi-language audio). Single video + single audio track per file.
- Subtitle/caption tracks, chapters, HDR metadata, edit lists, cover art, custom metadata atoms — deferred (may become v2 scope).
- Browser CJS / UMD builds. ESM only.
- Node <20 support.

## Name & Constructor

- **Package name:** `mp4craft`
- **Root class:** `Mp4Muxer` (explicit, non-stuttering, leaves room for future `WebmMuxer` etc.)

## Monorepo Layout

```
mp4craft/
├── pnpm-workspace.yaml
├── package.json                    # root, private
├── tsconfig.base.json              # shared compiler options
├── oxlintrc.json                   # lint config
├── oxfmt.toml                      # format config (near-empty, defaults)
├── .github/workflows/ci.yml
├── docs/
│   └── superpowers/specs/
├── packages/
│   ├── core/                       # package.json name: "mp4craft"
│   │   ├── src/
│   │   │   ├── index.ts            # public API barrel
│   │   │   ├── debug.ts            # optional debug observer (separate entry)
│   │   │   ├── muxer/
│   │   │   │   ├── mp4-muxer.ts
│   │   │   │   ├── state-machine.ts
│   │   │   │   └── timestamp-tracker.ts
│   │   │   ├── boxes/
│   │   │   │   ├── box.ts · full-box.ts
│   │   │   │   ├── ftyp.ts · moov.ts · mvhd.ts · trak.ts · tkhd.ts
│   │   │   │   ├── mdia.ts · minf.ts · stbl.ts · mdat.ts · free.ts
│   │   │   │   ├── moof.ts · traf.ts · tfhd.ts · tfdt.ts · trun.ts
│   │   │   │   ├── mfra.ts · tfra.ts
│   │   │   │   └── index.ts
│   │   │   ├── tracks/
│   │   │   │   ├── track.ts · video-track.ts · audio-track.ts
│   │   │   │   └── sample-table.ts
│   │   │   ├── codecs/
│   │   │   │   ├── codec.ts
│   │   │   │   ├── avc.ts · hevc.ts · av1.ts · vp9.ts
│   │   │   │   ├── aac.ts · opus.ts · mp3.ts · flac.ts · pcm.ts
│   │   │   │   └── index.ts
│   │   │   ├── targets/
│   │   │   │   ├── target.ts
│   │   │   │   ├── array-buffer-target.ts
│   │   │   │   ├── stream-target.ts
│   │   │   │   └── buffered-writer.ts
│   │   │   ├── io/
│   │   │   │   ├── writer.ts · bit-reader.ts · nalu.ts
│   │   │   └── types/
│   │   │       ├── config.ts · chunk.ts · codec.ts · errors.ts
│   │   ├── tests/
│   │   │   ├── unit/ · integration/ · golden/
│   │   │   └── fixtures/
│   │   ├── tsup.config.ts
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── playground/                 # package.json name: "@mp4craft/playground"
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx · App.tsx
│       │   ├── scenarios/
│       │   │   ├── CameraRecorder.tsx
│       │   │   ├── ScreenRecorder.tsx
│       │   │   ├── CanvasAnimation.tsx
│       │   │   ├── AudioOnly.tsx
│       │   │   ├── FmP4Live.tsx
│       │   │   └── StressTest.tsx
│       │   ├── components/
│       │   │   ├── BoxTreeView.tsx · HexInspector.tsx
│       │   │   ├── Timeline.tsx · Stats.tsx · CodecSelector.tsx
│       │   ├── lib/
│       │   │   ├── encoders.ts · download.ts
│       │   └── styles.css
│       └── package.json
└── tsconfig.json                   # root references both packages
```

## Public API

```ts
import {
  Mp4Muxer,
  ArrayBufferTarget,
  StreamTarget,
  type MuxerOptions,
  type VideoTrackConfig,
  type AudioTrackConfig,
  type VideoCodec,
  type AudioCodec,
  type FastStart,
  Mp4CraftError,
  ConfigError,
  StateError,
  CodecError,
  TargetError,
} from 'mp4craft';

const muxer = new Mp4Muxer({
  target: new ArrayBufferTarget(),
  fastStart: 'in-memory',          // 'in-memory' | 'fragmented' | false
  video: {
    codec: 'avc',                  // 'avc' | 'hevc' | 'av1' | 'vp9'
    width: 1920,
    height: 1080,
    // optional: frameRate, colorSpace, rotation, language, bitrate
  },
  audio: {
    codec: 'aac',                  // 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm'
    numberOfChannels: 2,
    sampleRate: 48000,
  },
  firstTimestampBehavior: 'offset', // 'strict' | 'offset' | 'permissive'
});

// WebCodecs-native path (primary).
// `metadata` is the second argument passed to VideoEncoder/AudioEncoder's output callback;
// it carries `decoderConfig` on the first chunk and is optional/empty afterwards.
muxer.addVideoChunk(encodedVideoChunk, metadata: EncodedVideoChunkMetadata);
muxer.addAudioChunk(encodedAudioChunk, metadata: EncodedAudioChunkMetadata);

// Raw path (for Node / custom encoders)
muxer.addVideoSample({
  data: uint8Array,
  timestamp: 0,                    // microseconds (WebCodecs convention)
  duration: 33333,
  isKeyFrame: true,
  decoderConfig: { description: avcC },
});
muxer.addAudioSample({ data, timestamp, duration, decoderConfig });

await muxer.finalize();            // flushes + closes target

// `Mp4Muxer` is generic over its Target so `target` is narrowed correctly:
//   class Mp4Muxer<T extends Target = Target> { readonly target: T; ... }
// With `new Mp4Muxer({ target: new ArrayBufferTarget(), ... })`, `muxer.target.buffer` typechecks.
const buffer = muxer.target.buffer;// ArrayBuffer
```

### Key types

```ts
export type VideoCodec = 'avc' | 'hevc' | 'av1' | 'vp9'
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm'
export type FastStart = 'in-memory' | 'fragmented' | false
export type FirstTimestampBehavior = 'strict' | 'offset' | 'permissive'

// Any value conforming to the Target interface contract works.
// Built-in implementations: ArrayBufferTarget, StreamTarget.
export type Target = {
  write(offset: number, data: Uint8Array): void | Promise<void>
  seek?(offset: number): void | Promise<void> // presence gates faststart support
  finish(): void | Promise<void>
}

export type MuxerOptions = {
  target: Target
  video?: VideoTrackConfig // at least one of video/audio required
  audio?: AudioTrackConfig // audio-only MP4 is supported
  fastStart?: FastStart
  firstTimestampBehavior?: FirstTimestampBehavior
  minimumFragmentDuration?: number // microseconds; only for 'fragmented' (default: 1_000_000 = 1s)
}
```

### Container modes (`fastStart`)

| Mode           | Layout                                      | When to use                                                  | Target requirements                  |
| -------------- | ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| `false`        | `ftyp + mdat + moov`                        | VOD files written sequentially; playback after full download | Any sequential target                |
| `'in-memory'`  | `ftyp + moov + mdat`                        | Downloadable files playable while downloading (web VOD)      | Needs enough RAM to buffer full file |
| `'fragmented'` | `ftyp + moov(empty) + (moof + mdat)+ mfra?` | Live streaming, indefinite recording, MSE playback           | Any sequential target                |

(In fMP4 the initial `moov` contains only track metadata — no sample tables. Sample data lives in the per-fragment `moof`/`mdat` pairs.)

Defaults:

- `ArrayBufferTarget` → `'in-memory'` (it's already an in-memory buffer)
- `StreamTarget` → `false` (progressive); bump to `'in-memory'` only if the user supplies a custom target with `seek`
- User-specified always wins; incompatible combinations throw `ConfigError` at construction (e.g., `'in-memory'` on a target without `seek`)

### firstTimestampBehavior

Controls what happens when the **first** sample submitted for a track has a non-zero timestamp:

- `'strict'` — throw `StateError`. Use when you're certain timestamps start at 0.
- `'offset'` (default) — subtract the first timestamp from every subsequent one so the track starts at 0.
- `'permissive'` — accept timestamps as-is; record them literally in the MP4 edit list.

### Fragment cadence (`'fragmented'` only)

A new fragment (`moof + mdat` pair) is flushed when **both** conditions hold:

1. The video track has received a new keyframe (or the track is audio-only).
2. `minimumFragmentDuration` microseconds have elapsed since the last fragment.

This keeps fragments self-decodable (each starts at a keyframe) and bounds their size. On `finalize()`, any pending samples are flushed as a final fragment.

### Errors

All errors extend `Mp4CraftError`:

- `ConfigError` — invalid options on construction
- `StateError` — illegal call order (e.g., `addVideoChunk` after `finalize`)
- `CodecError` — unsupported codec, malformed SPS/PPS, missing decoder config
- `TargetError` — target write failure, seek required but unsupported

## Core Internals

### Architecture principles

1. **Boxes are data, not writers.** Each box builds a tree (`{ type: 'moov', children: [...] }`); a single `Writer` traverses and serializes. Easy to unit-test (snapshot the tree), easy to visualize (playground BoxTreeView), easy to patch (faststart rewrites `moov` sizes).
2. **Sample tables build incrementally.** `stts`, `stsc`, `stsz`, `stco`/`co64` use run-length encoding appended as samples arrive. No end-pass rebuild.
3. **Codecs own their decoder config.** Each codec class takes a WebCodecs `decoderConfig.description` (or audio equivalent) and produces the correct sample entry (`avc1` + `avcC`, `hvc1` + `hvcC`, etc.). New codec = new file in `codecs/`.
4. **Targets are dumb.** `Target` interface is `{ write(offset, data), seek?(offset), finish() }`. All MP4 logic lives in the muxer. Presence of `seek` gates faststart support.
5. **No hidden state between tracks.** Each `Track` is self-contained (own sample table, codec, timestamp tracker). The orchestrator calls `track.flush()` at the right moments.

### Data flow

**Progressive (`fastStart: false`)**

```
addVideoChunk → VideoTrack.appendSample
              → SampleTable.record(offset, size, duration, keyframe)
              → Writer writes mdat payload directly to Target
finalize(): build moov from sample tables → write moov → Target.finish()
```

**Faststart (`'in-memory'`)**

```
addVideoChunk → BufferedWriter appends to memory
finalize(): build moov (sample offsets patched for moov size)
         → write ftyp → write moov → flush buffered mdat → Target.finish()
```

**Fragmented (`'fragmented'`)**

```
addVideoChunk → FragmentBuilder accumulates samples
  when (fragmentDuration reached || keyframe && min elapsed):
    flush fragment: write moof (tfhd/tfdt/trun per track) + write mdat
finalize(): optionally write mfra index → Target.finish()
```

### Async model

- All `add*` methods are **synchronous** (enqueue samples, trigger writes).
- `await muxer.finalize()` flushes and awaits target drain.
- Optional `await muxer.flush()` mid-stream to apply backpressure (resolves when target's `onData` promises settle).
- If `StreamTarget.onData` returns a promise, the muxer queues internally and propagates backpressure through `flush()`/`finalize()`.

## Targets

```ts
// ArrayBuffer target — collects everything, exposes buffer on completion.
// Implements the Target contract with internal seek support, so it supports all fastStart modes.
class ArrayBufferTarget {
  readonly buffer: ArrayBuffer // populated after finalize()
}

// Stream target — callback-based, universally portable.
// No `seek`, so it only supports `fastStart: false` and `'fragmented'` by default.
type StreamTargetOptions = {
  onData: (chunk: { offset: number; data: Uint8Array }) => void | Promise<void>
  onFinish?: () => void | Promise<void>
  chunked?: boolean // batch writes into ~1MB blocks
}
class StreamTarget {
  constructor(options: StreamTargetOptions)
}
```

Users needing `fastStart: 'in-memory'` with a stream destination can supply a custom target
that implements `seek` (e.g., a File System Access writable with `write({ type: 'seek' })`).

Users wire `StreamTarget` to any destination: File System Access API, Node `fs.createWriteStream`, `fetch`-based upload, MediaSource Extensions, or in-memory `Blob` builder.

## Debug Observer (separate entry point)

```ts
// Imported separately so production bundles tree-shake it out
import { attachDebugObserver } from 'mp4craft/debug'

attachDebugObserver(muxer, {
  onBoxEmitted: (box) => {},
  onSampleAdded: (track, sample) => {},
  onFragmentFlushed: (fragment) => {},
})
```

Used by the playground's `BoxTreeView` and `Timeline`. Also available to library consumers who want to build their own tooling. Adds zero cost to users who don't import it.

## Playground

A local-only dev lab (never deployed, never tested). Scenarios:

1. **CameraRecorder** — `getUserMedia` → `VideoEncoder` → `Mp4Muxer` → `<video>` preview.
2. **ScreenRecorder** — `getDisplayMedia` → encode → download via File System Access.
3. **CanvasAnimation** — animated canvas → `VideoFrame` → encode → mux.
4. **AudioOnly** — audio-only MP4 (Opus or AAC).
5. **FmP4Live** — fragmented output piped to `MediaSource` for live playback. Strongest demo of why fMP4 matters.
6. **StressTest** — configurable duration/codec/fastStart mode; benchmarks samples/sec, memory, output size.

Shared components:

- `BoxTreeView` — collapsible tree of the MP4 box structure (via debug observer).
- `HexInspector` — paginated hex + ASCII view of output bytes.
- `Timeline` — per-track timestamps, keyframes, fragment boundaries.
- `Stats` — bytes written, samples/sec, memory usage, wall-clock time.
- `CodecSelector` — picks codec + encoder config.

Playground depends on `mp4craft` via `workspace:*`. Vite consumes engine source directly through tsconfig project references — no build step for engine during dev. Plain CSS (CSS variables), no UI framework.

## Tooling

- **TypeScript** 5.x, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. `target: ES2022`, `moduleResolution: bundler`.
- **Build:** `tsup` for engine. ESM only. Two entries: `index`, `debug`. Types emitted.
- **Lint:** `oxlint` (Rust-based). Categories: correctness (error), suspicious (warn), perf (warn).
- **Format:** `oxfmt` (Rust-based). Defaults.
- **Test:** `vitest`. Unit + integration + golden-file. Node environment (engine is pure bytes in/out; no jsdom needed).
- **Test oracle:** `mp4box` as a **devDependency only** — validates our output is spec-compliant. Never shipped to users.
- **Absolute imports:** `tsconfig.paths` `@/*` → `src/*` in both packages. Vite `resolve.alias` mirrors this for the playground.
- **No Biome, no ESLint, no Prettier.** Per user preference.

## Package.json (engine)

```jsonc
{
  "name": "mp4craft",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs" },
    "./debug": { "types": "./dist/debug.d.mts", "import": "./dist/debug.mjs" },
  },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20" },
  "dependencies": {},
  "devDependencies": {
    "mp4box": "^0.5",
    "tsup": "^8",
    "typescript": "^5",
    "vitest": "^2",
    "oxlint": "*",
    "oxfmt": "*",
  },
}
```

## Testing Strategy

- **Unit** — per-box serialization (bytes match fixtures), per-codec decoder config parse/emit, sample-table RLE correctness, Writer endianness, NALU Annex B conversions.
- **Integration** — full `Mp4Muxer` runs with pre-encoded fixture chunks in `tests/fixtures/`; output parsed by MP4Box.js; assert track count, codecs, duration, sample counts.
- **Golden files** — reference MP4s in `tests/golden/`; byte-diff on CI catches accidental output changes.
- **Fuzz-lite** — randomized timestamps, varying sample sizes, duration edge cases (zero, negative, huge jumps, out-of-order).
- **Playback check** — manual, via the playground, before any release.

## Versioning & Release

- `v0.x` until API stable across 2–3 real-world uses.
- `@changesets/cli` manages versions and CHANGELOG.
- Manual `pnpm build && changeset publish`. No auto-publish from `main`.

## CI

GitHub Actions on push & PR: `pnpm install --frozen-lockfile`, then `lint`, `format:check`, `typecheck`, `test`, `build`. Node 20.

## Open questions / future (not v1)

- Multiple tracks of same type (multi-audio/language).
- Subtitle & caption tracks (WebVTT → `tx3g`/`stpp`).
- HDR/WCG metadata (BT.2020, PQ/HLG color spec).
- Edit lists, chapters, cover art.
- WebM muxer as a sibling package (`webm-craft`?) reusing `packages/core/src/io/`.
- Browser-side smoke tests with Playwright.

## Approval log

- Name: **`mp4craft`** (2026-04-17)
- Root class: **`Mp4Muxer`** (2026-04-17)
- Feature scope: **B** — essentials + fMP4 (2026-04-17)
- Input model: **C** — WebCodecs primary + raw path (2026-04-17)
- Output targets: **B** — `ArrayBufferTarget` + `StreamTarget` (2026-04-17)
- API/async model: **C** — sync `add*`, async `finalize` (2026-04-17)
- Monorepo layout: **`packages/core/`** + **`packages/playground/`** (2026-04-17)
- Lint/format: **oxlint + oxfmt** (2026-04-17)
- Testing oracle: **MP4Box.js as devDependency** (2026-04-17)
- Playground: **6 scenarios, React+Vite, plain CSS, no UI framework** (2026-04-17)

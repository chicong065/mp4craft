# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Root scripts (pnpm workspace with two packages):

- `pnpm dev`: Run the playground at http://localhost:5173.
- `pnpm build`: Build the core package (`mp4craft`) via `tsup`.
- `pnpm test`: Run the core package's vitest suite (unit, integration, and golden).
- `pnpm typecheck`: Strict TypeScript check across every package via `tsc -b --noEmit`.
- `pnpm lint`: `oxlint` across the monorepo.
- `pnpm format` / `pnpm format:check`: `oxfmt` across the monorepo.

Package-scoped:

- `pnpm --filter mp4craft test:watch`: Vitest watch mode for core.
- `pnpm --filter @mp4craft/playground build`: Playground typecheck plus Vite production build.

Run a single test file: `pnpm --filter mp4craft exec vitest run packages/core/tests/unit/<file>.test.ts`. Run a single test case: add `-t "<test name>"`.

Lint or format a specific file: `pnpm lint <file>`, `pnpm format <file>`.

## Repository layout

- `packages/core/`: The published `mp4craft` library. Zero-dep pure TypeScript. Public API barrel is `packages/core/src/index.ts`.
- `packages/playground/`: React + Vite playground. Interactive scenarios plus a `/docs` page that together exercise every public code path in the core library.
- `docs/superpowers/`: Design specs and implementation plans (`specs/` and `plans/` subdirectories).
- `docs/logo.svg`: Repo logo referenced from the README hero.
- `DESIGN.md`: Design system reference that the playground UI must conform to.

## Core library architecture

The core package follows a strict single-responsibility module layout. Understanding the separation is the fastest way to orient:

- `src/muxer/mp4-muxer.ts`: The `Mp4Muxer` orchestrator. Holds the lifecycle state machine, per-track state, chunk-offset tracking, and the mode-specific finalize paths (`finalizeProgressive`, `finalizeInMemory`, `finalizeFragmented`). Delegates per-box serialization to `boxes/`, codec wiring to `codecs/factory.ts`, and shared byte helpers to `io/bytes.ts`.
- `src/codecs/`: Split into `video/` (avc, hevc, vp9, av1) and `audio/` (aac, opus, mp3, flac, pcm), each implementing the corresponding `VideoCodecAdapter` or `AudioCodecAdapter` interface from `codec.ts`. The `createVideoCodec` and `createAudioCodec` factories plus `computeCompatibleBrands` live in `codecs/factory.ts`.
- `src/boxes/`: One file per ISO BMFF box type (`ftyp`, `moov`, `trak`, `mdia`, `stbl`, `stts`, `stsz`, `stsc`, `stco`, `stss`, `moof`, `tfhd`, `trun`, and so on). Each file exports a factory that returns a `Box` with a `write(writer)` closure. `boxes/box.ts` defines the `Box` type, the `FourCC` union, and the `writeBox` helper that prepends the 4-byte size plus 4-byte fourcc header. `boxes/full-box.ts` wraps a `Box` with the FullBox version plus flags fields.
- `src/targets/`: Sink implementations. `target.ts` is the interface, `array-buffer-target.ts` is the in-memory sink, `stream-target.ts` is the sequential callback sink.
- `src/tracks/timestamp-tracker.ts`: First-timestamp policy (`offset`, `strict`, `permissive`) and keyframe bookkeeping for `stss`.
- `src/io/writer.ts`: Byte-buffer writer with absolute-offset writes and a seekable cursor. Every box writer receives this. Tests can instantiate it standalone.
- `src/io/bytes.ts`: Shared `toUint8Array` and `copyToOwnedArrayBuffer` helpers used by every codec adapter.
- `src/types/`: Public config types (`MuxerOptions`, `VideoTrackConfig`, `AudioTrackConfig` discriminated union), sample inputs (`VideoSampleInput`, `AudioSampleInput`), and error classes (`Mp4CraftError` plus subclasses). The `assertNever` exhaustiveness helper lives here.

When adding a codec: add an adapter in `src/codecs/video/` or `src/codecs/audio/`, wire it into the corresponding factory in `codecs/factory.ts`, add a variant to the `VideoCodec` or `AudioCodec` union (and to the `AudioTrackConfig` discriminated union if audio) in `types/config.ts`, and add a unit test in `tests/unit/codec-<name>.test.ts`.

## Test strategy

Three tiers under `packages/core/tests/`:

- `unit/`: Pure logic and byte-layout tests. Each codec, each box, and the writer have their own file. Tests hard-code expected byte sequences with the spec section they come from in a preceding comment.
- `integration/`: End-to-end muxer runs that parse the output with an independent MP4 parser and assert structural conformance. One file per codec and one per fast-start mode.
- `golden/`: Byte-exact comparisons against a committed `.mp4` fixture. Regenerate with `tsx tests/golden/build-golden.mts`.

`tests/fixtures/avcc.bin` is a real AVCDecoderConfigurationRecord harvested from an ffmpeg run. `tests/fixtures/build-fixtures.mjs` regenerates it.

## Playground architecture

- `packages/playground/src/App.tsx`: Router. All scenario routes plus `/docs` plus home.
- `packages/playground/src/scenarios/scenario-catalog.ts`: Single source of truth for scenario path, title, description, and tags. Drives both the AppShell nav and the HomeView card grid.
- `packages/playground/src/layout/AppShell.tsx`: Sticky header (brand, tagline, Docs, GitHub, npm links), scenario pill nav with horizontal overflow scroll, dark footer with three columns.
- `packages/playground/src/views/DocsView.tsx`: The `/docs` reference page. Uses `CodeBlock.tsx` which uses the hand-rolled TypeScript tokenizer at `lib/highlight-typescript.ts` instead of adding Shiki or Prism.
- `packages/playground/src/views/HomeView.tsx`: Landing page grid of scenario cards.
- `packages/playground/src/components/`: Design-system primitives only (Card, PillButton, DarkButton, CodecSelector, Stats, CodeBlock).
- Scenario files (`scenarios/*.tsx`) each own their full state machine. All follow the same rhythm: `RecordingPhase` union type, mutable session state held in a single ref, telemetry via `requestAnimationFrame` throttled to 100 ms, and `Record<Phase, () => JSX.Element>` dispatch for rendering.
- `packages/playground/src/lib/encoders.ts`: Shared WebCodecs `VideoEncoder` and `AudioEncoder` factories with a `firstDescription` promise helper.
- `packages/playground/src/lib/synthetic-codec-config.ts`: Byte constants for minimal-valid decoder configurations used by StressTest and CodecMatrix. Extend here when adding a codec to those scenarios.

## Conventions that are load-bearing

**Tooling.** This repo uses `oxlint` and `oxfmt` only. Never Biome, ESLint, or Prettier. The root scripts are the only commands needed. Do not invent tool configurations.

**Strict TS flags.** `tsconfig.base.json` enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. CSS-module property access therefore returns `string | undefined`, which matters when mapping tokens to class names (see `CodeBlock.tsx` and `PillButton.tsx` for the `?? ""` fallback pattern).

**Identifier style.** Every identifier in both packages is fully self-descriptive. No `buf`, `ctx`, `pos`, `cap`, `e`, `err`, `res`, single-letter locals, or abbreviations. Use `videoSampleCount` rather than `n`, `drawingContext` rather than `ctx`, `replayIndex` rather than `i`. Loop counters included.

**Dispatch style.** Never chain `if` or `else if` on the same discriminant. Use `Record<Union, T>` lookup tables for value mappings and `switch` for construction logic. Phase renderers and codec-adapter factories follow this pattern throughout.

**Curly braces.** Every control-flow block uses braces, even a single-statement body. Applies to `if`, `else`, `for`, `for...of`, `while`, and `do...while`, in production code, tests, and README or doc snippets alike.

**Inline documentation.** Public API gets TSDoc blocks with spec citations (ISO/IEC 14496-xx §y, VP9 ISOBMFF §z, Opus-in-ISOBMFF §4.3.2, and so on). Present-tense third-person voice. No em-dashes, prose semicolons, or arrow glyphs (`→`, `⇒`) in comments, JSDoc, UI copy, README, or chat replies. Hyphens inside compound words (`pass-1`, `self-describing`) are fine. The ban is on dash-as-punctuation.

**No hardcoded counts in prose.** Do not write literal item counts ("eight scenarios", "five codecs") in README, UI copy, or docs. They go stale the moment an item is added or removed. Use "every", "all", or describe the category. Enumerated feature bullets that list items by name are fine because the list itself carries the count.

**DESIGN.md compliance.** The playground UI must match `/DESIGN.md`: white-dominant palette, DM Sans for UI text, Outfit for display, pill nav, `#181e25` primary CTA, and brand-blue (`#1456f0`) accent for the wordmark. Tokens live in `packages/playground/src/tokens.css`.

**React 18 ref typing.** `useRef<T | null>(null)` produces `React.MutableRefObject<T | null>`, not `React.RefObject<T>`. When threading the ref through a props type (e.g. `PhaseRenderInputs`), declare the field as `React.MutableRefObject<T | null>` to satisfy strict typechecking.

## WebCodecs quirks to remember

These recur across scenarios and took multiple iterations to get right. If touching a scenario that uses WebCodecs, verify it still handles them:

1. **VP9 decoder description is never emitted.** Chrome's VP9 `VideoEncoder` does not populate `metadata.decoderConfig.description`. Synthesize the `vpcC` payload from the codec string instead of awaiting a description that never arrives. See `CanvasAnimation.tsx` for the implementation.
2. **Chrome's Opus description is an OpusHead, not a dOps payload.** The two formats differ in magic prefix, endianness, and version. Convert before passing to the muxer. See `AudioOnly.tsx` for the converter.
3. **`EncodedVideoChunk.duration` is undefined for MediaStream-sourced frames.** The muxer writes `chunk.duration ?? 0`, which yields a zero-second MP4. Use the "pending chunk" pattern: hold each chunk until its successor arrives and compute duration from the timestamp delta. Flush the trailing chunk at stop with a framerate-derived fallback. See `ScreenRecorder.tsx` and `CameraRecorder.tsx`.

## Git operations

The repository owner performs all git operations (add, commit, branch, push). Never create commits from an automated session.

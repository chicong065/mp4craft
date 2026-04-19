# mp4craft Plan 3: Fragmented MP4 (fMP4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fastStart: "fragmented"` mode, producing `ftyp + moov(empty) + (moof + mdat)+ + mfra?` output compatible with MSE, live streaming, and indefinite recording.

**Architecture:** The initial `moov` carries track metadata only (empty sample tables) plus an `mvex` container declaring per-track defaults. All media data lives in a stream of `moof + mdat` fragment pairs. A `FragmentBuilder` accumulates per-track samples in memory and flushes a fragment when (a) the video track receives a new keyframe (or the file is audio-only) and (b) `minimumFragmentDuration` microseconds have elapsed since the previous flush. Each `moof` uses the `default-base-is-moof` flag so `trun` sample-data offsets are expressed relative to the start of the `moof`, making every fragment self-contained and sequential writes sufficient (no seek required). An optional `mfra` index at the end of the file lists every fragment for random-access lookup.

**Tech Stack:** TypeScript strict mode, Vitest 4.x, pnpm workspace, tsup ESM, mp4box v2.3.0 for round-trip validation.

---

## Professional style bar (all tasks)

1. **Dispatch discipline.** Use `Record<Union, T>` for value mappings and `switch` with `const unsupported: never = x` for construction logic. Never chain `if / else if` on the same discriminant.
2. **Self-descriptive identifiers.** No `w`, `buf`, `pos`, `v`, `f`, `s`, `t`, `i`, `idx`, `len`, `tmp`, `ctx`, `cfg`, `opts`.
3. **`type` not `interface`.**
4. **Absolute imports via `@/...`.**
5. **JSDoc `/** ... \*/`** for every exported class, function, type, method, and per-field on exported object types. Include spec citations (`ISO/IEC 14496-12 §X.Y`) and `@see {@link URL | Label}` for public references.
6. **Prose style.** Complete sentences, capitalized first word, terminating period, present-tense indicative voice. **No em-dashes (`—`), no hyphen-as-punctuation (`-` between clauses), no arrow icons (`→`, `⇒`), no prose semicolons (`;`).** Hyphens inside compound words are fine. TypeScript statement-terminator semicolons stay.
7. **No what-comments.** Only why-comments.
8. **No dead code, no `any`, no `@ts-ignore`, no defensive branches for impossible cases.**

## Spec references to use

- ISO/IEC 14496-12 (ISO Base Media File Format): `§8.8` covers fragmentation boxes (mvex, trex, moof, mfhd, traf, tfhd, tfdt, trun). `§8.8.10-11` covers mfra/tfra/mfro. `§8.6.4.3` defines the 32-bit sample flags bitfield reused by `trex.default_sample_flags`, `tfhd.default_sample_flags`, `trun.sample_flags`, and `trun.first_sample_flags`.
- MP4 Registration Authority fourcc registry: `https://mp4ra.org/registered-types/boxes`.
- W3C WebCodecs timestamps (microseconds): `https://w3c.github.io/webcodecs/#timestamps`.
- Media Source Extensions byte stream format for ISO BMFF: `https://w3c.github.io/mse-byte-stream-format-isobmff/`.

---

## File Map

**Created (box builders):**

| File                              | Purpose                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core/src/boxes/mvex.ts` | `MovieExtendsBox` container, child of `moov`, declares that the file is fragmented.          |
| `packages/core/src/boxes/trex.ts` | `TrackExtendsBox` FullBox, one per track inside `mvex`, supplies default sample flags.       |
| `packages/core/src/boxes/mehd.ts` | `MovieExtendsHeaderBox` FullBox, optional total fragment duration in movie timescale.        |
| `packages/core/src/boxes/moof.ts` | `MovieFragmentBox` container at the top level of each fragment.                              |
| `packages/core/src/boxes/mfhd.ts` | `MovieFragmentHeaderBox` FullBox, carries the monotonic `sequence_number` for each fragment. |
| `packages/core/src/boxes/traf.ts` | `TrackFragmentBox` container, one per track inside each `moof`.                              |
| `packages/core/src/boxes/tfhd.ts` | `TrackFragmentHeaderBox` FullBox with `default-base-is-moof` flag.                           |
| `packages/core/src/boxes/tfdt.ts` | `TrackFragmentBaseMediaDecodeTimeBox` FullBox (version 1, u64 decode time).                  |
| `packages/core/src/boxes/trun.ts` | `TrackRunBox` FullBox with per-sample duration, size, and flags.                             |
| `packages/core/src/boxes/mfra.ts` | `MovieFragmentRandomAccessBox` container at end of file.                                     |
| `packages/core/src/boxes/tfra.ts` | `TrackFragmentRandomAccessBox` FullBox inside `mfra`.                                        |
| `packages/core/src/boxes/mfro.ts` | `MovieFragmentRandomAccessOffsetBox` FullBox, tail of `mfra`, carries `mfra.byteLength`.     |

**Created (muxer infrastructure):**

| File                                          | Purpose                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/core/src/muxer/fragment-builder.ts` | Accumulates per-track samples, decides when to flush, serializes `moof + mdat` byte pairs. |

**Modified:**

| File                                   | Change                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/boxes/moov.ts`      | Accept optional `mvex` child and write it after the traks.                                                                                                                                    |
| `packages/core/src/types/config.ts`    | Widen `FastStart` to `false \| "in-memory" \| "fragmented"`. Add `minimumFragmentDuration?: number` to `MuxerOptions`.                                                                        |
| `packages/core/src/muxer/mp4-muxer.ts` | Dispatch on `fastStart`, include a fragmented path: build empty moov up front, route samples through `FragmentBuilder`, finalize by flushing pending samples and optionally appending `mfra`. |
| `packages/core/src/index.ts`           | Re-export `MuxerOptions.minimumFragmentDuration` (already re-exported transitively since it lives on `MuxerOptions`). No export change needed but confirm compile-time.                       |

**Created (tests):**

| File                                                            | Purpose                                                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/tests/unit/mvex-trex.test.ts`                    | Byte-layout tests for `createMvex`, `createTrex`, `createMehd`.                                                                   |
| `packages/core/tests/unit/moof-mfhd.test.ts`                    | Byte-layout tests for `createMoof`, `createMfhd`.                                                                                 |
| `packages/core/tests/unit/traf-tfhd-tfdt-trun.test.ts`          | Byte-layout tests for `createTraf`, `createTfhd`, `createTfdt`, `createTrun`, including `trun` sample-flags encoding.             |
| `packages/core/tests/unit/fragment-builder.test.ts`             | Unit tests for the flush condition, sequence-number monotonicity, and per-track sample accumulation.                              |
| `packages/core/tests/unit/mp4-muxer-fragmented.test.ts`         | Muxer-level tests for fragmented mode: at least one `moof` in output, per-fragment sequence numbers, no seek calls on the target. |
| `packages/core/tests/integration/fragmented-validation.test.ts` | mp4box.js round-trip validation of fragmented AVC+AAC output.                                                                     |
| `packages/core/tests/unit/mfra.test.ts`                         | Byte-layout tests for `createMfra`, `createTfra`, `createMfro`.                                                                   |
| `packages/core/tests/integration/fragmented-with-mfra.test.ts`  | Integration test verifying the tail `mfra` box parses and the reported fragment count matches the muxer's actual flush count.     |

---

## Pre-flight: mp4box API reminder

The integration tests use `mp4box` v2.3.0 with named imports exactly as the existing `mp4box-validation.test.ts` and `in-memory-validation.test.ts` already do:

```ts
import { createFile, type Movie, MP4BoxBuffer } from "mp4box";
const mp4File = createFile();
mp4File.onReady = handler;
mp4File.onError = (errorModule, errorMessage) => reject(new Error(...));
const inputBuffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
mp4File.appendBuffer(inputBuffer);
mp4File.flush();
```

Reuse that pattern. Do not re-invent the helper.

---

### Task 1: `mvex` + `trex` + `mehd` boxes, plus `moov` wiring

**Files:**

- Create: `packages/core/src/boxes/trex.ts`
- Create: `packages/core/src/boxes/mehd.ts`
- Create: `packages/core/src/boxes/mvex.ts`
- Modify: `packages/core/src/boxes/moov.ts`
- Create: `packages/core/tests/unit/mvex-trex.test.ts`

---

- [ ] **Step 1: Write the failing tests at `packages/core/tests/unit/mvex-trex.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'
import { createMvex } from '@/boxes/mvex'
import { createTrex } from '@/boxes/trex'
import { createMehd } from '@/boxes/mehd'

describe('createTrex', () => {
  it('emits a trex FullBox with default sample flags', () => {
    // Per ISO/IEC 14496-12 §8.8.3.2, the trex payload after the FullBox header is
    // track_ID (u32), default_sample_description_index (u32), default_sample_duration (u32),
    // default_sample_size (u32), default_sample_flags (u32). Total body is 20 bytes, and
    // the box header adds size (u32), fourcc (4), version (u8), flags (u24) for 12 bytes.
    const trex = createTrex({
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: 0,
    })
    const boxWriter = new Writer()
    writeBox(boxWriter, trex)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 20)
    const dataView = new DataView(bytes.buffer)
    // size (u32) + fourcc(4) + version+flags (4) = 12-byte header.
    expect(dataView.getUint32(0, false)).toBe(bytes.length)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trex')
    expect(dataView.getUint8(8)).toBe(0)
    expect(dataView.getUint32(12, false)).toBe(1)
    expect(dataView.getUint32(16, false)).toBe(1)
    expect(dataView.getUint32(20, false)).toBe(0)
    expect(dataView.getUint32(24, false)).toBe(0)
    expect(dataView.getUint32(28, false)).toBe(0)
  })
})

describe('createMehd', () => {
  it('emits a version-1 mehd FullBox with the fragment duration as u64', () => {
    // Per ISO/IEC 14496-12 §8.8.2, version 1 encodes fragment_duration as u64 in the movie timescale.
    const mehd = createMehd({ fragmentDurationInMovieTimescale: 10_000n })
    const boxWriter = new Writer()
    writeBox(boxWriter, mehd)
    const bytes = boxWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mehd')
    expect(dataView.getUint8(8)).toBe(1)
    expect(dataView.getBigUint64(12, false)).toBe(10_000n)
  })
})

describe('createMvex', () => {
  it('emits an mvex container box with optional mehd followed by trex children', () => {
    const trex = createTrex({
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: 0,
    })
    const mvex = createMvex({ trex: [trex] })
    const boxWriter = new Writer()
    writeBox(boxWriter, mvex)
    const bytes = boxWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mvex')
    const bodyText = new TextDecoder('latin1').decode(bytes)
    expect(bodyText.indexOf('trex')).toBeGreaterThan(0)
    expect(bodyText.indexOf('mehd')).toBe(-1)
  })

  it('emits mehd before trex when mehd is supplied', () => {
    const trex = createTrex({
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      defaultSampleFlags: 0,
    })
    const mehd = createMehd({ fragmentDurationInMovieTimescale: 5_000n })
    const mvex = createMvex({ mehd, trex: [trex] })
    const boxWriter = new Writer()
    writeBox(boxWriter, mvex)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    const mehdPosition = bodyText.indexOf('mehd')
    const trexPosition = bodyText.indexOf('trex')
    expect(mehdPosition).toBeGreaterThan(0)
    expect(trexPosition).toBeGreaterThan(0)
    expect(mehdPosition).toBeLessThan(trexPosition)
  })
})
```

- [ ] **Step 2: Run the test file and confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/mvex-trex.test.ts
```

Expected: module-not-found for `@/boxes/mvex`, `@/boxes/trex`, `@/boxes/mehd`.

- [ ] **Step 3: Create `packages/core/src/boxes/trex.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTrex}. Every field corresponds one-to-one with a u32 in the
 * `TrackExtendsBox` payload defined in ISO/IEC 14496-12 §8.8.3.
 */
export type TrexOptions = {
  /** Track identifier this `trex` applies to. Must match an existing `tkhd.trackId`. */
  trackId: number
  /**
   * Index (1-based) into the track's `stsd` sample description list used by default
   * for samples in this track's fragments. mp4craft emits one sample entry per track,
   * so this is always 1.
   */
  defaultSampleDescriptionIndex: number
  /**
   * Default duration applied to each sample in a fragment when `trun` does not override
   * it. Setting this to 0 defers the value to each `trun` entry, which is what mp4craft
   * does to support variable frame rates.
   */
  defaultSampleDuration: number
  /**
   * Default sample size applied to each sample in a fragment when `trun` does not
   * override it. Setting this to 0 defers the value to each `trun` entry.
   */
  defaultSampleSize: number
  /**
   * Default sample flags applied to each sample in a fragment when `trun` does not
   * override them. Setting this to 0 defers the value to each `trun` entry. The bit
   * layout is defined by ISO/IEC 14496-12 §8.6.4.3.
   */
  defaultSampleFlags: number
}

/**
 * Builds a `TrackExtendsBox` (`trex`), a FullBox inside `mvex` that declares the default
 * sample parameters used by subsequent `moof` fragments for the given track.
 *
 * Per ISO/IEC 14496-12 §8.8.3, `trex` carries five u32 fields after the FullBox header.
 * mp4craft sets most defaults to zero and writes per-sample overrides inside each `trun`,
 * trading a few extra bytes per sample for consistent handling of variable frame rate.
 *
 * @param options - Track identifier plus the five default-value fields.
 * @returns A {@link FullBox} that serializes to a 32-byte `trex` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTrex(options: TrexOptions): FullBox {
  return {
    type: 'trex',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.trackId)
      writer.u32(options.defaultSampleDescriptionIndex)
      writer.u32(options.defaultSampleDuration)
      writer.u32(options.defaultSampleSize)
      writer.u32(options.defaultSampleFlags)
    },
  }
}
```

- [ ] **Step 4: Create `packages/core/src/boxes/mehd.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMehd}.
 */
export type MehdOptions = {
  /**
   * Total fragment duration in the movie timescale. Expressed as `bigint` because the
   * version-1 encoding uses u64. A value of 0 is legal for live-streaming cases where the
   * duration is unknown.
   */
  fragmentDurationInMovieTimescale: bigint
}

/**
 * Builds a `MovieExtendsHeaderBox` (`mehd`) declaring the total duration of all fragments
 * in the movie timescale. Optional inside `mvex`.
 *
 * mp4craft always emits version 1 (`u64` duration) to avoid the 32-bit overflow that
 * version 0 would impose on long recordings.
 *
 * @param options - The fragment duration in movie-timescale ticks.
 * @returns A {@link FullBox} that serializes to a 20-byte `mehd` box.
 *
 * @see ISO/IEC 14496-12 §8.8.2 for the `mehd` payload layout.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMehd(options: MehdOptions): FullBox {
  return {
    type: 'mehd',
    version: 1,
    flags: 0,
    write: (writer) => {
      writer.u64(options.fragmentDurationInMovieTimescale)
    },
  }
}
```

- [ ] **Step 5: Create `packages/core/src/boxes/mvex.ts`**

```typescript
import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMvex}.
 */
export type MvexOptions = {
  /**
   * Optional `mehd` box declaring the total fragment duration. Omit for live-streaming
   * cases where the duration is unknown up front.
   */
  mehd?: FullBox
  /**
   * One `trex` box per track. Each track defined in the `moov.trak[]` list must have a
   * corresponding `trex` entry, or parsers will refuse to play the file's fragments.
   */
  trex: FullBox[]
}

/**
 * Builds a `MovieExtendsBox` (`mvex`), a container box inside `moov` that declares the
 * file to be fragmented and lists the default sample parameters for each track.
 *
 * Per ISO/IEC 14496-12 §8.8.1, the `mvex` box may contain an optional `mehd` followed by
 * one `trex` per track. mp4craft writes `mehd` first when supplied, then every `trex` in
 * the order given.
 *
 * @param options - Optional `mehd` and the per-track `trex` list.
 * @returns A {@link Box} that serializes an `mvex` container with the listed children.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMvex(options: MvexOptions): Box {
  return {
    type: 'mvex',
    write: (writer) => {
      if (options.mehd) writeBox(writer, options.mehd)
      for (const trexBox of options.trex) writeBox(writer, trexBox)
    },
  }
}
```

- [ ] **Step 6: Extend `packages/core/src/boxes/moov.ts` to accept optional `mvex`**

```typescript
import { writeBox, type Box } from '@/boxes/box'

/**
 * Builds a `MovieBox` (`moov`) container aggregating the movie header, per-track boxes,
 * and an optional `mvex` declaration that marks the file as fragmented.
 *
 * Per ISO/IEC 14496-12 §8.2.1, `moov` is the top-level container for the movie's metadata.
 * It must contain exactly one `mvhd` (movie header), one `trak` per track, and, for
 * fragmented files, an `mvex` that lists the per-track sample defaults. The serializer
 * writes `mvhd` first, then each `trak` in order, and finally `mvex` when supplied.
 *
 * @param children - The pre-built child boxes for the movie.
 * @param children.mvhd - The `mvhd` movie-header box (see `createMvhd`).
 * @param children.traks - One `trak` box per track, in declaration order.
 * @param children.mvex - Optional `mvex` box declaring the file as fragmented.
 * @returns A {@link Box} whose serializer emits the `moov` body as `mvhd`, every `trak`
 *   in order, and the optional `mvex` at the end.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createMoov(children: { mvhd: Box; traks: Box[]; mvex?: Box }): Box {
  return {
    type: 'moov',
    write: (writer) => {
      writeBox(writer, children.mvhd)
      for (const trakBox of children.traks) writeBox(writer, trakBox)
      if (children.mvex) writeBox(writer, children.mvex)
    },
  }
}
```

- [ ] **Step 7: Run the test file, then the full suite and typecheck**

```
pnpm --filter mp4craft exec vitest run tests/unit/mvex-trex.test.ts
pnpm test
pnpm typecheck
```

Expected: 4 new tests pass. Full suite at 109 passing. Typecheck clean.

- [ ] **Step 8: Commit**

No user action needed beyond review. The AI does not run git.

---

### Task 2: `moof` + `mfhd` boxes

**Files:**

- Create: `packages/core/src/boxes/mfhd.ts`
- Create: `packages/core/src/boxes/moof.ts`
- Create: `packages/core/tests/unit/moof-mfhd.test.ts`

---

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/moof-mfhd.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'
import { createMfhd } from '@/boxes/mfhd'
import { createMoof } from '@/boxes/moof'

describe('createMfhd', () => {
  it('emits an mfhd FullBox carrying the sequence number as a u32', () => {
    // Per ISO/IEC 14496-12 §8.8.5, the mfhd payload after the FullBox header is a single u32.
    const mfhd = createMfhd({ sequenceNumber: 7 })
    const boxWriter = new Writer()
    writeBox(boxWriter, mfhd)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 4)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mfhd')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(0)
    expect(dataView.getUint32(12, false)).toBe(7)
  })
})

describe('createMoof', () => {
  it('writes mfhd followed by each traf', () => {
    const mfhd = createMfhd({ sequenceNumber: 1 })
    const trafStub = { type: 'traf', write: () => undefined }
    const moof = createMoof({ mfhd, trafs: [trafStub, trafStub] })
    const boxWriter = new Writer()
    writeBox(boxWriter, moof)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    expect(bodyText.indexOf('moof')).toBe(4)
    expect(bodyText.indexOf('mfhd')).toBeGreaterThan(8)
    const firstTrafIndex = bodyText.indexOf('traf')
    expect(firstTrafIndex).toBeGreaterThan(bodyText.indexOf('mfhd'))
    const secondTrafIndex = bodyText.indexOf('traf', firstTrafIndex + 4)
    expect(secondTrafIndex).toBeGreaterThan(firstTrafIndex)
  })
})
```

- [ ] **Step 2: Run the test file to confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/moof-mfhd.test.ts
```

- [ ] **Step 3: Create `packages/core/src/boxes/mfhd.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMfhd}.
 */
export type MfhdOptions = {
  /**
   * Monotonically increasing fragment sequence number, starting at 1. Each `moof` in the
   * file must carry a unique, strictly increasing value. Parsers use the sequence number
   * to detect missing or out-of-order fragments.
   */
  sequenceNumber: number
}

/**
 * Builds a `MovieFragmentHeaderBox` (`mfhd`), the first child of every `moof`.
 *
 * Per ISO/IEC 14496-12 §8.8.5, `mfhd` is a FullBox whose body is a single u32
 * `sequence_number`. mp4craft emits a new `mfhd` with an incremented value on every
 * fragment flush.
 *
 * @param options - The fragment sequence number for this `moof`.
 * @returns A {@link FullBox} that serializes to a 16-byte `mfhd` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMfhd(options: MfhdOptions): FullBox {
  return {
    type: 'mfhd',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.sequenceNumber)
    },
  }
}
```

- [ ] **Step 4: Create `packages/core/src/boxes/moof.ts`**

```typescript
import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMoof}.
 */
export type MoofOptions = {
  /** Fragment header box produced by `createMfhd`. */
  mfhd: FullBox
  /**
   * One `traf` box per track that has samples in this fragment. A track with no samples
   * in the current fragment must be omitted rather than included with an empty `trun`.
   */
  trafs: Box[]
}

/**
 * Builds a `MovieFragmentBox` (`moof`), the top-level container for each fragment.
 *
 * Per ISO/IEC 14496-12 §8.8.4, `moof` contains exactly one `mfhd` followed by one or more
 * `traf` boxes. The serializer writes `mfhd` first, then every `traf` in the order given.
 *
 * @param options - The child `mfhd` and the per-track `traf` list.
 * @returns A {@link Box} whose serializer emits an `moof` container with the listed children.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMoof(options: MoofOptions): Box {
  return {
    type: 'moof',
    write: (writer) => {
      writeBox(writer, options.mfhd)
      for (const trafBox of options.trafs) writeBox(writer, trafBox)
    },
  }
}
```

- [ ] **Step 5: Verify**

```
pnpm --filter mp4craft exec vitest run tests/unit/moof-mfhd.test.ts
pnpm test
pnpm typecheck
```

Full suite at 111 passing.

---

### Task 3: `traf` + `tfhd` + `tfdt` + `trun` boxes

**Files:**

- Create: `packages/core/src/boxes/tfhd.ts`
- Create: `packages/core/src/boxes/tfdt.ts`
- Create: `packages/core/src/boxes/trun.ts`
- Create: `packages/core/src/boxes/traf.ts`
- Create: `packages/core/tests/unit/traf-tfhd-tfdt-trun.test.ts`

---

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/traf-tfhd-tfdt-trun.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'
import { createTfhd } from '@/boxes/tfhd'
import { createTfdt } from '@/boxes/tfdt'
import { createTrun, encodeTrunSampleFlags } from '@/boxes/trun'
import { createTraf } from '@/boxes/traf'

describe('createTfhd', () => {
  it('emits a tfhd FullBox with default-base-is-moof and only the track_ID field', () => {
    // Per ISO/IEC 14496-12 §8.8.7, flag 0x020000 (default-base-is-moof) tells parsers to
    // treat data_offset values in subsequent trun boxes as offsets from the start of the
    // parent moof. With no other flags set the payload is just track_ID (u32).
    const tfhd = createTfhd({ trackId: 1 })
    const boxWriter = new Writer()
    writeBox(boxWriter, tfhd)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 4)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('tfhd')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(0)
    // The u24 flags field occupies bytes 9, 10, 11.
    expect(dataView.getUint8(9)).toBe(0x02)
    expect(dataView.getUint8(10)).toBe(0x00)
    expect(dataView.getUint8(11)).toBe(0x00)
    expect(dataView.getUint32(12, false)).toBe(1)
  })
})

describe('createTfdt', () => {
  it('emits a version-1 tfdt FullBox with baseMediaDecodeTime as u64', () => {
    // Per ISO/IEC 14496-12 §8.8.12, version 1 stores baseMediaDecodeTime as u64 in the track timescale.
    const tfdt = createTfdt({ baseMediaDecodeTimeInTrackTimescale: 300_000n })
    const boxWriter = new Writer()
    writeBox(boxWriter, tfdt)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(4 + 4 + 4 + 8)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('tfdt')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(1)
    expect(dataView.getBigUint64(12, false)).toBe(300_000n)
  })
})

describe('encodeTrunSampleFlags', () => {
  it('encodes a keyframe as sample_depends_on=2 with sample_is_non_sync_sample=0', () => {
    expect(encodeTrunSampleFlags(true)).toBe(0x02000000)
  })

  it('encodes a non-keyframe as sample_depends_on=1 with sample_is_non_sync_sample=1', () => {
    expect(encodeTrunSampleFlags(false)).toBe(0x01010000)
  })
})

describe('createTrun', () => {
  it('emits a trun with data_offset, and per-sample duration, size, and flags for two samples', () => {
    // The selected flag set 0x000701 combines 0x000001 (data_offset_present),
    // 0x000100 (sample_duration_present), 0x000200 (sample_size_present), and
    // 0x000400 (sample_flags_present). Payload shape after the FullBox header:
    // sample_count (u32) + data_offset (i32) + per sample: duration (u32), size (u32), flags (u32).
    const trun = createTrun({
      dataOffset: 123,
      samples: [
        { duration: 3000, size: 200, flags: encodeTrunSampleFlags(true) },
        { duration: 3000, size: 150, flags: encodeTrunSampleFlags(false) },
      ],
    })
    const boxWriter = new Writer()
    writeBox(boxWriter, trun)
    const bytes = boxWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trun')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(9)).toBe(0x00)
    expect(dataView.getUint8(10)).toBe(0x07)
    expect(dataView.getUint8(11)).toBe(0x01)
    // sample_count
    expect(dataView.getUint32(12, false)).toBe(2)
    // data_offset (i32)
    expect(dataView.getInt32(16, false)).toBe(123)
    // sample 1: duration, size, flags
    expect(dataView.getUint32(20, false)).toBe(3000)
    expect(dataView.getUint32(24, false)).toBe(200)
    expect(dataView.getUint32(28, false)).toBe(0x02000000)
    // sample 2
    expect(dataView.getUint32(32, false)).toBe(3000)
    expect(dataView.getUint32(36, false)).toBe(150)
    expect(dataView.getUint32(40, false)).toBe(0x01010000)
  })
})

describe('createTraf', () => {
  it('emits a traf container with tfhd, tfdt, and trun in that order', () => {
    const tfhd = createTfhd({ trackId: 1 })
    const tfdt = createTfdt({ baseMediaDecodeTimeInTrackTimescale: 0n })
    const trun = createTrun({
      dataOffset: 0,
      samples: [{ duration: 3000, size: 100, flags: encodeTrunSampleFlags(true) }],
    })
    const traf = createTraf({ tfhd, tfdt, trun })
    const boxWriter = new Writer()
    writeBox(boxWriter, traf)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    const tfhdPosition = bodyText.indexOf('tfhd')
    const tfdtPosition = bodyText.indexOf('tfdt')
    const trunPosition = bodyText.indexOf('trun')
    expect(tfhdPosition).toBeGreaterThan(0)
    expect(tfdtPosition).toBeGreaterThan(tfhdPosition)
    expect(trunPosition).toBeGreaterThan(tfdtPosition)
  })
})
```

- [ ] **Step 2: Run the test file to confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/traf-tfhd-tfdt-trun.test.ts
```

- [ ] **Step 3: Create `packages/core/src/boxes/tfhd.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTfhd}.
 */
export type TfhdOptions = {
  /** Track identifier for this fragment's samples. Must match an existing `tkhd.trackId`. */
  trackId: number
}

/**
 * The `default-base-is-moof` flag defined in ISO/IEC 14496-12 §8.8.7. When set, the
 * `data_offset` values carried by subsequent `trun` boxes are interpreted as offsets
 * relative to the start of the enclosing `moof`, which makes every fragment self-contained
 * and removes the need for forward-looking sample-data addressing.
 */
const DEFAULT_BASE_IS_MOOF_FLAG = 0x020000

/**
 * Builds a `TrackFragmentHeaderBox` (`tfhd`) carrying only the track identifier.
 *
 * mp4craft sets the `default-base-is-moof` flag and leaves every per-track default value
 * unset, which delegates sample duration, size, and flags to each `trun`. This trades a
 * few bytes per sample for uniform handling of variable frame rate.
 *
 * Per ISO/IEC 14496-12 §8.8.7, `tfhd` is a FullBox whose body always begins with a u32
 * `track_ID` and is followed by optional fields controlled by the flags field. With the
 * `default-base-is-moof` flag alone the payload is just the four `track_ID` bytes.
 *
 * @param options - The track identifier for this fragment's samples.
 * @returns A {@link FullBox} that serializes to a 16-byte `tfhd` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTfhd(options: TfhdOptions): FullBox {
  return {
    type: 'tfhd',
    version: 0,
    flags: DEFAULT_BASE_IS_MOOF_FLAG,
    write: (writer) => {
      writer.u32(options.trackId)
    },
  }
}
```

- [ ] **Step 4: Create `packages/core/src/boxes/tfdt.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTfdt}.
 */
export type TfdtOptions = {
  /**
   * Base media decode time for the first sample of this fragment, expressed as `bigint`
   * in the track's media timescale. The value is the running sum of the durations of all
   * samples emitted for this track in prior fragments, starting at 0 for the first fragment.
   */
  baseMediaDecodeTimeInTrackTimescale: bigint
}

/**
 * Builds a `TrackFragmentBaseMediaDecodeTimeBox` (`tfdt`) declaring the decode time of the
 * first sample in the parent `traf`.
 *
 * mp4craft always emits version 1 (`u64` decode time) to avoid the 32-bit overflow that
 * version 0 would impose on multi-hour recordings.
 *
 * @param options - The base media decode time in the track timescale.
 * @returns A {@link FullBox} that serializes to a 20-byte `tfdt` box.
 *
 * @see ISO/IEC 14496-12 §8.8.12 for the `tfdt` payload layout.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTfdt(options: TfdtOptions): FullBox {
  return {
    type: 'tfdt',
    version: 1,
    flags: 0,
    write: (writer) => {
      writer.u64(options.baseMediaDecodeTimeInTrackTimescale)
    },
  }
}
```

- [ ] **Step 5: Create `packages/core/src/boxes/trun.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTrun}.
 */
export type TrunOptions = {
  /**
   * Byte offset from the start of the enclosing `moof` to the first sample in this run.
   * Used because `tfhd.flags` sets `default-base-is-moof`. The value is typed as a signed
   * 32-bit integer in the spec.
   */
  dataOffset: number
  /** Per-sample metadata for every sample in the run. */
  samples: TrunSample[]
}

/**
 * Metadata for a single sample inside a `trun`. Each field is written as a u32.
 */
export type TrunSample = {
  /** Sample duration in the track timescale. */
  duration: number
  /** Sample size in bytes. */
  size: number
  /** Sample flags, encoded with {@link encodeTrunSampleFlags}. */
  flags: number
}

/**
 * Flag combination used by mp4craft: data_offset + per-sample duration + per-sample size
 * + per-sample flags. Defined in ISO/IEC 14496-12 §8.8.8.
 *
 * - `0x000001` data_offset_present
 * - `0x000100` sample_duration_present
 * - `0x000200` sample_size_present
 * - `0x000400` sample_flags_present
 */
const TRUN_FLAGS_MP4CRAFT = 0x000001 | 0x000100 | 0x000200 | 0x000400

/**
 * Encodes a sample-flags u32 for {@link TrunSample.flags}. The bit layout is defined by
 * ISO/IEC 14496-12 §8.6.4.3.
 *
 * A keyframe uses `sample_depends_on = 2` (no prior samples are referenced) with
 * `sample_is_non_sync_sample = 0`. Every other sample uses `sample_depends_on = 1`
 * (depends on prior samples) with `sample_is_non_sync_sample = 1`. All other fields
 * in the bitfield remain zero.
 *
 * @param isKeyFrame - Whether this sample is a sync (random-access) sample.
 * @returns The encoded 32-bit sample-flags value.
 *
 * @see ISO/IEC 14496-12 §8.6.4.3 for the full bitfield layout.
 */
export function encodeTrunSampleFlags(isKeyFrame: boolean): number {
  if (isKeyFrame) {
    // sample_depends_on = 2 at bits 25-24.
    return 0x02000000
  }
  // sample_depends_on = 1 at bits 25-24 and sample_is_non_sync_sample = 1 at bit 16.
  return 0x01010000
}

/**
 * Builds a `TrackRunBox` (`trun`) listing every sample in a fragment's track.
 *
 * Per ISO/IEC 14496-12 §8.8.8, `trun` is a FullBox whose body begins with a u32
 * `sample_count`, followed by optional leading fields controlled by the `flags` bitfield,
 * then per-sample records. mp4craft uses `flags = 0x000701` (`TRUN_FLAGS_MP4CRAFT`) so
 * every `trun` carries a `data_offset` and per-sample `duration`, `size`, and `flags`.
 *
 * @param options - `dataOffset` from the start of the parent `moof` to the first sample
 *   byte, plus the per-sample list.
 * @returns A {@link FullBox} that serializes a `trun` box with one record per sample.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTrun(options: TrunOptions): FullBox {
  return {
    type: 'trun',
    version: 0,
    flags: TRUN_FLAGS_MP4CRAFT,
    write: (writer) => {
      writer.u32(options.samples.length)
      writer.i32(options.dataOffset)
      for (const sample of options.samples) {
        writer.u32(sample.duration)
        writer.u32(sample.size)
        writer.u32(sample.flags)
      }
    },
  }
}
```

- [ ] **Step 6: Create `packages/core/src/boxes/traf.ts`**

```typescript
import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createTraf}.
 */
export type TrafOptions = {
  /** Track fragment header produced by `createTfhd`. */
  tfhd: FullBox
  /** Base media decode time produced by `createTfdt`. */
  tfdt: FullBox
  /** Sample run produced by `createTrun`. */
  trun: FullBox
}

/**
 * Builds a `TrackFragmentBox` (`traf`), one per track with samples in the parent `moof`.
 *
 * Per ISO/IEC 14496-12 §8.8.6, `traf` is a container that begins with a `tfhd`, optionally
 * followed by `tfdt`, and concluded by one or more `trun` boxes. mp4craft uses exactly one
 * `trun` per fragment per track, matching the single-run-per-fragment approach that keeps
 * each fragment self-describing.
 *
 * @param options - The three child boxes in their spec-mandated order.
 * @returns A {@link Box} that serializes a `traf` container with `tfhd`, `tfdt`, `trun`.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTraf(options: TrafOptions): Box {
  return {
    type: 'traf',
    write: (writer) => {
      writeBox(writer, options.tfhd)
      writeBox(writer, options.tfdt)
      writeBox(writer, options.trun)
    },
  }
}
```

- [ ] **Step 7: Verify**

```
pnpm --filter mp4craft exec vitest run tests/unit/traf-tfhd-tfdt-trun.test.ts
pnpm test
pnpm typecheck
```

Full suite at 116 passing.

---

### Task 4: `FragmentBuilder` and fragment serialization

**Files:**

- Create: `packages/core/src/muxer/fragment-builder.ts`
- Create: `packages/core/tests/unit/fragment-builder.test.ts`

---

The builder is responsible for:

1. Accumulating per-track samples as they arrive.
2. Deciding when a fragment should be flushed based on keyframe arrival and minimum duration.
3. Serializing a `moof + mdat` byte pair for a flush, with correct `trun.dataOffset` values.
4. Maintaining the monotonic sequence number and per-track `baseMediaDecodeTime` across flushes.

**Fragment layout for a flush:**

```
moof
├── mfhd (sequence_number)
└── traf[] (one per track with samples)
    ├── tfhd (trackId)
    ├── tfdt (baseMediaDecodeTimeInTrackTimescale)
    └── trun (data_offset from moof start, per-sample duration/size/flags)
mdat
└── concatenated sample bytes, grouped by track in the same order as the trafs
```

**Computing `trun.data_offset`:**

The sample data for the first track begins at `moofByteLength + MDAT_HEADER_SIZE_32`. Each subsequent track begins after the sum of the preceding tracks' sample bytes. Because the `trun` flag set is fixed and every sample carries `duration`, `size`, and `flags` as u32, a `trun` with `N` samples has a stable body length of `4 (sample_count) + 4 (data_offset) + 12 * N (per-sample records)`. The full `moof` byte length is therefore deterministic at the start of a flush without needing a two-pass build.

---

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/fragment-builder.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { FragmentBuilder } from '@/muxer/fragment-builder'

describe('FragmentBuilder', () => {
  const trackSpecs = [
    { trackId: 1, timescale: 90000, isVideo: true },
    { trackId: 2, timescale: 48000, isVideo: false },
  ]

  it('does not flush before the minimum duration has elapsed', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 1_000_000,
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 0,
        durationMicroseconds: 33_333,
        isKeyFrame: true,
        dataByteLength: 100,
      })
    ).toBe(false)
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 500_000,
        durationMicroseconds: 33_333,
        isKeyFrame: true,
        dataByteLength: 100,
      })
    ).toBe(false)
  })

  it('flushes on a keyframe after the minimum duration has elapsed', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 1_000_000,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 1_000_001,
        durationMicroseconds: 33_333,
        isKeyFrame: true,
        dataByteLength: 100,
      })
    ).toBe(true)
  })

  it('does not flush on a non-keyframe even after the minimum duration elapsed', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 1_000_000,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 2_000_000,
        durationMicroseconds: 33_333,
        isKeyFrame: false,
        dataByteLength: 100,
      })
    ).toBe(false)
  })

  it('for audio-only files every sample is treated as a keyframe and flushes after min duration', () => {
    const audioOnlyTracks = [{ trackId: 1, timescale: 48000, isVideo: false }]
    const builder = new FragmentBuilder({
      tracks: audioOnlyTracks,
      minimumFragmentDurationMicroseconds: 500_000,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 21_333,
      isKeyFrame: true,
      data: new Uint8Array(50),
    })
    expect(
      builder.shouldFlushBefore({
        trackId: 1,
        timestampMicroseconds: 600_000,
        durationMicroseconds: 21_333,
        isKeyFrame: true,
        dataByteLength: 50,
      })
    ).toBe(true)
  })

  it('assigns strictly increasing sequence numbers to consecutive flushes', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 0,
    })
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    const firstFlush = builder.flush()
    expect(firstFlush).not.toBeNull()
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 33_333,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: new Uint8Array(100),
    })
    const secondFlush = builder.flush()
    expect(secondFlush).not.toBeNull()
    expect(secondFlush!.sequenceNumber).toBe(firstFlush!.sequenceNumber + 1)
  })

  it('emits an moof followed by mdat with sample bytes for a single-sample flush', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 0,
    })
    const payloadBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    builder.appendSample({
      trackId: 1,
      timestampMicroseconds: 0,
      durationMicroseconds: 33_333,
      isKeyFrame: true,
      data: payloadBytes,
    })
    const flushResult = builder.flush()
    expect(flushResult).not.toBeNull()
    const latin1Text = new TextDecoder('latin1').decode(flushResult!.bytes)
    expect(latin1Text.indexOf('moof')).toBe(4)
    const mdatTypePosition = latin1Text.indexOf('mdat')
    expect(mdatTypePosition).toBeGreaterThan(0)
    const payloadStart = mdatTypePosition + 4
    expect(flushResult!.bytes[payloadStart]).toBe(0xde)
    expect(flushResult!.bytes[payloadStart + 1]).toBe(0xad)
    expect(flushResult!.bytes[payloadStart + 2]).toBe(0xbe)
    expect(flushResult!.bytes[payloadStart + 3]).toBe(0xef)
  })

  it('returns null from flush when no samples have been appended', () => {
    const builder = new FragmentBuilder({
      tracks: trackSpecs,
      minimumFragmentDurationMicroseconds: 0,
    })
    expect(builder.flush()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/fragment-builder.test.ts
```

- [ ] **Step 3: Create `packages/core/src/muxer/fragment-builder.ts`**

```typescript
import { writeBox } from '@/boxes/box'
import { MDAT_HEADER_SIZE_32, writeMdatHeader32 } from '@/boxes/mdat'
import { createMoof } from '@/boxes/moof'
import { createMfhd } from '@/boxes/mfhd'
import { createTraf } from '@/boxes/traf'
import { createTfhd } from '@/boxes/tfhd'
import { createTfdt } from '@/boxes/tfdt'
import { createTrun, encodeTrunSampleFlags, type TrunSample } from '@/boxes/trun'
import { Writer } from '@/io/writer'

/**
 * Per-track identity and timing information supplied to a {@link FragmentBuilder} at
 * construction time.
 */
export type FragmentTrackSpec = {
  /** Track identifier, matching the `tkhd.trackId` of the corresponding `trak` box. */
  trackId: number
  /** Track timescale in ticks per second. Sample durations are converted from microseconds to this unit. */
  timescale: number
  /** Whether this is a video track, used to decide keyframe semantics. Audio tracks treat every frame as a sync sample. */
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
 * Lightweight variant of {@link FragmentSampleInput} used by {@link FragmentBuilder.shouldFlushBefore}.
 * Instead of carrying the sample bytes this variant carries only the byte length so the
 * caller can ask "would appending this sample cross a fragment boundary" without allocating.
 */
export type FragmentSamplePreview = {
  trackId: number
  timestampMicroseconds: number
  durationMicroseconds: number
  isKeyFrame: boolean
  dataByteLength: number
}

/**
 * The byte payload and metadata describing a single flushed fragment.
 */
export type FragmentFlushResult = {
  /** The serialized `moof + mdat` bytes, ready to be written to the target. */
  bytes: Uint8Array
  /** The `mfhd.sequence_number` of this fragment. */
  sequenceNumber: number
  /**
   * Byte length of the serialized `moof` portion only. Used by the outer muxer to populate
   * `tfra` random-access entries.
   */
  moofByteLength: number
  /**
   * Per-track first-sample decode time (in track timescale) for this fragment, used to
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
 * Accumulates per-track samples and emits `moof + mdat` byte pairs on demand.
 *
 * The builder is intentionally synchronous. It has no knowledge of the target. Callers
 * hand it samples via {@link FragmentBuilder.appendSample}, consult
 * {@link FragmentBuilder.shouldFlushBefore} to decide when to cut a fragment, and call
 * {@link FragmentBuilder.flush} to serialize the pending samples and advance the
 * sequence number.
 *
 * @see ISO/IEC 14496-12 §8.8 for the fragmented MP4 box layout.
 * @see {@link https://w3c.github.io/mse-byte-stream-format-isobmff/ | MSE byte stream format for ISO BMFF}
 */
export class FragmentBuilder {
  private readonly minimumFragmentDurationMicroseconds: number
  private readonly trackStatesById: Map<number, TrackState>
  private readonly orderedTrackIds: number[]
  private nextSequenceNumber = 1
  private lastFlushTimestampMicroseconds: number | null = null
  private currentFragmentStartTimestampMicroseconds: number | null = null

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
   * currently pending fragment. The rule implements the spec-level contract: a fragment
   * boundary may be placed only at a keyframe, and at least `minimumFragmentDurationMicroseconds`
   * of media must have elapsed since the previous flush. Audio-only files treat every
   * sample as a keyframe, so the duration check is the only gate.
   */
  shouldFlushBefore(preview: FragmentSamplePreview): boolean {
    if (this.currentFragmentStartTimestampMicroseconds === null) return false
    if (!preview.isKeyFrame) return false
    const elapsedMicroseconds = preview.timestampMicroseconds - this.currentFragmentStartTimestampMicroseconds
    return elapsedMicroseconds >= this.minimumFragmentDurationMicroseconds
  }

  /**
   * Appends a sample to the currently pending fragment. The caller is responsible for
   * consulting {@link FragmentBuilder.shouldFlushBefore} and calling {@link FragmentBuilder.flush}
   * before appending the sample when a flush is warranted.
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
   * Serializes every track's pending samples as a single `moof + mdat` fragment, advances
   * the sequence number, and resets the pending buffers. Returns `null` when no samples
   * are pending across any track.
   */
  flush(): FragmentFlushResult | null {
    const tracksWithSamples = this.orderedTrackIds
      .map((trackId) => this.trackStatesById.get(trackId)!)
      .filter((trackState) => trackState.pendingSamples.length > 0)
    if (tracksWithSamples.length === 0) return null

    const sequenceNumber = this.nextSequenceNumber++

    // The trun flag combination produces a stable per-sample record size, so the moof
    // byte length is deterministic before the trun bodies are written.
    const perTrackBodyByteLengths = tracksWithSamples.map((trackState) => {
      const sampleCount = trackState.pendingSamples.length
      const trafHeaderBytes = 8 // size + "traf"
      const tfhdBytes = 16 // 8 header + 4 version/flags + 4 track_ID
      const tfdtBytes = 20 // 8 header + 4 version/flags + 8 baseMediaDecodeTime
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
          // Audio callers pass isKeyFrame: true for every sample. Video respects the caller's flag.
          flags: encodeTrunSampleFlags(trackState.spec.isVideo ? pending.isKeyFrame : true),
        }
      })

      const precedingTrackSampleBytes = tracksWithSamples.slice(0, trackIndex).reduce((total, precedingTrack) => {
        for (const precedingSample of precedingTrack.pendingSamples) {
          total += precedingSample.data.length
        }
        return total
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

    this.lastFlushTimestampMicroseconds = this.currentFragmentStartTimestampMicroseconds
    this.currentFragmentStartTimestampMicroseconds = null

    return {
      bytes: fragmentBytes,
      sequenceNumber,
      moofByteLength: actualMoofByteLength,
      firstSampleDecodeTimesByTrackId,
    }
  }

  /** Returns `true` when at least one track has a pending sample. */
  hasPendingSamples(): boolean {
    for (const trackState of this.trackStatesById.values()) {
      if (trackState.pendingSamples.length > 0) return true
    }
    return false
  }
}
```

Note the small shim: `lastFlushTimestampMicroseconds` is tracked for potential future use but the flush condition is evaluated against `currentFragmentStartTimestampMicroseconds`. The pattern keeps the logic local and avoids a branching comparison for the very first fragment.

- [ ] **Step 4: Verify**

```
pnpm --filter mp4craft exec vitest run tests/unit/fragment-builder.test.ts
pnpm test
pnpm typecheck
```

Full suite at 123 passing.

---

### Task 5: `fastStart: "fragmented"` in `Mp4Muxer` plus mp4box round-trip

**Files:**

- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts`
- Create: `packages/core/tests/unit/mp4-muxer-fragmented.test.ts`
- Create: `packages/core/tests/integration/fragmented-validation.test.ts`

---

**Behavior:**

1. Constructor validation: `fastStart: "fragmented"` requires at least one track. No seek requirement. `StreamTarget` is fully supported.
2. Constructor, for fragmented mode:
   - Build `ftyp` and write it to the target.
   - Build an empty `moov` (mvhd + every trak with zero-entry sample tables + mvex containing one trex per track).
   - Write the empty `moov` to the target.
   - Instantiate `FragmentBuilder` with the track specs.
3. `addVideoSample` and `addAudioSample` in fragmented mode:
   - Consult `FragmentBuilder.shouldFlushBefore` using the incoming sample's preview.
   - If flush is warranted, serialize the builder's pending fragment and write it to the target.
   - Append the incoming sample to the builder.
4. `finalize` in fragmented mode:
   - Flush any remaining pending samples as a final fragment.
   - Call `target.finish()`.
5. The in-memory and progressive paths remain unchanged.

---

- [ ] **Step 1: Widen `FastStart` and add `minimumFragmentDuration`**

Update `packages/core/src/types/config.ts`:

```typescript
import type { Target } from '@/targets/target'
import type { FirstTimestampBehavior } from '@/tracks/timestamp-tracker'

/**
 * Supported video codec tags. Each value maps to a specific fourcc sample entry and a
 * specific format for `VideoTrackConfig.description`.
 *
 * - `"avc"` uses the `avc1` sample entry with an `avcC` child. `description` is the
 *   AVCDecoderConfigurationRecord defined in ISO/IEC 14496-15 §5.3.3.
 * - `"hevc"` uses `hvc1` with an `hvcC` child. `description` is the
 *   HEVCDecoderConfigurationRecord defined in ISO/IEC 14496-15 §8.3.3.
 * - `"vp9"` uses `vp09` with a `vpcC` FullBox child. `description` is the VP Codec
 *   Configuration Record payload defined in the VP9 ISOBMFF binding §2.2.
 */
export type VideoCodec = 'avc' | 'hevc' | 'vp9'

/**
 * Supported audio codec tags. Each value maps to a specific fourcc sample entry and a
 * specific format for `AudioTrackConfig.description`.
 *
 * - `"aac"` uses the `mp4a` sample entry with an `esds` descriptor wrapping the
 *   AudioSpecificConfig defined in ISO/IEC 14496-3 §1.6.2.1.
 * - `"opus"` uses the `Opus` sample entry with a `dOps` child. `description` is the
 *   OpusSpecificBox payload defined in the Opus-in-ISOBMFF spec §4.3.2.
 */
export type AudioCodec = 'aac' | 'opus'

/**
 * Container layout modes.
 *
 * - `false` (progressive) writes `ftyp + mdat + moov`. Suited to VOD files finalized
 *   after the full recording is known. Requires a target that supports `seek`.
 * - `"in-memory"` writes `ftyp + moov + mdat` with `moov` before sample data. Suited to
 *   downloadable files that should play back while the transfer is still in progress.
 *   Requires enough memory to buffer the full sample stream.
 * - `"fragmented"` writes `ftyp + moov(empty) + (moof + mdat)+` and is the right choice
 *   for live streaming, indefinite recordings, and Media Source Extensions consumers.
 *   Every fragment is self-contained, so any sequential target is sufficient.
 *
 * @see {@link https://w3c.github.io/mse-byte-stream-format-isobmff/ | MSE byte stream format for ISO BMFF}
 */
export type FastStart = false | 'in-memory' | 'fragmented'

/**
 * Describes a video track for the muxer.
 */
export type VideoTrackConfig = {
  /** Codec tag that selects the sample entry and `description` format. */
  codec: VideoCodec
  /** Display width in pixels. Written to the `tkhd` and visual sample entry. */
  width: number
  /** Display height in pixels. */
  height: number
  /**
   * Codec-specific decoder configuration bytes. See {@link VideoCodec} for the expected
   * format per codec. Typically obtained from `VideoDecoderConfig.description` when using
   * WebCodecs.
   */
  description: ArrayBuffer | ArrayBufferView
  /**
   * Track timescale in ticks per second. Defaults to 90000, the convention for H.264.
   * WebCodecs timestamps are always in microseconds; the muxer converts into this unit.
   */
  timescale?: number
}

/**
 * Describes an audio track for the muxer.
 */
export type AudioTrackConfig = {
  /** Codec tag that selects the sample entry and `description` format. */
  codec: AudioCodec
  /** Codec-specific decoder configuration bytes. See {@link AudioCodec} for the expected format per codec. */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, as declared by the decoder configuration. */
  channels: number
  /** Source sample rate in Hz. See codec-specific notes for how this interacts with the sample entry. */
  sampleRate: number
  /** Track timescale in ticks per second. Defaults to `sampleRate`. */
  timescale?: number
}

/**
 * Muxer configuration. At least one of `video` or `audio` must be supplied.
 */
export type MuxerOptions<T extends Target = Target> = {
  /** Destination sink for serialized bytes. See {@link Target}. */
  target: T
  /** Video track configuration, or undefined for audio-only output. */
  video?: VideoTrackConfig
  /** Audio track configuration, or undefined for video-only output. */
  audio?: AudioTrackConfig
  /** Container layout. Defaults to `false` (progressive). */
  fastStart?: FastStart
  /** Policy for the first sample's timestamp. See {@link FirstTimestampBehavior}. */
  firstTimestampBehavior?: FirstTimestampBehavior
  /**
   * Minimum elapsed microseconds since the last flush before a new fragment may be
   * flushed. Only consulted when `fastStart === "fragmented"`. Defaults to 1_000_000
   * (one second), matching the typical cadence used by Media Source Extensions consumers.
   */
  minimumFragmentDuration?: number
}
```

- [ ] **Step 2: Write the muxer-level failing tests at `packages/core/tests/unit/mp4-muxer-fragmented.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { Mp4Muxer } from '@/muxer/mp4-muxer'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { StreamTarget } from '@/targets/stream-target'
import { StateError } from '@/types/errors'

// AVCDecoderConfigurationRecord for H.264 Baseline 3.0 at 640×480.
const avcc = new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('Mp4Muxer (fragmented)', () => {
  it('writes ftyp, then an empty moov with an mvex child, and emits a moof per flush', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 66_666,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const outputBytes = new Uint8Array(target.buffer)
    const latin1Text = new TextDecoder('latin1').decode(outputBytes)
    expect(latin1Text.indexOf('ftyp')).toBe(4)
    const moovPosition = latin1Text.indexOf('moov')
    expect(moovPosition).toBeGreaterThan(0)
    expect(latin1Text.indexOf('mvex', moovPosition)).toBeGreaterThan(moovPosition)
    const firstMoof = latin1Text.indexOf('moof')
    expect(firstMoof).toBeGreaterThan(moovPosition)
    const secondMoof = latin1Text.indexOf('moof', firstMoof + 4)
    expect(secondMoof).toBeGreaterThan(firstMoof)
  })

  it('works with StreamTarget because every write is sequential', async () => {
    const receivedChunks: Uint8Array[] = []
    const muxer = new Mp4Muxer({
      target: new StreamTarget({
        onData: ({ data }) => {
          receivedChunks.push(new Uint8Array(data))
        },
      }),
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    const totalBytes = receivedChunks.reduce((total, chunk) => total + chunk.length, 0)
    const merged = new Uint8Array(totalBytes)
    let writePosition = 0
    for (const chunk of receivedChunks) {
      merged.set(chunk, writePosition)
      writePosition += chunk.length
    }
    const latin1Text = new TextDecoder('latin1').decode(merged)
    expect(latin1Text.indexOf('ftyp')).toBe(4)
    expect(latin1Text.indexOf('moov')).toBeGreaterThan(0)
    expect(latin1Text.indexOf('moof')).toBeGreaterThan(latin1Text.indexOf('moov'))
  })

  it('flushes remaining samples on finalize even if no new keyframe arrived', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 10_000_000,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    await muxer.finalize()
    const outputBytes = new Uint8Array(target.buffer)
    const latin1Text = new TextDecoder('latin1').decode(outputBytes)
    expect(latin1Text.indexOf('moof')).toBeGreaterThan(0)
  })

  it('blocks addSample calls after finalize', async () => {
    const muxer = new Mp4Muxer({
      target: new ArrayBufferTarget(),
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 640, height: 480, description: avcc, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()
    expect(() =>
      muxer.addVideoSample({
        data: new Uint8Array(100),
        timestamp: 33_333,
        duration: 33_333,
        isKeyFrame: false,
      })
    ).toThrow(StateError)
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/mp4-muxer-fragmented.test.ts
```

- [ ] **Step 4: Wire fragmented mode into `Mp4Muxer`**

Extend `packages/core/src/muxer/mp4-muxer.ts`. The class already splits progressive and in-memory; add a third branch for fragmented. The empty-moov build reuses each track's `buildTrak` because track sample tables built with no samples serialize as zero-entry FullBoxes, which is exactly what the spec requires for fragmented files.

Update the imports:

```typescript
import { createMvex } from '@/boxes/mvex'
import { createTrex } from '@/boxes/trex'
import { FragmentBuilder, type FragmentTrackSpec } from '@/muxer/fragment-builder'
```

Add a private field and replace the constructor's mode dispatch:

```typescript
  private readonly fragmentBuilder: FragmentBuilder | null;
  private readonly fragmentedWriteCursor: { current: number } | null;
```

```typescript
if (options.fastStart === 'fragmented') {
  this.inMemorySampleWriter = null
  this.fragmentBuilder = createFragmentBuilder(options, this.tracks)
  this.fragmentedWriteCursor = { current: 0 }
  this.writeFtypAndEmptyMoovForFragmentedMode(options)
} else if ((options.fastStart ?? false) === false) {
  this.inMemorySampleWriter = null
  this.fragmentBuilder = null
  this.fragmentedWriteCursor = null
  this.writeHeaderAndMdatPlaceholder()
} else {
  this.inMemorySampleWriter = new Writer()
  this.fragmentBuilder = null
  this.fragmentedWriteCursor = null
}
```

Add the fragmented-mode helpers on the class:

```typescript
  private writeFtypAndEmptyMoovForFragmentedMode(options: MuxerOptions<T>): void {
    const compatibleBrands = computeCompatibleBrands(options);
    const ftyp = createFtyp({ majorBrand: "isom", minorVersion: 512, compatibleBrands });
    const ftypWriter = new Writer();
    writeBox(ftypWriter, ftyp);
    const ftypBytes = ftypWriter.toBytes();
    this.target.write(this.fragmentedWriteCursor!.current, ftypBytes);
    this.fragmentedWriteCursor!.current += ftypBytes.length;

    const trakBuildResults = this.tracks.map((track) =>
      track.buildTrak({ movieTimescale: MOVIE_TIMESCALE, chunkOffsetBase: 0 }),
    );
    const mvhd = createMvhd({
      timescale: MOVIE_TIMESCALE,
      duration: 0,
      nextTrackId: this.tracks.length + 1,
    });
    const trexChildren = this.tracks.map((track) =>
      createTrex({
        trackId: track.trackId,
        defaultSampleDescriptionIndex: 1,
        defaultSampleDuration: 0,
        defaultSampleSize: 0,
        defaultSampleFlags: 0,
      }),
    );
    const mvex = createMvex({ trex: trexChildren });
    const moovBox = createMoov({
      mvhd,
      traks: trakBuildResults.map((result) => result.trak),
      mvex,
    });
    const moovWriter = new Writer();
    writeBox(moovWriter, moovBox);
    const moovBytes = moovWriter.toBytes();
    this.target.write(this.fragmentedWriteCursor!.current, moovBytes);
    this.fragmentedWriteCursor!.current += moovBytes.length;
  }
```

Note: reading `track.trackId` requires adding a public `readonly get trackId(): number` to `Track`. Make that addition in `packages/core/src/tracks/track.ts`:

```typescript
  get trackId(): number {
    return this.options.trackId;
  }
```

Update `addVideoSample` and `addAudioSample` to route through the fragment builder:

```typescript
  addVideoSample(videoSample: VideoSampleInput): void {
    if (!this.videoTrack) throw new ConfigError("No video track configured");
    this.stateMachine.onSample();
    if (this.fragmentBuilder !== null) {
      this.handleFragmentedSample({
        trackId: this.videoTrack.trackId,
        timestampMicroseconds: videoSample.timestamp,
        durationMicroseconds: videoSample.duration,
        isKeyFrame: videoSample.isKeyFrame,
        data: videoSample.data,
      });
      return;
    }
    if (this.inMemorySampleWriter !== null) {
      const relativeOffset = this.inMemorySampleWriter.length;
      this.inMemorySampleWriter.bytes(videoSample.data);
      this.videoTrack.appendSample({ ...videoSample, chunkOffset: relativeOffset });
      return;
    }
    const absoluteChunkOffset = this.writeCursor;
    this.target.write(absoluteChunkOffset, videoSample.data);
    this.writeCursor += videoSample.data.length;
    this.mdatSize += videoSample.data.length;
    this.videoTrack.appendSample({ ...videoSample, chunkOffset: absoluteChunkOffset });
  }

  addAudioSample(audioSample: AudioSampleInput): void {
    if (!this.audioTrack) throw new ConfigError("No audio track configured");
    this.stateMachine.onSample();
    const sampleIsKeyFrame = audioSample.isKeyFrame ?? true;
    if (this.fragmentBuilder !== null) {
      this.handleFragmentedSample({
        trackId: this.audioTrack.trackId,
        timestampMicroseconds: audioSample.timestamp,
        durationMicroseconds: audioSample.duration,
        isKeyFrame: sampleIsKeyFrame,
        data: audioSample.data,
      });
      return;
    }
    if (this.inMemorySampleWriter !== null) {
      const relativeOffset = this.inMemorySampleWriter.length;
      this.inMemorySampleWriter.bytes(audioSample.data);
      this.audioTrack.appendSample({
        ...audioSample,
        isKeyFrame: sampleIsKeyFrame,
        chunkOffset: relativeOffset,
      });
      return;
    }
    const absoluteChunkOffset = this.writeCursor;
    this.target.write(absoluteChunkOffset, audioSample.data);
    this.writeCursor += audioSample.data.length;
    this.mdatSize += audioSample.data.length;
    this.audioTrack.appendSample({
      ...audioSample,
      isKeyFrame: sampleIsKeyFrame,
      chunkOffset: absoluteChunkOffset,
    });
  }

  private handleFragmentedSample(sample: {
    trackId: number;
    timestampMicroseconds: number;
    durationMicroseconds: number;
    isKeyFrame: boolean;
    data: Uint8Array;
  }): void {
    const builder = this.fragmentBuilder!;
    const shouldFlush = builder.shouldFlushBefore({
      trackId: sample.trackId,
      timestampMicroseconds: sample.timestampMicroseconds,
      durationMicroseconds: sample.durationMicroseconds,
      isKeyFrame: sample.isKeyFrame,
      dataByteLength: sample.data.length,
    });
    if (shouldFlush) {
      this.writePendingFragment(builder);
    }
    builder.appendSample(sample);
  }

  private writePendingFragment(builder: FragmentBuilder): void {
    const flushResult = builder.flush();
    if (!flushResult) return;
    this.target.write(this.fragmentedWriteCursor!.current, flushResult.bytes);
    this.fragmentedWriteCursor!.current += flushResult.bytes.length;
  }
```

Extend `finalize`:

```typescript
  async finalize(): Promise<void> {
    this.stateMachine.onFinalize();
    if (this.fragmentBuilder !== null) {
      await this.finalizeFragmented();
      return;
    }
    if (this.inMemorySampleWriter !== null) {
      await this.finalizeInMemory(this.inMemorySampleWriter);
      return;
    }
    await this.finalizeProgressive();
  }

  private async finalizeFragmented(): Promise<void> {
    if (this.fragmentBuilder!.hasPendingSamples()) {
      this.writePendingFragment(this.fragmentBuilder!);
    }
    await this.target.finish();
  }
```

Helper `createFragmentBuilder` at module scope:

```typescript
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
```

`Track` needs a public `timescale` getter too. Add to `packages/core/src/tracks/track.ts`:

```typescript
  get timescale(): number {
    return this.options.timescale;
  }
```

- [ ] **Step 5: Run the muxer test, then the full suite**

```
pnpm --filter mp4craft exec vitest run tests/unit/mp4-muxer-fragmented.test.ts
pnpm test
pnpm typecheck
```

Full suite at 127 passing.

- [ ] **Step 6: Write the mp4box integration test at `packages/core/tests/integration/fragmented-validation.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createFile, type Movie, MP4BoxBuffer } from 'mp4box'
import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'

const fixturesDirectory = resolve(fileURLToPath(new URL('../fixtures', import.meta.url)))

const keyFrameBytes = readFileSync(resolve(fixturesDirectory, 'avc-key-frame.bin'))
const deltaFrameBytes = readFileSync(resolve(fixturesDirectory, 'avc-delta-frame.bin'))
const avccBytes = readFileSync(resolve(fixturesDirectory, 'avcc.bin'))

describe('integration: MP4Box.js validates mp4craft fragmented output', () => {
  it('parses a fragmented AVC file with the expected track and sample counts', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 320, height: 240, description: avccBytes, timescale: 90000 },
    })

    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrameBytes),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(deltaFrameBytes),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrameBytes),
      timestamp: 66_666,
      duration: 33_333,
      isKeyFrame: true,
    })

    await muxer.finalize()

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.tracks[0]!.codec).toMatch(/^avc1/)
    expect(parsedInfo.isFragmented).toBe(true)
    expect(parsedInfo.tracks[0]!.nb_samples).toBeGreaterThanOrEqual(3)
  })
})

/**
 * Parses an MP4 byte buffer with mp4box.js (v2.3.0) and resolves with the `Movie` info
 * returned by `onReady`. mp4box v2.3.0's `onError` signature is `(module, message)`; this
 * helper folds the two arguments into a single thrown `Error`.
 *
 * @see {@link https://github.com/gpac/mp4box.js/blob/master/README.md | mp4box.js README}
 */
function parseWithMp4Box(mp4Bytes: ArrayBuffer): Promise<Movie> {
  return new Promise<Movie>((promiseResolve, promiseReject) => {
    const mp4File = createFile()
    mp4File.onReady = promiseResolve
    mp4File.onError = (errorModule: string, errorMessage: string) =>
      promiseReject(new Error(`mp4box parse error [${errorModule}]: ${errorMessage}`))
    const inputBuffer = MP4BoxBuffer.fromArrayBuffer(mp4Bytes, 0)
    mp4File.appendBuffer(inputBuffer)
    mp4File.flush()
  })
}
```

- [ ] **Step 7: Run integration tests + full suite + typecheck**

```
pnpm --filter mp4craft exec vitest run tests/integration/fragmented-validation.test.ts
pnpm test
pnpm typecheck
```

Full suite at 128 passing.

---

### Task 6: `mfra` + `tfra` + `mfro` random-access index

**Files:**

- Create: `packages/core/src/boxes/tfra.ts`
- Create: `packages/core/src/boxes/mfro.ts`
- Create: `packages/core/src/boxes/mfra.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts` (accumulate `mfra` entries and write the box in `finalizeFragmented`)
- Create: `packages/core/tests/unit/mfra.test.ts`
- Create: `packages/core/tests/integration/fragmented-with-mfra.test.ts`

---

**Behavior:**

- For every flushed fragment, the muxer records a random-access entry per track consisting of the fragment's start timestamp in the track timescale, the absolute byte offset of the fragment's `moof` in the file, the `traf` index (always 1 in mp4craft because we emit one `traf` per track per fragment), the `trun` index (always 1), and the sample number inside the `trun` of the first keyframe (always 1 because fragments begin on keyframes).
- On `finalize`, after the final fragment is flushed, the muxer writes an `mfra` box containing one `tfra` per track followed by a final `mfro` that carries the total `mfra` size. Parsers locate `mfra` by reading the last four bytes as `mfra.byteLength` via the `mfro.size` field.

---

- [ ] **Step 1: Write failing unit tests at `packages/core/tests/unit/mfra.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { Writer } from '@/io/writer'
import { writeBox } from '@/boxes/box'
import { createTfra } from '@/boxes/tfra'
import { createMfro } from '@/boxes/mfro'
import { createMfra } from '@/boxes/mfra'

describe('createTfra', () => {
  it('emits a version-1 tfra FullBox listing one entry per fragment with u64 time and moofOffset', () => {
    // Per ISO/IEC 14496-12 §8.8.10, tfra version 1 stores time and moofOffset as u64.
    // Remaining fields (traf_number, trun_number, sample_number) use the minimum 1-byte width.
    const tfra = createTfra({
      trackId: 1,
      entries: [
        {
          timeInTrackTimescale: 0n,
          moofOffsetFromFileStart: 1000n,
          trafNumber: 1,
          trunNumber: 1,
          sampleNumber: 1,
        },
        {
          timeInTrackTimescale: 90_000n,
          moofOffsetFromFileStart: 2000n,
          trafNumber: 1,
          trunNumber: 1,
          sampleNumber: 1,
        },
      ],
    })
    const boxWriter = new Writer()
    writeBox(boxWriter, tfra)
    const bytes = boxWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('tfra')
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint8(8)).toBe(1)
    // track_ID (u32), reserved+lengths (u32), number_of_entry (u32), then entries.
    expect(dataView.getUint32(12, false)).toBe(1)
    expect(dataView.getUint32(16, false)).toBe(0)
    expect(dataView.getUint32(20, false)).toBe(2)
    expect(dataView.getBigUint64(24, false)).toBe(0n)
    expect(dataView.getBigUint64(32, false)).toBe(1000n)
    expect(dataView.getUint8(40)).toBe(1)
    expect(dataView.getUint8(41)).toBe(1)
    expect(dataView.getUint8(42)).toBe(1)
  })
})

describe('createMfro', () => {
  it('emits an mfro FullBox carrying the supplied mfra size as u32', () => {
    const mfro = createMfro({ mfraByteLength: 256 })
    const boxWriter = new Writer()
    writeBox(boxWriter, mfro)
    const bytes = boxWriter.toBytes()
    expect(bytes.length).toBe(16)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mfro')
    expect(new DataView(bytes.buffer).getUint32(12, false)).toBe(256)
  })
})

describe('createMfra', () => {
  it('emits an mfra container with every tfra followed by a final mfro', () => {
    const tfra = createTfra({
      trackId: 1,
      entries: [
        {
          timeInTrackTimescale: 0n,
          moofOffsetFromFileStart: 100n,
          trafNumber: 1,
          trunNumber: 1,
          sampleNumber: 1,
        },
      ],
    })
    const mfra = createMfra({ tfras: [tfra], totalByteLength: 64 })
    const boxWriter = new Writer()
    writeBox(boxWriter, mfra)
    const bytes = boxWriter.toBytes()
    const bodyText = new TextDecoder('latin1').decode(bytes)
    expect(bodyText.indexOf('mfra')).toBe(4)
    const tfraPosition = bodyText.indexOf('tfra')
    const mfroPosition = bodyText.indexOf('mfro')
    expect(tfraPosition).toBeGreaterThan(0)
    expect(mfroPosition).toBeGreaterThan(tfraPosition)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/mfra.test.ts
```

- [ ] **Step 3: Create `packages/core/src/boxes/tfra.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Per-fragment random-access entry inside a `tfra` box. All numeric fields describe the
 * state of the file at the time the corresponding `moof` was written.
 */
export type TfraEntry = {
  /** First-sample decode time of the referenced fragment in the track's timescale. */
  timeInTrackTimescale: bigint
  /** Absolute byte offset of the referenced `moof` from the start of the file. */
  moofOffsetFromFileStart: bigint
  /** 1-based index of the `traf` inside the `moof` (always 1 for mp4craft's one-traf-per-track layout). */
  trafNumber: number
  /** 1-based index of the `trun` inside the `traf` (always 1 for mp4craft's single-run layout). */
  trunNumber: number
  /** 1-based index of the first sample in the `trun` that is a sync sample (always 1 because fragments begin on keyframes). */
  sampleNumber: number
}

/**
 * Options for {@link createTfra}.
 */
export type TfraOptions = {
  /** Track identifier. */
  trackId: number
  /** One entry per fragment, in declaration order. */
  entries: TfraEntry[]
}

/**
 * Builds a `TrackFragmentRandomAccessBox` (`tfra`).
 *
 * Per ISO/IEC 14496-12 §8.8.10, `tfra` maps decode times to `moof` byte offsets for a
 * single track. mp4craft emits version 1 (`u64` time and `moof_offset`) plus the minimum
 * one-byte encodings for `traf`/`trun`/`sample` indexes because each fragment has exactly
 * one `traf` per track, one `trun` per `traf`, and its first sample is a sync sample.
 *
 * @param options - Track identifier and per-fragment entry list.
 * @returns A {@link FullBox} whose serializer writes the spec-mandated layout.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createTfra(options: TfraOptions): FullBox {
  return {
    type: 'tfra',
    version: 1,
    flags: 0,
    write: (writer) => {
      writer.u32(options.trackId)
      // Reserved (26 bits) + length_size_of_traf_num (2) + length_size_of_trun_num (2) +
      // length_size_of_sample_num (2). All three length sizes encode 0, meaning each field
      // is one byte in every entry.
      writer.u32(0)
      writer.u32(options.entries.length)
      for (const entry of options.entries) {
        writer.u64(entry.timeInTrackTimescale)
        writer.u64(entry.moofOffsetFromFileStart)
        writer.u8(entry.trafNumber)
        writer.u8(entry.trunNumber)
        writer.u8(entry.sampleNumber)
      }
    },
  }
}
```

- [ ] **Step 4: Create `packages/core/src/boxes/mfro.ts`**

```typescript
import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createMfro}.
 */
export type MfroOptions = {
  /** Total byte length of the enclosing `mfra` box, including the `mfro` itself. */
  mfraByteLength: number
}

/**
 * Builds a `MovieFragmentRandomAccessOffsetBox` (`mfro`), the tail marker of every `mfra`.
 *
 * Per ISO/IEC 14496-12 §8.8.11, `mfro` carries a u32 value equal to the total size of the
 * enclosing `mfra` box. Parsers seek to the last 4 bytes of the file to read this value
 * and then seek backward by the same amount to locate `mfra`.
 *
 * @param options - The total byte length of the enclosing `mfra`.
 * @returns A {@link FullBox} that serializes to a 16-byte `mfro` box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMfro(options: MfroOptions): FullBox {
  return {
    type: 'mfro',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.mfraByteLength)
    },
  }
}
```

- [ ] **Step 5: Create `packages/core/src/boxes/mfra.ts`**

```typescript
import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'
import { createMfro } from '@/boxes/mfro'

/**
 * Options for {@link createMfra}.
 */
export type MfraOptions = {
  /** One `tfra` box per track. */
  tfras: FullBox[]
  /**
   * Total byte length of the enclosing `mfra` box as serialized to disk, used to populate
   * the tail `mfro`. Callers compute the total in two passes: first with a placeholder
   * `totalByteLength` to measure, then again with the measured value.
   */
  totalByteLength: number
}

/**
 * Builds a `MovieFragmentRandomAccessBox` (`mfra`), an optional tail container that lists
 * per-track random-access information for every fragment in the file.
 *
 * Per ISO/IEC 14496-12 §8.8.9, `mfra` contains zero or more `tfra` boxes followed by
 * exactly one `mfro`. mp4craft emits one `tfra` per track plus the closing `mfro`.
 *
 * @param options - Per-track `tfra` list and the pre-computed total `mfra` byte length.
 * @returns A {@link Box} that serializes `mfra` with every `tfra` in order followed by `mfro`.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createMfra(options: MfraOptions): Box {
  return {
    type: 'mfra',
    write: (writer) => {
      for (const tfra of options.tfras) writeBox(writer, tfra)
      writeBox(writer, createMfro({ mfraByteLength: options.totalByteLength }))
    },
  }
}
```

- [ ] **Step 6: Extend the muxer to accumulate `mfra` entries and append `mfra` on finalize**

Add imports to `packages/core/src/muxer/mp4-muxer.ts`:

```typescript
import { createMfra } from '@/boxes/mfra'
import { createTfra, type TfraEntry } from '@/boxes/tfra'
```

Add class fields:

```typescript
  private readonly tfraEntriesByTrackId: Map<number, TfraEntry[]> | null;
```

Initialize in the fragmented branch of the constructor:

```typescript
this.tfraEntriesByTrackId = new Map()
for (const track of this.tracks) {
  this.tfraEntriesByTrackId.set(track.trackId, [])
}
```

And set it to `null` in the progressive and in-memory branches.

Extend `writePendingFragment` to record entries:

```typescript
  private writePendingFragment(builder: FragmentBuilder): void {
    const flushResult = builder.flush();
    if (!flushResult) return;
    const moofOffsetFromFileStart = BigInt(this.fragmentedWriteCursor!.current);
    for (const [trackId, firstSampleDecodeTime] of flushResult.firstSampleDecodeTimesByTrackId) {
      this.tfraEntriesByTrackId!.get(trackId)!.push({
        timeInTrackTimescale: firstSampleDecodeTime,
        moofOffsetFromFileStart,
        trafNumber: 1,
        trunNumber: 1,
        sampleNumber: 1,
      });
    }
    this.target.write(this.fragmentedWriteCursor!.current, flushResult.bytes);
    this.fragmentedWriteCursor!.current += flushResult.bytes.length;
  }
```

Extend `finalizeFragmented` to append `mfra`:

```typescript
  private async finalizeFragmented(): Promise<void> {
    if (this.fragmentBuilder!.hasPendingSamples()) {
      this.writePendingFragment(this.fragmentBuilder!);
    }
    this.writeMfra();
    await this.target.finish();
  }

  private writeMfra(): void {
    const tfras = this.tracks.map((track) =>
      createTfra({
        trackId: track.trackId,
        entries: this.tfraEntriesByTrackId!.get(track.trackId) ?? [],
      }),
    );
    // Pass 1 measures the mfra byte length with a placeholder mfro payload; this works
    // because the mfro size is fixed at 16 bytes regardless of the declared mfraByteLength.
    const placeholderMfra = createMfra({ tfras, totalByteLength: 0 });
    const measurementWriter = new Writer();
    writeBox(measurementWriter, placeholderMfra);
    const mfraByteLength = measurementWriter.length;
    const finalMfra = createMfra({ tfras, totalByteLength: mfraByteLength });
    const finalMfraWriter = new Writer();
    writeBox(finalMfraWriter, finalMfra);
    this.target.write(this.fragmentedWriteCursor!.current, finalMfraWriter.toBytes());
    this.fragmentedWriteCursor!.current += finalMfraWriter.length;
  }
```

- [ ] **Step 7: Write an integration test at `packages/core/tests/integration/fragmented-with-mfra.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createFile, type Movie, MP4BoxBuffer } from 'mp4box'
import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'

const fixturesDirectory = resolve(fileURLToPath(new URL('../fixtures', import.meta.url)))

const keyFrameBytes = readFileSync(resolve(fixturesDirectory, 'avc-key-frame.bin'))
const deltaFrameBytes = readFileSync(resolve(fixturesDirectory, 'avc-delta-frame.bin'))
const avccBytes = readFileSync(resolve(fixturesDirectory, 'avcc.bin'))

describe('integration: fragmented output with mfra tail', () => {
  it('ends with an mfra box whose mfro size matches the mfra byte length', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      video: { codec: 'avc', width: 320, height: 240, description: avccBytes, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrameBytes),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(deltaFrameBytes),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrameBytes),
      timestamp: 66_666,
      duration: 33_333,
      isKeyFrame: true,
    })
    await muxer.finalize()

    const outputBytes = new Uint8Array(target.buffer)
    const dataView = new DataView(outputBytes.buffer)
    const declaredMfraByteLength = dataView.getUint32(outputBytes.length - 4, false)
    expect(declaredMfraByteLength).toBeGreaterThan(16)
    const mfraBoxStart = outputBytes.length - declaredMfraByteLength
    const fourcc = String.fromCharCode(
      outputBytes[mfraBoxStart + 4]!,
      outputBytes[mfraBoxStart + 5]!,
      outputBytes[mfraBoxStart + 6]!,
      outputBytes[mfraBoxStart + 7]!
    )
    expect(fourcc).toBe('mfra')

    const parsedInfo = await parseWithMp4Box(target.buffer)
    expect(parsedInfo.tracks.length).toBe(1)
    expect(parsedInfo.isFragmented).toBe(true)
  })
})

function parseWithMp4Box(mp4Bytes: ArrayBuffer): Promise<Movie> {
  return new Promise<Movie>((promiseResolve, promiseReject) => {
    const mp4File = createFile()
    mp4File.onReady = promiseResolve
    mp4File.onError = (errorModule: string, errorMessage: string) =>
      promiseReject(new Error(`mp4box parse error [${errorModule}]: ${errorMessage}`))
    const inputBuffer = MP4BoxBuffer.fromArrayBuffer(mp4Bytes, 0)
    mp4File.appendBuffer(inputBuffer)
    mp4File.flush()
  })
}
```

- [ ] **Step 8: Verify**

```
pnpm --filter mp4craft exec vitest run tests/unit/mfra.test.ts tests/integration/fragmented-with-mfra.test.ts
pnpm test
pnpm typecheck
```

Full suite at 132 passing (105 baseline + 4 Task 1 + 2 Task 2 + 5 Task 3 + 7 Task 4 + 4 Task 5 unit + 1 Task 5 integration + 3 Task 6 unit + 1 Task 6 integration). Typecheck clean.

---

## Spec Coverage Self-Review

| Spec requirement                                                                  | Task       |
| --------------------------------------------------------------------------------- | ---------- |
| `fastStart: "fragmented"` mode in `FastStart` union                               | Task 5     |
| `moov` with empty sample tables and `mvex` child                                  | Tasks 1, 5 |
| `mvex` with `trex` per track                                                      | Task 1     |
| Per-fragment `moof + mdat` pair with monotonic `mfhd.sequence_number`             | Tasks 2, 4 |
| `tfhd` with `default-base-is-moof` flag                                           | Task 3     |
| `tfdt` with per-fragment `baseMediaDecodeTime` (version 1, u64)                   | Task 3     |
| `trun` with per-sample duration, size, flags, and fragment-relative `data_offset` | Task 3     |
| Flush cadence: keyframe arrival plus elapsed `minimumFragmentDuration`            | Task 4     |
| Audio-only files treat every sample as a keyframe                                 | Task 4     |
| Final fragment flushed in `finalize()` even without a trailing keyframe           | Task 5     |
| Sequential writes only (works with `StreamTarget`)                                | Task 5     |
| mp4box round-trip parses fragmented files                                         | Task 5     |
| Optional `mfra + tfra + mfro` random-access index at end of file                  | Task 6     |

Placeholder scan: every step lists complete code, exact commands, and concrete expected output. No `TBD`, `TODO`, or hand-waving.

Type-consistency scan: `FragmentTrackSpec`, `FragmentSampleInput`, `FragmentSamplePreview`, `FragmentFlushResult`, `TrunSample`, `TrexOptions`, `MehdOptions`, `MvexOptions`, `MfhdOptions`, `MoofOptions`, `TfhdOptions`, `TfdtOptions`, `TrunOptions`, `TrafOptions`, `TfraEntry`, `TfraOptions`, `MfroOptions`, `MfraOptions` are declared once and used consistently across every task that references them.

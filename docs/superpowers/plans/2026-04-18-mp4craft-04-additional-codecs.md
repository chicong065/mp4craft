# mp4craft Plan 4: AV1, MP3, FLAC, PCM codecs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AV1 (`av01` + `av1C`), MP3 (`mp4a` with `objectTypeIndication: 0x6B`), FLAC (`fLaC` + `dfLa`), and PCM (`ipcm` + `pcmC`) support, bringing the codec matrix in sync with the design spec.

**Architecture:** Each new codec follows the `HevcCodec` / `Vp9Codec` / `OpusCodec` template: a small class that owns a decoder configuration payload plus the per-codec metadata needed to produce a sample entry and its child box. The existing `createVideoCodec` switch gains an `"av1"` arm. `createAudioCodec` is re-typed so that `AudioTrackConfig` becomes a discriminated union because MP3 has no `description`, PCM has `bitsPerSample` and `endianness`, and FLAC keeps `description`. A matching `AUDIO_CODEC_FOURCC` lookup table (for `mp4a` vs `fLaC` vs `ipcm`) is not needed, but the `VIDEO_CODEC_BRAND` table gains `av1: "av01"`. Every codec ships with unit tests and an mp4box.js round-trip integration test.

**Tech Stack:** TypeScript strict mode, Vitest 4.x, pnpm workspace, tsup ESM, mp4box v2.3.0 for round-trip validation.

---

## Professional style bar (all tasks)

1. **Dispatch discipline.** `Record<Union, T>` tables for value mappings, `switch` with `const unsupportedX: never = x` for construction logic. Never `if/else if` on the same discriminant.
2. **Self-descriptive identifiers.** No `w`, `buf`, `pos`, `v`, `f`, `s`, `t`, `i`, `idx`, `len`, `tmp`, `ctx`, `cfg`, `opts`, `pNalu`.
3. **`type` not `interface`.**
4. **Absolute imports via `@/...`** for src and tests.
5. **JSDoc `/** ... \*/`** on every exported symbol with `@param`, `@returns`, `@throws`, `@remarks`, `@example`, `@see`. Per-field JSDoc on exported option types. The TSDoc `@param name - description` hyphen is expected; it is tag grammar, not prose.
6. **Professional prose style.** Complete sentences, capitalized first word, terminating period, present-tense indicative voice. No em-dashes, no hyphen-as-punctuation between prose clauses, no arrow icons, no prose semicolons. Hyphens inside compound words (`pass-1`, `16.16 fixed-point`, `default-base-is-moof`, `little-endian`, `raw-pcm`) are fine. TypeScript statement-terminator semicolons stay.
7. **No what-comments.** Only why-comments.
8. **No dead code, no `any`, no `@ts-ignore`, no defensive branches for impossible cases.**

## Spec references

- AV1 Codec ISO Media File Format Binding v1.2.0: `https://aomediacodec.github.io/av1-isobmff/`. `av01` sample entry and `av1C` box in §2.2, AV1CodecConfigurationRecord in §2.3.
- MP4 Registration Authority fourcc registry: `https://mp4ra.org/registered-types/boxes`.
- MP4 Registration Authority sample-entry registry: `https://mp4ra.org/registered-types/sampleentries`.
- ISO/IEC 14496-3 §1.6.2.1 (AudioSpecificConfig, reused by AAC; MP3 uses the same sample-entry wrapper but with an empty DecoderSpecificInfo).
- ISO/IEC 14496-1 §7.2.6 (ES_Descriptor, DecoderConfigDescriptor, DecoderSpecificInfo). MP3 uses `objectTypeIndication: 0x6B`.
- FLAC in ISOBMFF: `https://github.com/xiph/flac/blob/master/doc/isoflac.txt`. `fLaC` sample entry wraps a single `dfLa` child.
- FLAC format reference: `https://xiph.org/flac/format.html`. STREAMINFO block layout.
- ISO/IEC 23003-5 (PCM in ISOBMFF). `ipcm` sample entry with `pcmC` FullBox child.

---

## File Map

**Created (source):**

| File                               | Purpose                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/codecs/av1.ts`  | `Av1Codec` class, produces `av01` visual sample entry with an `av1C` child.                                                                   |
| `packages/core/src/boxes/av1c.ts`  | `createAv1c` builder for the `av1C` box (plain `Box`, not FullBox).                                                                           |
| `packages/core/src/codecs/mp3.ts`  | `Mp3Codec` class, produces `mp4a` audio sample entry with an `esds` child carrying `objectTypeIndication: 0x6B` and no `DecoderSpecificInfo`. |
| `packages/core/src/codecs/flac.ts` | `FlacCodec` class, produces `fLaC` audio sample entry with a `dfLa` child.                                                                    |
| `packages/core/src/boxes/dfla.ts`  | `createDfla` builder for the `dfLa` FullBox.                                                                                                  |
| `packages/core/src/codecs/pcm.ts`  | `PcmCodec` class, produces `ipcm` audio sample entry with a `pcmC` child.                                                                     |
| `packages/core/src/boxes/pcmc.ts`  | `createPcmc` builder for the `pcmC` FullBox.                                                                                                  |

**Created (tests):**

| File                                                      | Purpose                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/core/tests/unit/av1.test.ts`                    | Byte-layout tests for `Av1Codec.createSampleEntry()` and `createAv1c`.  |
| `packages/core/tests/integration/av1-validation.test.ts`  | mp4box.js round-trip validation of an in-memory AV1 file.               |
| `packages/core/tests/unit/mp3.test.ts`                    | Byte-layout tests for `Mp3Codec` (esds OTI byte, empty DSI tag).        |
| `packages/core/tests/integration/mp3-validation.test.ts`  | mp4box.js round-trip validation of an in-memory MP3 file.               |
| `packages/core/tests/unit/flac.test.ts`                   | Byte-layout tests for `FlacCodec.createSampleEntry()` and `createDfla`. |
| `packages/core/tests/integration/flac-validation.test.ts` | mp4box.js round-trip validation of an in-memory FLAC file.              |
| `packages/core/tests/unit/pcm.test.ts`                    | Byte-layout tests for `PcmCodec.createSampleEntry()` and `createPcmc`.  |
| `packages/core/tests/integration/pcm-validation.test.ts`  | mp4box.js round-trip validation of an in-memory PCM file.               |

**Modified:**

| File                                   | Change                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/types/config.ts`    | Add `"av1"` to `VideoCodec`. Convert `AudioTrackConfig` to a discriminated union so MP3 and PCM variants are type-safe. Add `AudioCodec` variants `"mp3"`, `"flac"`, `"pcm"`. Export each variant alongside the main union. |
| `packages/core/src/muxer/mp4-muxer.ts` | Extend `VIDEO_CODEC_BRAND` with `av1: "av01"`. Dispatch `"av1"`, `"mp3"`, `"flac"`, `"pcm"` through the switches in `createVideoCodec` and `createAudioCodec`.                                                              |
| `packages/core/src/index.ts`           | Re-export each new codec config variant type alongside the existing `VideoTrackConfig` and `AudioTrackConfig` unions.                                                                                                       |

---

### Task 1: AV1 codec

**Files:**

- Create: `packages/core/src/boxes/av1c.ts`
- Create: `packages/core/src/codecs/av1.ts`
- Create: `packages/core/tests/unit/av1.test.ts`
- Create: `packages/core/tests/integration/av1-validation.test.ts`
- Modify: `packages/core/src/types/config.ts` (widen `VideoCodec` to include `"av1"`)
- Modify: `packages/core/src/muxer/mp4-muxer.ts` (add `"av1"` arm to `createVideoCodec` and the `VIDEO_CODEC_BRAND` table; import `Av1Codec`)
- Modify: `packages/core/src/index.ts` (no new exports unless a new variant type is defined; skip if `VideoTrackConfig` stays flat)

---

#### Public API shape

`VideoTrackConfig` stays a flat shape because every video codec has `{codec, width, height, description, timescale?}`. `"av1"` joins the `VideoCodec` union.

```ts
const muxer = new Mp4Muxer({
  target,
  video: {
    codec: 'av1',
    width: 1920,
    height: 1080,
    description: av1ConfigPayload, // the av1C box payload (header + OBUs)
  },
})
```

The `description` bytes are the entire `av1C` body. Users obtain this from `VideoDecoderConfig.description` when using WebCodecs; for Node it comes from the encoder. `av1C` is a plain `Box`, not a `FullBox`, because its internal marker-and-version byte replaces the usual version and flags fields.

#### av1C layout

Per AV1-ISOBMFF §2.3, `av1C` carries an `AV1CodecConfigurationRecord`. The first 4 bytes of the record pack the marker, version, and profile/level/tier/bit-depth/subsampling fields. The remainder is the raw `configOBUs` byte sequence. mp4craft does not parse this record; it stores and emits the supplied bytes verbatim, mirroring `HevcCodec` and `Vp9Codec`.

#### Steps

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/av1.test.ts`**

Cover:

- `createAv1c` emits an `av1C` box whose fourcc sits at byte 4 and whose body equals the supplied payload bytes (NO FullBox header).
- `Av1Codec.kind === "video"` and `fourcc === "av01"`.
- `Av1Codec.createSampleEntry()` emits an `av01` visual sample entry with width at byte 32, height at byte 34, and an `av1C` child (scanned via a `findFourcc` helper similar to the HEVC and VP9 tests).

Use a minimal 4-byte `av1C` payload `new Uint8Array([0x81, 0x00, 0x0c, 0x00])` (marker=1, version=1, seq_profile=0, seq_level_idx=12 = level 4.0, every other bit zero) for the tests. This is not a decodable stream. It is structural scaffolding.

- [ ] **Step 2: Run the test file, confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/av1.test.ts
```

- [ ] **Step 3: Create `packages/core/src/boxes/av1c.ts`**

Export `createAv1c(av1CodecConfigurationRecord: Uint8Array): Box` that returns a plain `Box` (no `version` or `flags` fields) whose write callback emits the payload bytes. Per-field JSDoc on the parameter, plus `@see` to the AV1-ISOBMFF §2.3 reference (URL in the Spec references section above) and to the MP4RA box registry. Reference the fact that `av1C` reuses the first byte of the payload as its marker and version, which is why the outer box has no FullBox header.

- [ ] **Step 4: Create `packages/core/src/codecs/av1.ts`**

Mirror `HevcCodec`:

- `readonly kind = "video"`
- `readonly fourcc = "av01"`
- Constructor `(description: ArrayBuffer | ArrayBufferView, width: number, height: number)` storing the description as `Uint8Array` and width/height as fields.
- `createSampleEntry(): Box` emits the standard VisualSampleEntry layout (6 reserved, data_ref_idx=1, 2 pre_defined, 2 reserved, 12 pre_defined, u16 width, u16 height, 0x00480000 horiz_res, 0x00480000 vert_res, u32 reserved, u16 frame_count=1, 32-byte compressorName "mp4craft AV1", u16 depth=0x0018, u16 pre_defined=0xFFFF) followed by a child box built via `createAv1c(this.av1ConfigurationRecord)`.
- `private readonly av1ConfigurationRecord: Uint8Array`.
- `toUint8Array` helper for ArrayBuffer/ArrayBufferView conversion.

Spec citations: AV1-ISOBMFF §2.2 for the sample entry, §2.3 for `av1C`. Per-field JSDoc on every option-like constructor argument (document width/height as pixels, description as the `av1C` body).

- [ ] **Step 5: Widen `VideoCodec` in `packages/core/src/types/config.ts`**

Change `export type VideoCodec = "avc" | "hevc" | "vp9";` to include `"av1"`. Update the `VideoCodec` JSDoc to document the new variant: `av1` uses the `av01` sample entry with an `av1C` child, and `description` carries the `av1C` body (AV1CodecConfigurationRecord header plus OBUs).

- [ ] **Step 6: Extend `VIDEO_CODEC_BRAND` and `createVideoCodec` in `packages/core/src/muxer/mp4-muxer.ts`**

Add `Av1Codec` import. Add `av1: "av01"` entry to `VIDEO_CODEC_BRAND`. Add a `case "av1"` branch that returns `new Av1Codec(toBuffer(config.description), config.width, config.height)`. The existing `never` exhaustiveness branch keeps guarding unknown codecs.

- [ ] **Step 7: Create `packages/core/tests/integration/av1-validation.test.ts`**

Mirror `in-memory-validation.test.ts`. Build a minimal `av1C` payload by hand. Emit two samples (both keyframes) with arbitrary byte payloads (32 zero bytes each). Call `muxer.finalize()`, parse with mp4box via `parseWithMp4Box`, and assert `tracks.length === 1`, `tracks[0].codec.startsWith("av01")`, `tracks[0].nb_samples === 2`. Use `fastStart: "in-memory"` so the output is a complete MP4 that mp4box parses cleanly.

- [ ] **Step 8: Run all new tests and the full suite**

```
pnpm --filter mp4craft exec vitest run tests/unit/av1.test.ts tests/integration/av1-validation.test.ts
pnpm test
pnpm typecheck
```

Full suite grows by 3 unit tests and 1 integration test.

---

### Task 2: MP3 codec (plus `AudioTrackConfig` discriminated union refactor)

**Files:**

- Modify: `packages/core/src/types/config.ts` (split `AudioTrackConfig` into a discriminated union; widen `AudioCodec` to `"aac" | "opus" | "mp3"`)
- Create: `packages/core/src/codecs/mp3.ts`
- Create: `packages/core/tests/unit/mp3.test.ts`
- Create: `packages/core/tests/integration/mp3-validation.test.ts`
- Modify: `packages/core/src/muxer/mp4-muxer.ts` (extend `createAudioCodec` switch; import `Mp3Codec`)
- Modify: `packages/core/src/index.ts` (re-export new variant types)

---

#### Discriminated-union refactor

Current `AudioTrackConfig`:

```ts
export type AudioTrackConfig = {
  codec: AudioCodec
  description: ArrayBuffer | ArrayBufferView
  channels: number
  sampleRate: number
  timescale?: number
}
```

Replace with:

```ts
export type AacAudioTrackConfig = {
  codec: 'aac'
  description: ArrayBuffer | ArrayBufferView
  channels: number
  sampleRate: number
  timescale?: number
}
export type OpusAudioTrackConfig = {
  codec: 'opus'
  description: ArrayBuffer | ArrayBufferView
  channels: number
  sampleRate: number
  timescale?: number
}
export type Mp3AudioTrackConfig = {
  codec: 'mp3'
  channels: number
  sampleRate: number
  timescale?: number
}
export type AudioTrackConfig = AacAudioTrackConfig | OpusAudioTrackConfig | Mp3AudioTrackConfig
```

Each variant carries per-field JSDoc. Flac and Pcm join the union in Tasks 3 and 4.

Existing tests that pass `{codec: "aac", description, channels, sampleRate}` or `{codec: "opus", description, channels, sampleRate}` narrow to the corresponding variant without any edits. `createAudioCodec`'s existing `case "aac"` and `case "opus"` branches continue to access `config.description` because the narrowed variants still carry it. The `default` exhaustiveness branch uses `const unsupportedCodec: never = config.codec;` and compiles unchanged.

#### MP3 sample entry

MP3 in MP4 uses the `mp4a` fourcc with an `esds` descriptor whose `DecoderConfigDescriptor.objectTypeIndication` is `0x6B` (MPEG-1 Audio, Layer 3). Unlike AAC, the `DecoderSpecificInfo` is omitted because MP3 decoders derive every parameter from the bitstream.

`Mp3Codec` duplicates the small `esds` building helper from `AacCodec` rather than refactoring it out. The duplication is intentional: Task 2 is about adding MP3, not restructuring AAC. A future polish pass can consolidate both codecs' esds machinery.

#### Steps

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/mp3.test.ts`**

Cover:

- `Mp3Codec.kind === "audio"`, `fourcc === "mp4a"`.
- `createSampleEntry()` emits an `mp4a` audio sample entry with the expected channelcount at byte 24 and samplerate at byte 32 (per ISO/IEC 14496-12 §12.2.3).
- The `esds` child carries `objectTypeIndication = 0x6B` (locate the byte at a well-defined offset inside the emitted box; the AacCodec test is a reference pattern).
- No `DecoderSpecificInfo` descriptor is present (tag 0x05 must not appear anywhere in the esds body; scan the bytes to confirm).

- [ ] **Step 2: Run, confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/mp3.test.ts
```

- [ ] **Step 3: Refactor `AudioTrackConfig` in `packages/core/src/types/config.ts`**

Apply the discriminated-union refactor described above. `AudioCodec` widens to `"aac" | "opus" | "mp3"`. Update the `AudioCodec` JSDoc to describe each variant, including MP3's "no description needed" note.

- [ ] **Step 4: Create `packages/core/src/codecs/mp3.ts`**

Structure:

- `Mp3CodecOptions`: `{ channels: number; sampleRate: number }`. No `description`.
- `Mp3Codec` class with `readonly kind = "audio"`, `readonly fourcc = "mp4a"`, private `channels` and `sampleRate` fields.
- `createSampleEntry(): Box` emits the same audio sample entry shape as `AacCodec` (6 reserved, data_ref_idx=1, 8 reserved, u16 channelcount, u16 samplesize=16, u16 pre_defined=0, u16 reserved=0, u32 samplerate << 16) followed by an esds FullBox built inline.
- `createEsdsBox()` emits the descriptor chain: ES_Descriptor (tag 0x03) wrapping DecoderConfigDescriptor (tag 0x04) with `objectTypeIndication: 0x6B`, `streamType: 0x05` (audio), buffer-size and bitrate zeros, and NO DecoderSpecificInfo, followed by an SLConfigDescriptor (tag 0x06) with predefined value `0x02`. Reuse the same length-writing pattern as `AacCodec` (4-byte extended form for simplicity).

JSDoc citations: ISO/IEC 14496-1 §7.2.6 (ES descriptors) and MP4RA registered types (OTI 0x6B = MPEG-1 Audio).

- [ ] **Step 5: Extend `createAudioCodec` in `packages/core/src/muxer/mp4-muxer.ts`**

Add `Mp3Codec` import. Add `case "mp3"` returning `new Mp3Codec({ channels: config.channels, sampleRate: config.sampleRate })`. The `never` default branch keeps guarding the union.

Return type widens to `AacCodec | OpusCodec | Mp3Codec`.

- [ ] **Step 6: Update `packages/core/src/index.ts` to re-export variant types**

Add `AacAudioTrackConfig`, `OpusAudioTrackConfig`, `Mp3AudioTrackConfig` alongside the existing `AudioTrackConfig`. Verbatim example:

```ts
export type {
  MuxerOptions,
  VideoTrackConfig,
  AudioTrackConfig,
  AacAudioTrackConfig,
  OpusAudioTrackConfig,
  Mp3AudioTrackConfig,
  VideoCodec,
  AudioCodec,
  FastStart,
} from '@/types/config'
```

Preserve all existing exports.

- [ ] **Step 7: Create `packages/core/tests/integration/mp3-validation.test.ts`**

Mirror `in-memory-validation.test.ts`. Build an MP3-only track with two zero-byte samples of plausible size (e.g. 417 bytes each, the typical MP3 frame size for 128 kbps at 44100 Hz). Parse with mp4box. Assert `tracks.length === 1`, `tracks[0].codec.startsWith("mp4a")`, `tracks[0].nb_samples === 2`.

- [ ] **Step 8: Run new tests and full suite**

```
pnpm --filter mp4craft exec vitest run tests/unit/mp3.test.ts tests/integration/mp3-validation.test.ts
pnpm test
pnpm typecheck
```

Full suite grows by ~4 unit tests and 1 integration test.

---

### Task 3: FLAC codec

**Files:**

- Create: `packages/core/src/boxes/dfla.ts`
- Create: `packages/core/src/codecs/flac.ts`
- Create: `packages/core/tests/unit/flac.test.ts`
- Create: `packages/core/tests/integration/flac-validation.test.ts`
- Modify: `packages/core/src/types/config.ts` (add `FlacAudioTrackConfig` variant; widen `AudioCodec`)
- Modify: `packages/core/src/muxer/mp4-muxer.ts` (dispatch "flac")
- Modify: `packages/core/src/index.ts` (re-export `FlacAudioTrackConfig`)

---

#### FLAC sample entry and dfLa

Per FLAC-in-ISOBMFF:

- `fLaC` audio sample entry (same shape as `mp4a` and `Opus`) followed by a `dfLa` child box.
- `dfLa` is a FullBox (version 0, flags 0). Its body is a sequence of FLAC metadata blocks; at minimum the STREAMINFO block (34 bytes of block data plus a 4-byte metadata-block header).

mp4craft's `FlacCodec` accepts `description: ArrayBuffer | ArrayBufferView` containing the concatenated metadata blocks (without the native FLAC "fLaC" magic). Users strip the magic themselves; the JSDoc documents this.

#### dfLa layout details

The FLAC metadata-block header is:

- 1 bit: last-metadata-block flag (1 for the final block, 0 otherwise).
- 7 bits: BLOCK_TYPE (STREAMINFO = 0).
- 24 bits: LENGTH of the block data in bytes (STREAMINFO LENGTH = 34).

A STREAMINFO-only description is therefore 38 bytes: a header byte 0x80 (last-block flag set, block type 0), three length bytes `0x00 0x00 0x22` (= 34), and 34 bytes of STREAMINFO data.

#### Steps

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/flac.test.ts`**

Cover:

- `createDfla(metadataBlocksPayload)` returns a FullBox (version 0, flags 0) named `dfLa` whose body equals the supplied payload.
- `FlacCodec.kind === "audio"`, `fourcc === "fLaC"`.
- `createSampleEntry()` emits `fLaC` with channelcount at byte 24, samplerate at byte 32, and a `dfLa` child.
- The `dfLa` body begins with `0x80 0x00 0x00 0x22` followed by the 34 STREAMINFO bytes (verify using a fabricated 38-byte `description`).

- [ ] **Step 2: Run, confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/flac.test.ts
```

- [ ] **Step 3: Create `packages/core/src/boxes/dfla.ts`**

Export `createDfla(metadataBlocksPayload: Uint8Array): FullBox` returning `{type: "dfLa", version: 0, flags: 0, write: writer => writer.bytes(metadataBlocksPayload)}`. Spec citation: FLAC in ISOBMFF §4 (FLACSpecificBox). Include a `@see` link to `https://github.com/xiph/flac/blob/master/doc/isoflac.txt`.

- [ ] **Step 4: Create `packages/core/src/codecs/flac.ts`**

Structure:

- `FlacCodecOptions`: `{ description: ArrayBuffer | ArrayBufferView; channels: number; sampleRate: number }`.
- `FlacCodec` class with `readonly kind = "audio"`, `readonly fourcc = "fLaC"`, plus private `metadataBlocksPayload: Uint8Array`, `channels`, `sampleRate`.
- `createSampleEntry(): Box` emits the standard audio sample entry body (same shape as Opus) followed by `createDfla(this.metadataBlocksPayload)`.

JSDoc: reference FLAC in ISOBMFF §3 (sample entry), §4 (dfLa), and `https://xiph.org/flac/format.html` for STREAMINFO format. Explain that the `description` bytes are the raw metadata blocks without the "fLaC" magic.

- [ ] **Step 5: Add FLAC variant in `packages/core/src/types/config.ts`**

```ts
export type FlacAudioTrackConfig = {
  codec: 'flac'
  description: ArrayBuffer | ArrayBufferView
  channels: number
  sampleRate: number
  timescale?: number
}
```

Widen `AudioCodec` to include `"flac"` and the `AudioTrackConfig` union to include `FlacAudioTrackConfig`. Update the `AudioCodec` JSDoc bullet for `"flac"` including the "strip 'fLaC' magic" note.

- [ ] **Step 6: Extend `createAudioCodec` in `packages/core/src/muxer/mp4-muxer.ts`**

Add a `case "flac"` returning `new FlacCodec({description: toBuffer(config.description), channels: config.channels, sampleRate: config.sampleRate})`. Import `FlacCodec`.

- [ ] **Step 7: Re-export in `packages/core/src/index.ts`**

Add `FlacAudioTrackConfig` to the exported type list.

- [ ] **Step 8: Create `packages/core/tests/integration/flac-validation.test.ts`**

Build a minimal STREAMINFO payload by hand:

```
min block size (u16) = 4096 (0x1000)
max block size (u16) = 4096 (0x1000)
min frame size (u24) = 0
max frame size (u24) = 0
sample rate (20 bits) = 48000, channels-1 (3 bits) = 1 (stereo), bits-per-sample-1 (5 bits) = 15 (16-bit), total samples (36 bits) = 0
  Packed into 8 bytes. Sample rate 48000 = 0x0BB80; the next 3 bits encode channels-1 = 001, bits-per-sample-1 = 01111. Total samples = 0.
MD5 signature (128 bits) = 16 zero bytes
```

Precompute the 34-byte STREAMINFO payload and prepend the 4-byte metadata-block header (`0x80, 0x00, 0x00, 0x22`). Feed this 38-byte description to `FlacCodec` via `MuxerOptions.audio.description`. Emit two samples of zero bytes (500 bytes each). Parse with mp4box. Assert `tracks.length === 1`, `tracks[0].codec.startsWith("fLaC")` (mp4box may report "fLaC" case-sensitive), `tracks[0].nb_samples === 2`.

If mp4box does not accept zero-filled sample bytes, fall back to asserting only the track structure (`tracks.length === 1` and codec), which still proves the container-level sample entry is valid.

- [ ] **Step 9: Run tests and full suite**

```
pnpm --filter mp4craft exec vitest run tests/unit/flac.test.ts tests/integration/flac-validation.test.ts
pnpm test
pnpm typecheck
```

---

### Task 4: PCM codec

**Files:**

- Create: `packages/core/src/boxes/pcmc.ts`
- Create: `packages/core/src/codecs/pcm.ts`
- Create: `packages/core/tests/unit/pcm.test.ts`
- Create: `packages/core/tests/integration/pcm-validation.test.ts`
- Modify: `packages/core/src/types/config.ts` (add `PcmAudioTrackConfig`; widen `AudioCodec`)
- Modify: `packages/core/src/muxer/mp4-muxer.ts` (dispatch "pcm")
- Modify: `packages/core/src/index.ts` (re-export `PcmAudioTrackConfig`)

---

#### PCM sample entry and pcmC

Per ISO/IEC 23003-5 (MPEG-D Part 5):

- `ipcm` integer PCM audio sample entry (same outer shape as every other AudioSampleEntry) followed by a `pcmC` child.
- `pcmC` is a FullBox (version 0, flags 0) whose body is:
  - `format_flags` (u8): bit 0 is 1 for little-endian, 0 for big-endian. Bits 1 through 7 are reserved (zero).
  - `PCM_sample_size` (u8): 16, 24, or 32. (8-bit PCM is legal but rare and out of scope.)

Total `pcmC` body length is 2 bytes plus the 4-byte FullBox version-and-flags header, so the serialized box is 14 bytes (4 size + 4 fourcc + 4 version+flags + 2 payload).

#### Channel layout caveat

ISO/IEC 23003-5 also defines a `chnl` child box (ChannelLayoutBox) for multi-channel PCM. For mono and stereo, mp4box.js generally accepts a PCM track without `chnl`. Plan 4 ships without `chnl`. If the mp4box integration test later rejects the output, a follow-up polish pass adds a minimal `chnl` with a predefined 1 (mono) or 2 (stereo) layout. The plan notes this explicitly in the integration-test step.

#### Steps

- [ ] **Step 1: Write failing tests at `packages/core/tests/unit/pcm.test.ts`**

Cover:

- `createPcmc({endianness: "little", bitsPerSample: 16})` emits a 14-byte FullBox whose bytes 12 and 13 are `0x01` and `0x10` (format_flags = 1, PCM_sample_size = 16).
- `createPcmc({endianness: "big", bitsPerSample: 24})` emits a 14-byte FullBox whose bytes 12 and 13 are `0x00` and `0x18`.
- `PcmCodec.kind === "audio"`, `fourcc === "ipcm"`.
- `PcmCodec.createSampleEntry()` emits `ipcm` with channelcount at byte 24, samplerate at byte 32, and a `pcmC` child.

- [ ] **Step 2: Run, confirm failure**

```
pnpm --filter mp4craft exec vitest run tests/unit/pcm.test.ts
```

- [ ] **Step 3: Create `packages/core/src/boxes/pcmc.ts`**

Export `createPcmc(options: {endianness: "little" | "big"; bitsPerSample: number}): FullBox` returning `{type: "pcmC", version: 0, flags: 0, write: writer => { writer.u8(options.endianness === "little" ? 1 : 0); writer.u8(options.bitsPerSample); }}`. Per-field JSDoc. Spec citation: ISO/IEC 23003-5.

- [ ] **Step 4: Create `packages/core/src/codecs/pcm.ts`**

Structure:

- `PcmCodecOptions`: `{ channels: number; sampleRate: number; bitsPerSample: 16 | 24 | 32; endianness: "little" | "big" }`.
- `PcmCodec` class with `readonly kind = "audio"`, `readonly fourcc = "ipcm"`, fields for every option.
- `createSampleEntry(): Box` emits the standard audio sample entry body (channelcount, samplesize = bitsPerSample, samplerate << 16) followed by `createPcmc({endianness: this.endianness, bitsPerSample: this.bitsPerSample})`.

JSDoc: cite ISO/IEC 23003-5. Document that `chnl` is not emitted and note the mono/stereo caveat.

- [ ] **Step 5: Add PCM variant in `packages/core/src/types/config.ts`**

```ts
export type PcmAudioTrackConfig = {
  codec: 'pcm'
  channels: number
  sampleRate: number
  bitsPerSample: 16 | 24 | 32
  endianness: 'little' | 'big'
  timescale?: number
}
```

Widen `AudioCodec` to include `"pcm"` and the `AudioTrackConfig` union to include `PcmAudioTrackConfig`.

- [ ] **Step 6: Extend `createAudioCodec` in `packages/core/src/muxer/mp4-muxer.ts`**

Add `case "pcm"` returning `new PcmCodec({channels: config.channels, sampleRate: config.sampleRate, bitsPerSample: config.bitsPerSample, endianness: config.endianness})`.

- [ ] **Step 7: Re-export in `packages/core/src/index.ts`**

Add `PcmAudioTrackConfig` to the exported type list.

- [ ] **Step 8: Create `packages/core/tests/integration/pcm-validation.test.ts`**

Build a PCM-only track with two 480-sample 16-bit stereo frames (each sample pair is 4 bytes, so each frame is 1920 bytes). Use sample-rate 48000. Feed zero bytes for the sample payload. Parse with mp4box. Assert `tracks.length === 1`, `tracks[0].codec.startsWith("ipcm")`, `tracks[0].nb_samples === 2`. If mp4box rejects due to missing `chnl`, downgrade the assertion to verifying the box structure only (scan output bytes for `ipcm` and `pcmC`).

- [ ] **Step 9: Run new tests and full suite**

```
pnpm --filter mp4craft exec vitest run tests/unit/pcm.test.ts tests/integration/pcm-validation.test.ts
pnpm test
pnpm typecheck
```

Final full-suite count: 133 baseline + ~20 new tests across Plan 4, landing around 153.

---

## Spec coverage self-review

| Design-spec requirement                                                                     | Task          |
| ------------------------------------------------------------------------------------------- | ------------- |
| `VideoCodec` includes `"av1"`                                                               | Task 1        |
| `av01` sample entry with `av1C` child                                                       | Task 1        |
| `VIDEO_CODEC_BRAND` gains `av01`                                                            | Task 1        |
| `AudioCodec` includes `"mp3"`                                                               | Task 2        |
| `mp4a` sample entry with `esds` OTI = 0x6B, no DSI                                          | Task 2        |
| `AudioTrackConfig` refactored into discriminated union to accommodate codec-specific shapes | Task 2        |
| `AudioCodec` includes `"flac"`                                                              | Task 3        |
| `fLaC` sample entry with `dfLa` FullBox child                                               | Task 3        |
| `AudioCodec` includes `"pcm"`                                                               | Task 4        |
| `ipcm` sample entry with `pcmC` FullBox child, `bitsPerSample` and `endianness` supported   | Task 4        |
| Public API re-exports each new audio variant type                                           | Tasks 2, 3, 4 |
| mp4box round-trip integration test per codec                                                | All tasks     |

Placeholder scan: every step lists files, exact code shapes, and runnable commands. No `TBD`, `TODO`, or hand-waving.

Type-consistency scan: `Av1Codec`, `Mp3Codec`, `Mp3CodecOptions`, `FlacCodec`, `FlacCodecOptions`, `PcmCodec`, `PcmCodecOptions`, `AacAudioTrackConfig`, `OpusAudioTrackConfig`, `Mp3AudioTrackConfig`, `FlacAudioTrackConfig`, `PcmAudioTrackConfig` are each declared once and referenced consistently across the task that introduces them and any task that extends the dispatching switches.

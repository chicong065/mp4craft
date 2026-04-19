# mp4craft — Plan 1: Foundations + MVP Muxer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a working `mp4craft` MVP that muxes WebCodecs-encoded **AVC (H.264) video** and **AAC audio** into a valid **progressive MP4 file** (moov at end), writing either to memory (`ArrayBufferTarget`) or a sequential byte stream (`StreamTarget`). Output must pass MP4Box.js validation.

**Architecture:** pnpm monorepo (`packages/core/` + `packages/playground/`). ESM-only, TypeScript-first, zero runtime deps. Boxes modeled as a data tree serialized by a single `Writer`. Codecs own their decoder config. Sample tables built incrementally with run-length encoding. Later plans add faststart / fMP4 / more codecs / playground scenarios.

**Tech Stack:** pnpm, TypeScript 5, tsup, Vitest, oxlint, oxfmt, mp4box (dev-only test oracle), Vite + React (playground scaffold only in this plan).

**Spec reference:** `docs/superpowers/specs/2026-04-17-mp4craft-design.md`

**Out of scope for this plan** (covered by later plans):

- `fastStart: 'in-memory'` and `'fragmented'` modes (Plan 2)
- HEVC / AV1 / VP9 / Opus / MP3 / FLAC / PCM codecs (Plan 2)
- Playground scenarios and debug observer wiring (Plan 3)

---

## File Map

All code lives under `packages/core/src/`. Absolute imports resolve `@/*` to `src/*`.

| Path                             | Responsibility                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `index.ts`                       | Public API barrel — re-exports `Mp4Muxer`, targets, types, errors                                   |
| `types/errors.ts`                | `Mp4CraftError` + subclasses (`ConfigError`, `StateError`, `CodecError`, `TargetError`)             |
| `types/config.ts`                | `MuxerOptions`, `VideoTrackConfig`, `AudioTrackConfig`                                              |
| `types/chunk.ts`                 | Raw sample input types (`VideoSampleInput`, `AudioSampleInput`)                                     |
| `io/writer.ts`                   | Byte writer — u8/u16/u24/u32/u64, fourcc, ascii, bytes, fixed-point                                 |
| `io/bit-reader.ts`               | MSB-first bitstream reader for parsing SPS/PPS                                                      |
| `io/nalu.ts`                     | NAL-unit helpers — Annex-B scan, length-prefix conversion, RBSP unescape                            |
| `boxes/box.ts`                   | `Box` base type + serialization entrypoint                                                          |
| `boxes/full-box.ts`              | `FullBox` adds version + flags                                                                      |
| `boxes/ftyp.ts`                  | File Type box                                                                                       |
| `boxes/moov.ts`                  | Movie container (assembles `mvhd` + per-track `trak`)                                               |
| `boxes/mvhd.ts`                  | Movie header                                                                                        |
| `boxes/trak.ts`                  | Track container                                                                                     |
| `boxes/tkhd.ts`                  | Track header                                                                                        |
| `boxes/mdia.ts`                  | Media container (wraps `mdhd` + `hdlr` + `minf`)                                                    |
| `boxes/mdhd.ts`                  | Media header                                                                                        |
| `boxes/hdlr.ts`                  | Handler reference (`vide` / `soun`)                                                                 |
| `boxes/minf.ts`                  | Media information (wraps `vmhd`/`smhd` + `dinf` + `stbl`)                                           |
| `boxes/vmhd.ts`                  | Video media header                                                                                  |
| `boxes/smhd.ts`                  | Sound media header                                                                                  |
| `boxes/dinf.ts`                  | Data information (wraps `dref`)                                                                     |
| `boxes/dref.ts`                  | Data reference (self-contained URL entry)                                                           |
| `boxes/stbl.ts`                  | Sample table container                                                                              |
| `boxes/stsd.ts`                  | Sample description — delegates to codec for sample entry                                            |
| `boxes/stts.ts`                  | Time-to-sample (RLE)                                                                                |
| `boxes/stsc.ts`                  | Sample-to-chunk (RLE)                                                                               |
| `boxes/stsz.ts`                  | Sample sizes                                                                                        |
| `boxes/stco.ts`                  | Chunk offsets (32-bit) + `co64` (64-bit) switching                                                  |
| `boxes/stss.ts`                  | Sync samples (keyframes)                                                                            |
| `boxes/mdat.ts`                  | Media data (size-prefixed; payload is written externally)                                           |
| `tracks/sample-table.ts`         | Incremental RLE builder producing `stts`/`stsc`/`stsz`/`stco`/`stss`                                |
| `tracks/track.ts`                | Abstract `Track` base class                                                                         |
| `tracks/video-track.ts`          | Video track specialization                                                                          |
| `tracks/audio-track.ts`          | Audio track specialization                                                                          |
| `tracks/timestamp-tracker.ts`    | Per-track first-timestamp offsetting + drift detection                                              |
| `codecs/codec.ts`                | Abstract `Codec` base (produces sample entry, receives decoder config)                              |
| `codecs/avc.ts`                  | AVC: parses `avcC` from WebCodecs description, emits `avc1`/`avcC` sample entry, SPS → width/height |
| `codecs/aac.ts`                  | AAC: parses AudioSpecificConfig, emits `mp4a`/`esds` sample entry                                   |
| `targets/target.ts`              | `Target` contract                                                                                   |
| `targets/array-buffer-target.ts` | Dynamic buffer with seek support                                                                    |
| `targets/stream-target.ts`       | Callback-based, non-seekable                                                                        |
| `muxer/state-machine.ts`         | `idle → configured → writing → finalized` transitions                                               |
| `muxer/mp4-muxer.ts`             | `Mp4Muxer` orchestrator                                                                             |

---

## Task 1: Initialize repo and workspace

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.*
coverage/
.vite/
```

- [ ] **Step 2: Create `.npmrc`**

```
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "mp4craft-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "lint": "oxlint",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "typecheck": "tsc -b --noEmit",
    "test": "pnpm --filter mp4craft test",
    "build": "pnpm --filter mp4craft build",
    "dev": "pnpm --filter @mp4craft/playground dev"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "oxlint": "^0.9.0",
    "oxfmt": "^0.1.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore .npmrc pnpm-workspace.yaml package.json
git commit -m "chore: initialize pnpm monorepo"
```

---

## Task 2: Add base TypeScript + lint + format configs

**Files:**

- Create: `tsconfig.base.json`, `tsconfig.json`, `oxlintrc.json`, `oxfmt.toml`

- [ ] **Step 1: Create `tsconfig.base.json`**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
  },
}
```

- [ ] **Step 2: Create root `tsconfig.json`** (project references, no emit)

```jsonc
{
  "files": [],
  "references": [{ "path": "./packages/core" }, { "path": "./packages/playground" }],
}
```

- [ ] **Step 3: Create `oxlintrc.json`**

```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "pedantic": "off",
    "perf": "warn",
    "style": "off",
  },
  "rules": {
    "no-console": "error",
    "no-unused-vars": "error",
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "error",
  },
}
```

- [ ] **Step 4: Create `oxfmt.toml`** (empty — adopt defaults)

```toml
# Adopt oxfmt defaults. Override sparingly.
```

- [ ] **Step 5: Commit**

```bash
git add tsconfig.base.json tsconfig.json oxlintrc.json oxfmt.toml
git commit -m "chore: add TypeScript, oxlint, oxfmt base configs"
```

---

## Task 3: Scaffold `packages/core`

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```jsonc
{
  "name": "mp4craft",
  "version": "0.1.0",
  "type": "module",
  "description": "Zero-dependency TypeScript MP4 muxer for browsers and Node.js",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.mts",
      "import": "./dist/index.mjs",
    },
  },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/dom-webcodecs": "^0.1.13",
    "mp4box": "^0.5.2",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0",
  },
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "baseUrl": ".",
    "types": ["node", "@types/dom-webcodecs"],
    "paths": {
      "@/*": ["src/*"],
    },
  },
  "include": ["src", "tests", "tsup.config.ts", "vitest.config.ts"],
}
```

- [ ] **Step 3: Create `packages/core/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  platform: 'neutral',
})
```

- [ ] **Step 4: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
```

- [ ] **Step 5: Create `packages/core/src/index.ts`** (stub barrel)

```ts
export {}
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, all packages installed.

- [ ] **Step 7: Commit**

```bash
git add packages/core package.json pnpm-lock.yaml
git commit -m "chore: scaffold packages/core (mp4craft)"
```

---

## Task 4: Error hierarchy

**Files:**

- Create: `packages/core/src/types/errors.ts`
- Test: `packages/core/tests/unit/errors.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/unit/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Mp4CraftError, ConfigError, StateError, CodecError, TargetError } from '@/types/errors'

describe('error hierarchy', () => {
  it('all errors extend Mp4CraftError and Error', () => {
    for (const Err of [ConfigError, StateError, CodecError, TargetError]) {
      const e = new (Err as new (m: string) => Error)('x')
      expect(e).toBeInstanceOf(Mp4CraftError)
      expect(e).toBeInstanceOf(Error)
      expect(e.message).toBe('x')
    }
  })

  it('CodecError exposes the codec tag', () => {
    const e = new CodecError('bad sps', 'avc')
    expect(e.codec).toBe('avc')
    expect(e.name).toBe('CodecError')
  })

  it('errors preserve name for discrimination', () => {
    expect(new ConfigError('x').name).toBe('ConfigError')
    expect(new StateError('x').name).toBe('StateError')
    expect(new TargetError('x').name).toBe('TargetError')
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter mp4craft test errors`
Expected: FAIL — `Cannot find module '@/types/errors'`.

- [ ] **Step 3: Implement `src/types/errors.ts`**

```ts
export class Mp4CraftError extends Error {
  override name = 'Mp4CraftError'
}

export class ConfigError extends Mp4CraftError {
  override name = 'ConfigError'
}

export class StateError extends Mp4CraftError {
  override name = 'StateError'
}

export class CodecError extends Mp4CraftError {
  override name = 'CodecError'
  constructor(
    message: string,
    public readonly codec: string
  ) {
    super(message)
  }
}

export class TargetError extends Mp4CraftError {
  override name = 'TargetError'
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm --filter mp4craft test errors`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/errors.ts packages/core/tests/unit/errors.test.ts
git commit -m "feat(core): add Mp4CraftError hierarchy"
```

---

## Task 5: Writer — byte serialization primitive

**Files:**

- Create: `packages/core/src/io/writer.ts`
- Test: `packages/core/tests/unit/writer.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/unit/writer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Writer } from '@/io/writer'

describe('Writer', () => {
  it('writes u8 / u16 / u24 / u32 big-endian', () => {
    const w = new Writer()
    w.u8(0x12)
    w.u16(0x3456)
    w.u24(0x789abc)
    w.u32(0xdeadbeef)
    expect([...w.toBytes()]).toEqual([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xad, 0xbe, 0xef])
  })

  it('writes u64 as two u32 halves (big-endian)', () => {
    const w = new Writer()
    w.u64(0x0123456789abcdefn)
    expect([...w.toBytes()]).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef])
  })

  it('writes fourcc as ASCII', () => {
    const w = new Writer()
    w.fourcc('moov')
    expect(new TextDecoder().decode(w.toBytes())).toBe('moov')
  })

  it('writes fixed-point 16.16', () => {
    const w = new Writer()
    w.fixed16_16(1.0)
    expect([...w.toBytes()]).toEqual([0x00, 0x01, 0x00, 0x00])
  })

  it('writes fixed-point 2.30 (matrix entry)', () => {
    const w = new Writer()
    w.fixed2_30(1.0)
    expect([...w.toBytes()]).toEqual([0x40, 0x00, 0x00, 0x00])
  })

  it('writes raw bytes and tracks length', () => {
    const w = new Writer()
    w.bytes(new Uint8Array([1, 2, 3]))
    expect(w.length).toBe(3)
  })

  it('grows its internal buffer as needed', () => {
    const w = new Writer(4) // start small
    for (let i = 0; i < 100; i++) w.u8(i & 0xff)
    expect(w.length).toBe(100)
    expect(w.toBytes()[99]).toBe(99)
  })

  it('patches u32 at a prior offset (for box size fixups)', () => {
    const w = new Writer()
    const mark = w.length
    w.u32(0) // placeholder
    w.fourcc('test')
    w.u32(0x12345678)
    w.patchU32(mark, w.length) // write actual size at mark
    const bytes = w.toBytes()
    expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 0, bytes.length])
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter mp4craft test writer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/io/writer.ts`**

```ts
export class Writer {
  private buf: Uint8Array
  private view: DataView
  private pos = 0

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(initialCapacity)
    this.view = new DataView(this.buf.buffer)
  }

  get length(): number {
    return this.pos
  }

  private ensure(extra: number): void {
    const need = this.pos + extra
    if (need <= this.buf.length) return
    let cap = this.buf.length || 16
    while (cap < need) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
    this.view = new DataView(this.buf.buffer)
  }

  u8(v: number): void {
    this.ensure(1)
    this.view.setUint8(this.pos, v)
    this.pos += 1
  }

  u16(v: number): void {
    this.ensure(2)
    this.view.setUint16(this.pos, v, false)
    this.pos += 2
  }

  u24(v: number): void {
    this.ensure(3)
    this.view.setUint8(this.pos, (v >>> 16) & 0xff)
    this.view.setUint8(this.pos + 1, (v >>> 8) & 0xff)
    this.view.setUint8(this.pos + 2, v & 0xff)
    this.pos += 3
  }

  u32(v: number): void {
    this.ensure(4)
    this.view.setUint32(this.pos, v >>> 0, false)
    this.pos += 4
  }

  i32(v: number): void {
    this.ensure(4)
    this.view.setInt32(this.pos, v, false)
    this.pos += 4
  }

  u64(v: bigint): void {
    this.ensure(8)
    this.view.setBigUint64(this.pos, v, false)
    this.pos += 8
  }

  fourcc(s: string): void {
    if (s.length !== 4) throw new Error(`fourcc must be 4 chars, got "${s}"`)
    this.ensure(4)
    for (let i = 0; i < 4; i++) this.buf[this.pos + i] = s.charCodeAt(i)
    this.pos += 4
  }

  ascii(s: string): void {
    this.ensure(s.length)
    for (let i = 0; i < s.length; i++) this.buf[this.pos + i] = s.charCodeAt(i)
    this.pos += s.length
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.length)
    this.buf.set(data, this.pos)
    this.pos += data.length
  }

  zeros(n: number): void {
    this.ensure(n)
    this.pos += n // already zeroed by ensure/allocation
  }

  fixed16_16(f: number): void {
    this.u32(Math.round(f * 0x10000) >>> 0)
  }

  fixed2_30(f: number): void {
    this.u32(Math.round(f * 0x40000000) >>> 0)
  }

  patchU32(offset: number, value: number): void {
    this.view.setUint32(offset, value >>> 0, false)
  }

  toBytes(): Uint8Array {
    return this.buf.subarray(0, this.pos)
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm --filter mp4craft test writer`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/writer.ts packages/core/tests/unit/writer.test.ts
git commit -m "feat(core): add byte Writer with BE integers, fourcc, fixed-point, patch"
```

---

## Task 6: NALU utilities (Annex-B → length-prefixed)

**Files:**

- Create: `packages/core/src/io/nalu.ts`
- Test: `packages/core/tests/unit/nalu.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/unit/nalu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { annexBToLengthPrefixed, splitAnnexB, unescapeRbsp } from '@/io/nalu'

describe('NALU utilities', () => {
  it('splitAnnexB finds NAL units separated by 00 00 00 01', () => {
    const input = new Uint8Array([0, 0, 0, 1, 0x67, 0xaa, 0, 0, 0, 1, 0x68, 0xbb, 0xcc])
    const nalus = splitAnnexB(input)
    expect(nalus).toHaveLength(2)
    expect([...nalus[0]!]).toEqual([0x67, 0xaa])
    expect([...nalus[1]!]).toEqual([0x68, 0xbb, 0xcc])
  })

  it('splitAnnexB also accepts 3-byte start code', () => {
    const input = new Uint8Array([0, 0, 1, 0x67, 0xaa, 0, 0, 1, 0x68, 0xbb])
    const nalus = splitAnnexB(input)
    expect(nalus).toHaveLength(2)
    expect([...nalus[0]!]).toEqual([0x67, 0xaa])
    expect([...nalus[1]!]).toEqual([0x68, 0xbb])
  })

  it('annexBToLengthPrefixed emits 4-byte big-endian length + payload', () => {
    const input = new Uint8Array([0, 0, 0, 1, 0x67, 0xaa, 0, 0, 0, 1, 0x68, 0xbb, 0xcc])
    const out = annexBToLengthPrefixed(input)
    expect([...out]).toEqual([0, 0, 0, 2, 0x67, 0xaa, 0, 0, 0, 3, 0x68, 0xbb, 0xcc])
  })

  it('unescapeRbsp removes 0x03 emulation-prevention bytes', () => {
    // raw SPS may contain 00 00 03 XX — the 03 is an emulation prevention byte.
    const input = new Uint8Array([0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x03, 0x02])
    const out = unescapeRbsp(input)
    expect([...out]).toEqual([0x00, 0x00, 0x01, 0x00, 0x00, 0x02])
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter mp4craft test nalu`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/io/nalu.ts`**

```ts
export function splitAnnexB(input: Uint8Array): Uint8Array[] {
  const starts: number[] = []
  for (let i = 0; i + 2 < input.length; i++) {
    if (input[i] === 0 && input[i + 1] === 0) {
      if (input[i + 2] === 1) {
        starts.push(i + 3)
      } else if (i + 3 < input.length && input[i + 2] === 0 && input[i + 3] === 1) {
        starts.push(i + 4)
      }
    }
  }
  const out: Uint8Array[] = []
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!
    const e = i + 1 < starts.length ? starts[i + 1]! - preambleLength(input, starts[i + 1]!) : input.length
    out.push(input.subarray(s, e))
  }
  return out
}

function preambleLength(buf: Uint8Array, afterStart: number): number {
  // afterStart points to the byte *after* the start code; figure out if it was 3 or 4 bytes.
  return afterStart >= 4 && buf[afterStart - 4] === 0 ? 4 : 3
}

export function annexBToLengthPrefixed(input: Uint8Array): Uint8Array {
  const nalus = splitAnnexB(input)
  const total = nalus.reduce((n, u) => n + 4 + u.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let off = 0
  for (const u of nalus) {
    view.setUint32(off, u.length, false)
    out.set(u, off + 4)
    off += 4 + u.length
  }
  return out
}

export function unescapeRbsp(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length)
  let o = 0
  for (let i = 0; i < input.length; i++) {
    if (i + 2 < input.length && input[i] === 0x00 && input[i + 1] === 0x00 && input[i + 2] === 0x03) {
      out[o++] = 0x00
      out[o++] = 0x00
      i += 2 // skip the 0x03
    } else {
      out[o++] = input[i]!
    }
  }
  return out.subarray(0, o)
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm --filter mp4craft test nalu`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/nalu.ts packages/core/tests/unit/nalu.test.ts
git commit -m "feat(core): add NAL-unit utilities (Annex-B split, length-prefix, RBSP unescape)"
```

---

## Task 7: BitReader (for SPS parsing)

**Files:**

- Create: `packages/core/src/io/bit-reader.ts`
- Test: `packages/core/tests/unit/bit-reader.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/unit/bit-reader.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BitReader } from '@/io/bit-reader'

describe('BitReader', () => {
  it('reads individual bits MSB-first', () => {
    const r = new BitReader(new Uint8Array([0b10110001]))
    expect(r.readBit()).toBe(1)
    expect(r.readBit()).toBe(0)
    expect(r.readBit()).toBe(1)
    expect(r.readBit()).toBe(1)
    expect(r.readBit()).toBe(0)
    expect(r.readBit()).toBe(0)
    expect(r.readBit()).toBe(0)
    expect(r.readBit()).toBe(1)
  })

  it('readBits(n) spans byte boundaries', () => {
    const r = new BitReader(new Uint8Array([0xf0, 0x0f]))
    expect(r.readBits(4)).toBe(0xf)
    expect(r.readBits(8)).toBe(0x00)
    expect(r.readBits(4)).toBe(0xf)
  })

  it('unsigned Exp-Golomb (ue(v))', () => {
    // "1"         → 0
    // "010"       → 1
    // "011"       → 2
    // "00100"     → 3
    // "00111"     → 6
    const r = new BitReader(
      new Uint8Array(
        [
          0b10100110_01000011_1_0000000, // packed: 1,010,011,00100,00111
        ].map((x) => x & 0xff) as number[]
      )
    )
    // simpler: build bits manually
    const bits = '1' + '010' + '011' + '00100' + '00111'
    const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0')
    const bytes = new Uint8Array(padded.length / 8)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(padded.slice(i * 8, i * 8 + 8), 2)
    }
    const r2 = new BitReader(bytes)
    expect(r2.readUE()).toBe(0)
    expect(r2.readUE()).toBe(1)
    expect(r2.readUE()).toBe(2)
    expect(r2.readUE()).toBe(3)
    expect(r2.readUE()).toBe(6)
  })

  it('signed Exp-Golomb (se(v))', () => {
    // ue(0)=0 → 0, ue(1)=1 → +1, ue(2)=2 → -1, ue(3)=3 → +2, ue(4)=4 → -2
    const bits = '1' + '010' + '011' + '00100' + '00101'
    const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0')
    const bytes = new Uint8Array(padded.length / 8)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(padded.slice(i * 8, i * 8 + 8), 2)
    }
    const r = new BitReader(bytes)
    expect(r.readSE()).toBe(0)
    expect(r.readSE()).toBe(1)
    expect(r.readSE()).toBe(-1)
    expect(r.readSE()).toBe(2)
    expect(r.readSE()).toBe(-2)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter mp4craft test bit-reader`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/io/bit-reader.ts`**

```ts
export class BitReader {
  private bytePos = 0
  private bitPos = 0 // 0..7, counting from MSB

  constructor(private readonly buf: Uint8Array) {}

  readBit(): number {
    if (this.bytePos >= this.buf.length) throw new Error('BitReader overflow')
    const byte = this.buf[this.bytePos]!
    const bit = (byte >> (7 - this.bitPos)) & 1
    this.bitPos++
    if (this.bitPos === 8) {
      this.bitPos = 0
      this.bytePos++
    }
    return bit
  }

  readBits(n: number): number {
    if (n > 32) throw new Error('readBits: n must be <= 32')
    let v = 0
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit()
    return v >>> 0
  }

  // Unsigned Exp-Golomb
  readUE(): number {
    let zeros = 0
    while (this.readBit() === 0) {
      zeros++
      if (zeros > 32) throw new Error('readUE: too many leading zeros')
    }
    if (zeros === 0) return 0
    const suffix = this.readBits(zeros)
    return (1 << zeros) - 1 + suffix
  }

  // Signed Exp-Golomb
  readSE(): number {
    const ue = this.readUE()
    if (ue === 0) return 0
    // Odd ue → positive, even ue → negative.
    const sign = ue & 1 ? 1 : -1
    return sign * Math.ceil(ue / 2)
  }

  skipBits(n: number): void {
    for (let i = 0; i < n; i++) this.readBit()
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm --filter mp4craft test bit-reader`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/bit-reader.ts packages/core/tests/unit/bit-reader.test.ts
git commit -m "feat(core): add BitReader with MSB-first bits and Exp-Golomb"
```

---

## Task 8: Box primitives (`Box`, `FullBox`)

**Files:**

- Create: `packages/core/src/boxes/box.ts`, `packages/core/src/boxes/full-box.ts`
- Test: `packages/core/tests/unit/box.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/unit/box.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Box, writeBox } from '@/boxes/box'
import { FullBox } from '@/boxes/full-box'
import { Writer } from '@/io/writer'

describe('Box', () => {
  it('serializes leaf box with 8-byte header', () => {
    const box: Box = {
      type: 'free',
      write: (w) => {
        w.zeros(4)
      },
    }
    const w = new Writer()
    writeBox(w, box)
    // 4 size + 4 type + 4 payload = 12 bytes
    const bytes = w.toBytes()
    expect(bytes.length).toBe(12)
    expect(bytes[3]).toBe(12) // size = 12
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('free')
  })

  it('serializes nested boxes with correct sizes', () => {
    const child: Box = {
      type: 'free',
      write: (w) => {
        w.zeros(4)
      },
    } // 12 bytes
    const parent: Box = {
      type: 'moov',
      write: (w) => {
        writeBox(w, child)
      },
    }
    const w = new Writer()
    writeBox(w, parent)
    const bytes = w.toBytes()
    expect(bytes.length).toBe(8 + 12) // parent header + child
    expect(bytes[3]).toBe(20) // parent size
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('moov')
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('free')
  })

  it('FullBox writes version + flags after header', () => {
    const fb: FullBox = {
      type: 'mvhd',
      version: 0,
      flags: 0,
      write: (w) => {
        w.zeros(4)
      },
    }
    const w = new Writer()
    writeBox(w, fb)
    const bytes = w.toBytes()
    // 4 size + 4 type + 1 version + 3 flags + 4 payload = 16
    expect(bytes.length).toBe(16)
    expect(bytes[3]).toBe(16)
    expect(bytes[8]).toBe(0) // version
    expect(bytes[9]).toBe(0)
    expect(bytes[10]).toBe(0)
    expect(bytes[11]).toBe(0) // flags
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter mp4craft test "tests/unit/box.test"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/boxes/box.ts`**

```ts
import type { Writer } from '@/io/writer'

export type Box = {
  type: string // 4-char fourcc
  /** Write the box payload (not the header). Called by writeBox(). */
  write(writer: Writer): void
  /** Optional hint that this is a FullBox; writeBox() will emit version/flags. */
  fullBox?: { version: number; flags: number }
}

export function writeBox(w: Writer, box: Box): void {
  const sizeOffset = w.length
  w.u32(0) // placeholder for size
  w.fourcc(box.type)
  if (box.fullBox) {
    w.u8(box.fullBox.version)
    w.u24(box.fullBox.flags)
  }
  box.write(w)
  const end = w.length
  w.patchU32(sizeOffset, end - sizeOffset)
}
```

- [ ] **Step 4: Implement `src/boxes/full-box.ts`**

```ts
import type { Box } from '@/boxes/box'

export type FullBox = Box &
  Required<Pick<Box, 'write'>> & {
    version: number
    flags: number
  }

/** Helper to build a Box from FullBox fields so writeBox() knows to emit version/flags. */
export function makeFullBox(fb: FullBox): Box {
  return {
    type: fb.type,
    fullBox: { version: fb.version, flags: fb.flags },
    write: fb.write,
  }
}
```

- [ ] **Step 5: Run test to confirm pass**

Run: `pnpm --filter mp4craft test "tests/unit/box.test"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/boxes packages/core/tests/unit/box.test.ts
git commit -m "feat(core): add Box / FullBox primitives and writeBox serializer"
```

---

## Task 9: `ftyp` box

**Files:**

- Create: `packages/core/src/boxes/ftyp.ts`
- Test: `packages/core/tests/unit/ftyp.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { createFtyp } from '@/boxes/ftyp'
import { Writer } from '@/io/writer'

describe('ftyp box', () => {
  it('emits major brand, minor version, compatible brands', () => {
    const w = new Writer()
    writeBox(
      w,
      createFtyp({
        majorBrand: 'isom',
        minorVersion: 512,
        compatibleBrands: ['isom', 'iso2', 'avc1', 'mp41'],
      })
    )
    const bytes = w.toBytes()
    // 8 header + 4 major + 4 minor + 4*4 brands = 32
    expect(bytes.length).toBe(32)
    expect(bytes[3]).toBe(32)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp')
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('isom')
    expect(new DataView(bytes.buffer).getUint32(12, false)).toBe(512)
    expect(String.fromCharCode(...bytes.subarray(16, 20))).toBe('isom')
    expect(String.fromCharCode(...bytes.subarray(28, 32))).toBe('mp41')
  })
})
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter mp4craft test ftyp`
Expected: FAIL.

- [ ] **Step 3: Implement `src/boxes/ftyp.ts`**

```ts
import type { Box } from '@/boxes/box'

export type FtypOptions = {
  majorBrand: string // 4 chars
  minorVersion: number
  compatibleBrands: string[] // 4 chars each
}

export function createFtyp(opts: FtypOptions): Box {
  return {
    type: 'ftyp',
    write: (w) => {
      w.fourcc(opts.majorBrand)
      w.u32(opts.minorVersion)
      for (const b of opts.compatibleBrands) w.fourcc(b)
    },
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter mp4craft test ftyp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/boxes/ftyp.ts packages/core/tests/unit/ftyp.test.ts
git commit -m "feat(core): add ftyp box"
```

---

## Task 10: `mvhd` + `tkhd` boxes

**Files:**

- Create: `packages/core/src/boxes/mvhd.ts`, `packages/core/src/boxes/tkhd.ts`
- Test: `packages/core/tests/unit/movie-header.test.ts`

**Reference ISO/IEC 14496-12 §8.2.2 (mvhd) and §8.3.2 (tkhd).**

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { createMvhd } from '@/boxes/mvhd'
import { createTkhd } from '@/boxes/tkhd'
import { Writer } from '@/io/writer'

describe('movie/track headers', () => {
  it('mvhd v0 is 108 bytes total (8 header + 4 FullBox + 96 payload)', () => {
    const w = new Writer()
    writeBox(w, createMvhd({ timescale: 1000, duration: 0, nextTrackId: 2 }))
    const bytes = w.toBytes()
    expect(bytes.length).toBe(108)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mvhd')
    // timescale at offset 20 (8 header + 4 FullBox + 4 creation + 4 modification)
    expect(new DataView(bytes.buffer).getUint32(20, false)).toBe(1000)
    // nextTrackId is the last 4 bytes
    expect(new DataView(bytes.buffer).getUint32(104, false)).toBe(2)
  })

  it('tkhd v0 has track_enabled flag and width/height in 16.16 fixed-point', () => {
    const w = new Writer()
    writeBox(w, createTkhd({ trackId: 1, duration: 0, width: 1920, height: 1080, isAudio: false }))
    const bytes = w.toBytes()
    // 8 header + 4 FullBox + 80 payload = 92
    expect(bytes.length).toBe(92)
    // flags in the FullBox: 0x000001 (track_enabled)
    expect(bytes[11]).toBe(0x01)
    // width at offset 92-8 = 84 (16.16 → 1920 * 65536)
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(84, false)).toBe(1920 * 0x10000)
    expect(dv.getUint32(88, false)).toBe(1080 * 0x10000)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test movie-header`
Expected: FAIL.

- [ ] **Step 3: Implement `src/boxes/mvhd.ts`**

```ts
import type { Box } from '@/boxes/box'

export type MvhdOptions = {
  creationTime?: number // seconds since 1904-01-01 (MP4 epoch)
  modificationTime?: number
  timescale: number // ticks per second for the movie
  duration: number // in timescale units (0 for unknown)
  nextTrackId: number
}

const UNITY_MATRIX_3x3 = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

export function createMvhd(opts: MvhdOptions): Box {
  return {
    type: 'mvhd',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(opts.creationTime ?? 0)
      w.u32(opts.modificationTime ?? 0)
      w.u32(opts.timescale)
      w.u32(opts.duration)
      w.u32(0x00010000) // rate (1.0)
      w.u16(0x0100) // volume (1.0)
      w.zeros(2) // reserved
      w.zeros(8) // reserved
      for (const m of UNITY_MATRIX_3x3) w.u32(m)
      w.zeros(24) // pre_defined
      w.u32(opts.nextTrackId)
    },
  }
}
```

- [ ] **Step 4: Implement `src/boxes/tkhd.ts`**

```ts
import type { Box } from '@/boxes/box'

export type TkhdOptions = {
  trackId: number
  duration: number // in movie timescale
  width: number // pixels (0 for audio)
  height: number // pixels (0 for audio)
  isAudio: boolean
  creationTime?: number
  modificationTime?: number
}

const UNITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

export function createTkhd(opts: TkhdOptions): Box {
  // flags: 0x01 track_enabled, 0x02 track_in_movie, 0x04 track_in_preview
  const flags = 0x000007
  return {
    type: 'tkhd',
    fullBox: { version: 0, flags },
    write: (w) => {
      w.u32(opts.creationTime ?? 0)
      w.u32(opts.modificationTime ?? 0)
      w.u32(opts.trackId)
      w.zeros(4) // reserved
      w.u32(opts.duration)
      w.zeros(8) // reserved
      w.u16(0) // layer
      w.u16(0) // alternate_group
      w.u16(opts.isAudio ? 0x0100 : 0) // volume (1.0 for audio)
      w.zeros(2) // reserved
      for (const m of UNITY_MATRIX) w.u32(m)
      w.u32((opts.width | 0) * 0x10000) // 16.16 width
      w.u32((opts.height | 0) * 0x10000) // 16.16 height
    },
  }
}
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm --filter mp4craft test movie-header`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/boxes/mvhd.ts packages/core/src/boxes/tkhd.ts packages/core/tests/unit/movie-header.test.ts
git commit -m "feat(core): add mvhd and tkhd boxes"
```

---

## Task 11: Media-info boxes (`mdia` wrapper, `mdhd`, `hdlr`, `minf` wrapper, `vmhd`, `smhd`, `dinf`, `dref`)

**Files:**

- Create: `packages/core/src/boxes/mdia.ts`, `mdhd.ts`, `hdlr.ts`, `minf.ts`, `vmhd.ts`, `smhd.ts`, `dinf.ts`, `dref.ts`
- Test: `packages/core/tests/unit/media-info.test.ts`

**Reference ISO/IEC 14496-12 §8.4 (Media Box) and §8.7 (Data Information).**

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'
import { createMdhd } from '@/boxes/mdhd'
import { createHdlr } from '@/boxes/hdlr'
import { createVmhd } from '@/boxes/vmhd'
import { createSmhd } from '@/boxes/smhd'
import { createDref } from '@/boxes/dref'

describe('media info boxes', () => {
  it('mdhd packs ISO-639 language as 5 bits * 3', () => {
    const w = new Writer()
    writeBox(w, createMdhd({ timescale: 48000, duration: 0, language: 'eng' }))
    const bytes = w.toBytes()
    // 8 + 4 FullBox + 4 creation + 4 modification + 4 timescale + 4 duration + 2 lang + 2 pre = 32
    expect(bytes.length).toBe(32)
    // lang is at offset 28: e=4,n=13,g=6 → (4<<10)|(13<<5)|6 = 0x1146
    expect(new DataView(bytes.buffer).getUint16(28, false)).toBe(0x1146)
  })

  it('hdlr type is "vide" for video and carries a name', () => {
    const w = new Writer()
    writeBox(w, createHdlr({ handlerType: 'vide', name: 'VideoHandler' }))
    const bytes = w.toBytes()
    const typeStart = 8 + 4 + 4 // after header + FullBox + pre_defined(u32)
    expect(String.fromCharCode(...bytes.subarray(typeStart, typeStart + 4))).toBe('vide')
  })

  it('vmhd has flags=1 and 8 bytes payload', () => {
    const w = new Writer()
    writeBox(w, createVmhd())
    const bytes = w.toBytes()
    expect(bytes.length).toBe(8 + 4 + 8) // header + FullBox + 2 graphicsmode + 6 opcolor
    expect(bytes[11]).toBe(0x01) // flags
  })

  it('smhd is 16 bytes total', () => {
    const w = new Writer()
    writeBox(w, createSmhd())
    const bytes = w.toBytes()
    expect(bytes.length).toBe(16)
  })

  it('dref has one self-contained url entry (flags=0x000001)', () => {
    const w = new Writer()
    writeBox(w, createDref())
    const bytes = w.toBytes()
    // 8 header + 4 FullBox + 4 entry_count + 12 url child = 28
    expect(bytes.length).toBe(28)
    expect(String.fromCharCode(...bytes.subarray(20, 24))).toBe('url ')
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test media-info`

- [ ] **Step 3: Implement `src/boxes/mdhd.ts`**

```ts
import type { Box } from '@/boxes/box'

export type MdhdOptions = {
  timescale: number
  duration: number
  language?: string // 3-char ISO-639-2; defaults to 'und'
  creationTime?: number
  modificationTime?: number
}

function packLanguage(code: string): number {
  if (code.length !== 3) throw new Error('language must be 3 chars')
  const a = code.charCodeAt(0) - 0x60
  const b = code.charCodeAt(1) - 0x60
  const c = code.charCodeAt(2) - 0x60
  return ((a & 0x1f) << 10) | ((b & 0x1f) << 5) | (c & 0x1f)
}

export function createMdhd(opts: MdhdOptions): Box {
  return {
    type: 'mdhd',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(opts.creationTime ?? 0)
      w.u32(opts.modificationTime ?? 0)
      w.u32(opts.timescale)
      w.u32(opts.duration)
      w.u16(packLanguage(opts.language ?? 'und'))
      w.u16(0) // pre_defined
    },
  }
}
```

- [ ] **Step 4: Implement `src/boxes/hdlr.ts`**

```ts
import type { Box } from '@/boxes/box'

export type HdlrOptions = {
  handlerType: 'vide' | 'soun'
  name: string // ascii, null-terminated
}

export function createHdlr(opts: HdlrOptions): Box {
  return {
    type: 'hdlr',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(0) // pre_defined
      w.fourcc(opts.handlerType)
      w.zeros(12) // reserved[3]
      w.ascii(opts.name)
      w.u8(0) // null terminator
    },
  }
}
```

- [ ] **Step 5: Implement `src/boxes/vmhd.ts`**

```ts
import type { Box } from '@/boxes/box'

export function createVmhd(): Box {
  return {
    type: 'vmhd',
    fullBox: { version: 0, flags: 0x000001 },
    write: (w) => {
      w.u16(0) // graphicsmode
      w.u16(0)
      w.u16(0)
      w.u16(0) // opcolor
    },
  }
}
```

- [ ] **Step 6: Implement `src/boxes/smhd.ts`**

```ts
import type { Box } from '@/boxes/box'

export function createSmhd(): Box {
  return {
    type: 'smhd',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u16(0) // balance (0 = center)
      w.u16(0) // reserved
    },
  }
}
```

- [ ] **Step 7: Implement `src/boxes/dref.ts` + `dinf.ts`**

```ts
// src/boxes/dref.ts
import type { Box } from '@/boxes/box'
import { writeBox } from '@/boxes/box'

function createUrl(): Box {
  return {
    type: 'url ',
    // flags = 0x000001 means "data is in the same file (self-contained)"
    fullBox: { version: 0, flags: 0x000001 },
    write: () => {
      // self-contained: no URL string
    },
  }
}

export function createDref(): Box {
  const url = createUrl()
  return {
    type: 'dref',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(1) // entry_count
      writeBox(w, url)
    },
  }
}
```

```ts
// src/boxes/dinf.ts
import { writeBox, type Box } from '@/boxes/box'
import { createDref } from '@/boxes/dref'

export function createDinf(): Box {
  return {
    type: 'dinf',
    write: (w) => writeBox(w, createDref()),
  }
}
```

- [ ] **Step 8: Implement `src/boxes/mdia.ts` + `minf.ts`**

```ts
// src/boxes/mdia.ts
import { writeBox, type Box } from '@/boxes/box'

export function createMdia(children: { mdhd: Box; hdlr: Box; minf: Box }): Box {
  return {
    type: 'mdia',
    write: (w) => {
      writeBox(w, children.mdhd)
      writeBox(w, children.hdlr)
      writeBox(w, children.minf)
    },
  }
}
```

```ts
// src/boxes/minf.ts
import { writeBox, type Box } from '@/boxes/box'
import { createDinf } from '@/boxes/dinf'

export function createMinf(children: { mediaHeader: Box; stbl: Box }): Box {
  return {
    type: 'minf',
    write: (w) => {
      writeBox(w, children.mediaHeader)
      writeBox(w, createDinf())
      writeBox(w, children.stbl)
    },
  }
}
```

- [ ] **Step 9: Run — expect pass**

Run: `pnpm --filter mp4craft test media-info`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/boxes packages/core/tests/unit/media-info.test.ts
git commit -m "feat(core): add mdia/mdhd/hdlr/minf/vmhd/smhd/dinf/dref boxes"
```

---

## Task 12: Sample table boxes (`stts`, `stsc`, `stsz`, `stco`, `stss`, `stbl`)

**Files:**

- Create: `packages/core/src/boxes/stts.ts`, `stsc.ts`, `stsz.ts`, `stco.ts`, `stss.ts`, `stbl.ts`
- Test: `packages/core/tests/unit/sample-table-boxes.test.ts`

**Reference ISO/IEC 14496-12 §8.6 (Sample Table).**

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'
import { createStts } from '@/boxes/stts'
import { createStsc } from '@/boxes/stsc'
import { createStsz } from '@/boxes/stsz'
import { createStco, createCo64 } from '@/boxes/stco'
import { createStss } from '@/boxes/stss'

describe('sample table boxes', () => {
  it('stts emits run-length-encoded time deltas', () => {
    const w = new Writer()
    writeBox(
      w,
      createStts([
        { count: 30, delta: 3000 },
        { count: 1, delta: 2000 },
      ])
    )
    const bytes = w.toBytes()
    const dv = new DataView(bytes.buffer)
    // after header(8) + FullBox(4) + entry_count(4) = 16
    expect(dv.getUint32(12, false)).toBe(2)
    expect(dv.getUint32(16, false)).toBe(30)
    expect(dv.getUint32(20, false)).toBe(3000)
    expect(dv.getUint32(24, false)).toBe(1)
    expect(dv.getUint32(28, false)).toBe(2000)
  })

  it('stsc run-length-encoded sample-to-chunk', () => {
    const w = new Writer()
    writeBox(w, createStsc([{ firstChunk: 1, samplesPerChunk: 30, descIndex: 1 }]))
    const bytes = w.toBytes()
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(12, false)).toBe(1) // entry_count
    expect(dv.getUint32(16, false)).toBe(1) // first_chunk
    expect(dv.getUint32(20, false)).toBe(30) // samples_per_chunk
    expect(dv.getUint32(24, false)).toBe(1) // sample_description_index
  })

  it('stsz with varying sizes', () => {
    const w = new Writer()
    writeBox(w, createStsz({ sizes: [100, 200, 300] }))
    const bytes = w.toBytes()
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(12, false)).toBe(0) // sample_size (0 = per-entry)
    expect(dv.getUint32(16, false)).toBe(3) // sample_count
    expect(dv.getUint32(20, false)).toBe(100)
    expect(dv.getUint32(24, false)).toBe(200)
    expect(dv.getUint32(28, false)).toBe(300)
  })

  it('stco emits 32-bit chunk offsets', () => {
    const w = new Writer()
    writeBox(w, createStco([1000, 2000, 3000]))
    const bytes = w.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('stco')
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(12, false)).toBe(3)
    expect(dv.getUint32(16, false)).toBe(1000)
  })

  it('co64 emits 64-bit chunk offsets', () => {
    const w = new Writer()
    writeBox(w, createCo64([1000n, 0x100000000n]))
    const bytes = w.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('co64')
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(12, false)).toBe(2)
    expect(dv.getBigUint64(16, false)).toBe(1000n)
    expect(dv.getBigUint64(24, false)).toBe(0x100000000n)
  })

  it('stss emits keyframe sample numbers (1-indexed)', () => {
    const w = new Writer()
    writeBox(w, createStss([1, 30, 60]))
    const bytes = w.toBytes()
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(12, false)).toBe(3)
    expect(dv.getUint32(16, false)).toBe(1)
    expect(dv.getUint32(20, false)).toBe(30)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test sample-table-boxes`

- [ ] **Step 3: Implement the boxes**

```ts
// src/boxes/stts.ts
import type { Box } from '@/boxes/box'

export type SttsEntry = { count: number; delta: number }

export function createStts(entries: SttsEntry[]): Box {
  return {
    type: 'stts',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(entries.length)
      for (const e of entries) {
        w.u32(e.count)
        w.u32(e.delta)
      }
    },
  }
}
```

```ts
// src/boxes/stsc.ts
import type { Box } from '@/boxes/box'

export type StscEntry = { firstChunk: number; samplesPerChunk: number; descIndex: number }

export function createStsc(entries: StscEntry[]): Box {
  return {
    type: 'stsc',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(entries.length)
      for (const e of entries) {
        w.u32(e.firstChunk)
        w.u32(e.samplesPerChunk)
        w.u32(e.descIndex)
      }
    },
  }
}
```

```ts
// src/boxes/stsz.ts
import type { Box } from '@/boxes/box'

export type StszOptions = {
  fixedSize?: number // if set, all samples share this size
  sizes?: number[] // otherwise, per-sample
}

export function createStsz(opts: StszOptions): Box {
  const { fixedSize, sizes } = opts
  return {
    type: 'stsz',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(fixedSize ?? 0)
      if (fixedSize) {
        w.u32(sizes?.length ?? 0)
      } else {
        const s = sizes ?? []
        w.u32(s.length)
        for (const n of s) w.u32(n)
      }
    },
  }
}
```

```ts
// src/boxes/stco.ts
import type { Box } from '@/boxes/box'

export function createStco(offsets: number[]): Box {
  return {
    type: 'stco',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(offsets.length)
      for (const o of offsets) w.u32(o)
    },
  }
}

export function createCo64(offsets: bigint[]): Box {
  return {
    type: 'co64',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(offsets.length)
      for (const o of offsets) w.u64(o)
    },
  }
}
```

```ts
// src/boxes/stss.ts
import type { Box } from '@/boxes/box'

export function createStss(syncSamples: number[]): Box {
  return {
    type: 'stss',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(syncSamples.length)
      for (const n of syncSamples) w.u32(n)
    },
  }
}
```

```ts
// src/boxes/stbl.ts
import { writeBox, type Box } from '@/boxes/box'

export function createStbl(children: {
  stsd: Box
  stts: Box
  stsc: Box
  stsz: Box
  stco: Box // either stco or co64
  stss?: Box // only for video
}): Box {
  return {
    type: 'stbl',
    write: (w) => {
      writeBox(w, children.stsd)
      writeBox(w, children.stts)
      writeBox(w, children.stsc)
      writeBox(w, children.stsz)
      writeBox(w, children.stco)
      if (children.stss) writeBox(w, children.stss)
    },
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test sample-table-boxes`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/boxes packages/core/tests/unit/sample-table-boxes.test.ts
git commit -m "feat(core): add stts/stsc/stsz/stco/co64/stss/stbl sample-table boxes"
```

---

## Task 13: Incremental `SampleTable` builder

**Files:**

- Create: `packages/core/src/tracks/sample-table.ts`
- Test: `packages/core/tests/unit/sample-table.test.ts`

**Responsibility:** accept samples as they arrive; produce `stts`/`stsc`/`stsz`/`stco`/`stss` boxes at finalize. Maintain RLE runs so we never buffer per-sample metadata beyond what's needed.

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { SampleTable } from '@/tracks/sample-table'

describe('SampleTable', () => {
  it('records samples and builds stts with RLE', () => {
    const st = new SampleTable({ isVideo: true })
    for (let i = 0; i < 5; i++) {
      st.addSample({ size: 100, duration: 3000, isKeyFrame: i === 0, chunkOffset: 1000 + i * 100 })
    }
    const { sttsEntries } = st.build()
    expect(sttsEntries).toEqual([{ count: 5, delta: 3000 }])
  })

  it('splits stts runs on delta change', () => {
    const st = new SampleTable({ isVideo: false })
    st.addSample({ size: 100, duration: 1000, isKeyFrame: true, chunkOffset: 0 })
    st.addSample({ size: 100, duration: 1000, isKeyFrame: true, chunkOffset: 100 })
    st.addSample({ size: 100, duration: 2000, isKeyFrame: true, chunkOffset: 200 })
    const { sttsEntries } = st.build()
    expect(sttsEntries).toEqual([
      { count: 2, delta: 1000 },
      { count: 1, delta: 2000 },
    ])
  })

  it('records keyframes (1-indexed) for video', () => {
    const st = new SampleTable({ isVideo: true })
    st.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 0 }) // sample #1
    st.addSample({ size: 100, duration: 3000, isKeyFrame: false, chunkOffset: 100 }) // #2
    st.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 200 }) // #3
    const { syncSamples } = st.build()
    expect(syncSamples).toEqual([1, 3])
  })

  it('collects chunk offsets (one sample per chunk for v1 MVP)', () => {
    const st = new SampleTable({ isVideo: true })
    st.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 1000 })
    st.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 1100 })
    const { chunkOffsets, stscEntries } = st.build()
    expect(chunkOffsets).toEqual([1000, 1100])
    expect(stscEntries).toEqual([{ firstChunk: 1, samplesPerChunk: 1, descIndex: 1 }])
  })

  it('reports needs64Bit when any offset exceeds 2^32-1', () => {
    const st = new SampleTable({ isVideo: false })
    st.addSample({ size: 100, duration: 1000, isKeyFrame: true, chunkOffset: 0 })
    st.addSample({
      size: 100,
      duration: 1000,
      isKeyFrame: true,
      chunkOffset: Number.MAX_SAFE_INTEGER,
    })
    const { needs64Bit } = st.build()
    expect(needs64Bit).toBe(true)
  })

  it('exposes total duration and sample count', () => {
    const st = new SampleTable({ isVideo: true })
    for (let i = 0; i < 10; i++) {
      st.addSample({ size: 100, duration: 3000, isKeyFrame: i === 0, chunkOffset: i * 100 })
    }
    const r = st.build()
    expect(r.sampleCount).toBe(10)
    expect(r.totalDuration).toBe(30000)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test "tests/unit/sample-table.test"`

- [ ] **Step 3: Implement `src/tracks/sample-table.ts`**

For MVP simplicity, emit **one sample per chunk** (pragmatic, valid, slightly larger `stco`). Optimizing to multi-sample chunks is deferred.

```ts
import type { SttsEntry } from '@/boxes/stts'
import type { StscEntry } from '@/boxes/stsc'

export type SampleInfo = {
  size: number // bytes
  duration: number // in media timescale
  isKeyFrame: boolean
  chunkOffset: number // byte offset within the file
}

export type SampleTableBuildResult = {
  sampleCount: number
  totalDuration: number
  sttsEntries: SttsEntry[]
  stscEntries: StscEntry[]
  sampleSizes: number[] // for stsz (per-sample)
  chunkOffsets: number[] // values interpret as bigint when needs64Bit
  syncSamples?: number[] // video only; 1-indexed sample numbers
  needs64Bit: boolean
}

export class SampleTable {
  private samples = 0
  private total = 0
  private readonly stts: SttsEntry[] = []
  private readonly sizes: number[] = []
  private readonly chunks: number[] = []
  private readonly keyframes: number[] = []
  private needs64Bit = false

  constructor(private readonly opts: { isVideo: boolean }) {}

  addSample(info: SampleInfo): void {
    this.samples += 1
    this.total += info.duration
    this.sizes.push(info.size)
    this.chunks.push(info.chunkOffset)

    const last = this.stts[this.stts.length - 1]
    if (last && last.delta === info.duration) {
      last.count += 1
    } else {
      this.stts.push({ count: 1, delta: info.duration })
    }

    if (this.opts.isVideo && info.isKeyFrame) {
      this.keyframes.push(this.samples)
    }

    if (info.chunkOffset > 0xffffffff) this.needs64Bit = true
  }

  build(): SampleTableBuildResult {
    return {
      sampleCount: this.samples,
      totalDuration: this.total,
      sttsEntries: [...this.stts],
      stscEntries: [{ firstChunk: 1, samplesPerChunk: 1, descIndex: 1 }],
      sampleSizes: [...this.sizes],
      chunkOffsets: [...this.chunks],
      ...(this.opts.isVideo ? { syncSamples: [...this.keyframes] } : {}),
      needs64Bit: this.needs64Bit,
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test "tests/unit/sample-table.test"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tracks/sample-table.ts packages/core/tests/unit/sample-table.test.ts
git commit -m "feat(core): add incremental SampleTable builder (RLE stts/stsc, keyframes)"
```

---

## Task 14: `mdat` box

**Files:**

- Create: `packages/core/src/boxes/mdat.ts`
- Test: `packages/core/tests/unit/mdat.test.ts`

`mdat` is special: its header is fixed but payload is streamed directly by the muxer. We support two forms:

1. **Sized-known**: 32-bit size prefix (used after finalize).
2. **Largesize**: size=1, fourcc=`mdat`, then 64-bit actual size (when payload > 4 GiB).

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeMdatHeader32, writeMdatHeader64, MDAT_HEADER_SIZE_32, MDAT_HEADER_SIZE_64 } from '@/boxes/mdat'
import { Writer } from '@/io/writer'

describe('mdat header', () => {
  it('32-bit form writes [size(4)] [mdat(4)]', () => {
    const w = new Writer()
    writeMdatHeader32(w, 1000)
    const b = w.toBytes()
    expect(MDAT_HEADER_SIZE_32).toBe(8)
    expect(b.length).toBe(8)
    expect(new DataView(b.buffer).getUint32(0, false)).toBe(1000)
    expect(String.fromCharCode(...b.subarray(4, 8))).toBe('mdat')
  })

  it('64-bit form writes [1(4)] [mdat(4)] [size(8)]', () => {
    const w = new Writer()
    writeMdatHeader64(w, 0x100000000n)
    const b = w.toBytes()
    expect(MDAT_HEADER_SIZE_64).toBe(16)
    expect(b.length).toBe(16)
    expect(new DataView(b.buffer).getUint32(0, false)).toBe(1)
    expect(String.fromCharCode(...b.subarray(4, 8))).toBe('mdat')
    expect(new DataView(b.buffer).getBigUint64(8, false)).toBe(0x100000000n)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test "tests/unit/mdat"`

- [ ] **Step 3: Implement `src/boxes/mdat.ts`**

```ts
import type { Writer } from '@/io/writer'

export const MDAT_HEADER_SIZE_32 = 8
export const MDAT_HEADER_SIZE_64 = 16

export function writeMdatHeader32(w: Writer, totalSize: number): void {
  w.u32(totalSize) // size includes the header itself
  w.fourcc('mdat')
}

export function writeMdatHeader64(w: Writer, totalSize: bigint): void {
  w.u32(1) // largesize signal
  w.fourcc('mdat')
  w.u64(totalSize) // 64-bit total size
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test "tests/unit/mdat"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/boxes/mdat.ts packages/core/tests/unit/mdat.test.ts
git commit -m "feat(core): add mdat header writers (32- and 64-bit)"
```

---

## Task 15: Codec base + AVC codec

**Files:**

- Create: `packages/core/src/codecs/codec.ts`, `packages/core/src/codecs/avc.ts`
- Test: `packages/core/tests/unit/codec-avc.test.ts`
- Fixture: `packages/core/tests/fixtures/avcc-baseline.bin` (a minimal, hand-crafted avcC record)

The `Codec` interface produces a **sample entry** (e.g., `avc1`) containing configuration (e.g., `avcC`). `AvcCodec` parses width/height out of SPS (once, from the decoder config description).

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { AvcCodec } from '@/codecs/avc'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'

// A minimal avcC record we'll feed in. Constructed by hand (see ISO/IEC 14496-15 §5.3.3.1).
// Contents: configVersion=1, profile=66 (baseline), profile_compat=0, level=30,
//           lengthSizeMinusOne=3 (→ 4-byte length prefix),
//           numOfSPS=1, sps_length=... sps_bytes..., numOfPPS=1, pps_length=... pps_bytes...
//
// For test purposes the SPS contains width=640, height=480. We hand-encode it below.
const sps = new Uint8Array([
  0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1,
  0x83, 0x19, 0x60,
])
const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80])
const avcC = buildAvcC(sps, pps)

function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out: number[] = [
    0x01, // configurationVersion
    sps[1]!, // AVCProfileIndication
    sps[2]!, // profile_compatibility
    sps[3]!, // AVCLevelIndication
    0xff, // 6 bits reserved (111111) + lengthSizeMinusOne=11
    0xe1, // 3 bits reserved (111) + numOfSequenceParameterSets=00001
  ]
  out.push((sps.length >> 8) & 0xff, sps.length & 0xff)
  out.push(...sps)
  out.push(0x01) // numOfPictureParameterSets
  out.push((pps.length >> 8) & 0xff, pps.length & 0xff)
  out.push(...pps)
  return new Uint8Array(out)
}

describe('AvcCodec', () => {
  it('extracts width & height from SPS', () => {
    const codec = new AvcCodec(avcC.buffer)
    expect(codec.width).toBe(640)
    expect(codec.height).toBe(480)
  })

  it('produces an avc1 sample entry containing an avcC box', () => {
    const codec = new AvcCodec(avcC.buffer)
    const w = new Writer()
    writeBox(w, codec.createSampleEntry())
    const bytes = w.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('avc1')
    // search for 'avcC' fourcc somewhere in the payload
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('avcC')).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test codec-avc`

- [ ] **Step 3: Implement `src/codecs/codec.ts`**

```ts
import type { Box } from '@/boxes/box'

export type CodecKind = 'video' | 'audio'

export type Codec = {
  readonly kind: CodecKind
  readonly fourcc: string // e.g., 'avc1', 'mp4a'
  /** Build the sample entry Box used inside stsd. */
  createSampleEntry(): Box
}
```

- [ ] **Step 4: Implement `src/codecs/avc.ts`**

```ts
import { writeBox, type Box } from '@/boxes/box'
import { BitReader } from '@/io/bit-reader'
import { unescapeRbsp } from '@/io/nalu'
import { CodecError } from '@/types/errors'
import type { Codec } from '@/codecs/codec'

export class AvcCodec implements Codec {
  readonly kind = 'video'
  readonly fourcc = 'avc1'
  readonly width: number
  readonly height: number
  private readonly avcc: Uint8Array

  constructor(description: ArrayBuffer | ArrayBufferView) {
    this.avcc = toU8(description)
    const { width, height } = parseAvcCDimensions(this.avcc)
    this.width = width
    this.height = height
  }

  createSampleEntry(): Box {
    return {
      type: 'avc1',
      write: (w) => {
        // VisualSampleEntry: 6 reserved + 2 data_reference_index
        w.zeros(6)
        w.u16(1)
        // pre_defined(2) + reserved(2) + pre_defined[3] (12)
        w.u16(0)
        w.u16(0)
        w.zeros(12)
        w.u16(this.width)
        w.u16(this.height)
        w.u32(0x00480000) // horizresolution 72dpi
        w.u32(0x00480000) // vertresolution 72dpi
        w.u32(0) // reserved
        w.u16(1) // frame_count
        // compressorname: 32 bytes, first byte = length
        const name = 'mp4craft AVC'
        w.u8(name.length)
        w.ascii(name)
        w.zeros(31 - name.length)
        w.u16(0x0018) // depth
        w.i32(-1) // pre_defined
        // avcC child box
        writeBox(w, this.createAvcCBox())
      },
    }
  }

  private createAvcCBox(): Box {
    const bytes = this.avcc
    return {
      type: 'avcC',
      write: (w) => w.bytes(bytes),
    }
  }
}

function toU8(d: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (d instanceof ArrayBuffer) return new Uint8Array(d)
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
}

/** Parse width/height from the first SPS in the avcC record. */
function parseAvcCDimensions(avcc: Uint8Array): { width: number; height: number } {
  if (avcc.length < 7) throw new CodecError('avcC record too short', 'avc')
  if (avcc[0] !== 1) throw new CodecError('unsupported avcC version', 'avc')
  const numSps = avcc[5]! & 0x1f
  if (numSps < 1) throw new CodecError('avcC has no SPS', 'avc')
  const spsLen = (avcc[6]! << 8) | avcc[7]!
  const sps = avcc.subarray(8, 8 + spsLen)
  return parseSpsDimensions(sps)
}

/** Parse width/height from a raw SPS NAL unit (starts with 0x67 forbidden_zero+NRI+type=7). */
function parseSpsDimensions(spsWithNalHeader: Uint8Array): { width: number; height: number } {
  // skip 1-byte NAL header, then unescape RBSP
  const rbsp = unescapeRbsp(spsWithNalHeader.subarray(1))
  const r = new BitReader(rbsp)
  const profileIdc = r.readBits(8)
  r.skipBits(8) // constraint flags + reserved
  r.readBits(8) // level_idc
  r.readUE() // seq_parameter_set_id
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
    const chromaFormatIdc = r.readUE()
    if (chromaFormatIdc === 3) r.readBit() // separate_colour_plane_flag
    r.readUE() // bit_depth_luma_minus8
    r.readUE() // bit_depth_chroma_minus8
    r.readBit() // qpprime_y_zero_transform_bypass_flag
    const seqScalingMatrixPresent = r.readBit()
    if (seqScalingMatrixPresent) {
      const n = chromaFormatIdc === 3 ? 12 : 8
      for (let i = 0; i < n; i++) {
        if (r.readBit()) {
          const listSize = i < 6 ? 16 : 64
          let lastScale = 8,
            nextScale = 8
          for (let j = 0; j < listSize; j++) {
            if (nextScale !== 0) {
              const deltaScale = r.readSE()
              nextScale = (lastScale + deltaScale + 256) % 256
            }
            lastScale = nextScale === 0 ? lastScale : nextScale
          }
        }
      }
    }
  }
  r.readUE() // log2_max_frame_num_minus4
  const picOrderCntType = r.readUE()
  if (picOrderCntType === 0) {
    r.readUE() // log2_max_pic_order_cnt_lsb_minus4
  } else if (picOrderCntType === 1) {
    r.readBit()
    r.readSE()
    r.readSE()
    const n = r.readUE()
    for (let i = 0; i < n; i++) r.readSE()
  }
  r.readUE() // max_num_ref_frames
  r.readBit() // gaps_in_frame_num_value_allowed_flag
  const picWidthInMbsMinus1 = r.readUE()
  const picHeightInMapUnitsMinus1 = r.readUE()
  const frameMbsOnlyFlag = r.readBit()
  if (!frameMbsOnlyFlag) r.readBit() // mb_adaptive_frame_field_flag
  r.readBit() // direct_8x8_inference_flag
  const frameCroppingFlag = r.readBit()
  let cropLeft = 0,
    cropRight = 0,
    cropTop = 0,
    cropBottom = 0
  if (frameCroppingFlag) {
    cropLeft = r.readUE()
    cropRight = r.readUE()
    cropTop = r.readUE()
    cropBottom = r.readUE()
  }
  const width = (picWidthInMbsMinus1 + 1) * 16 - cropLeft * 2 - cropRight * 2
  const height = (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 - cropTop * 2 - cropBottom * 2
  return { width, height }
}
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm --filter mp4craft test codec-avc`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/codecs packages/core/tests/unit/codec-avc.test.ts
git commit -m "feat(core): add Codec interface and AVC codec with SPS parsing"
```

---

## Task 16: AAC codec

**Files:**

- Create: `packages/core/src/codecs/aac.ts`
- Test: `packages/core/tests/unit/codec-aac.test.ts`

AAC's decoder config is an `AudioSpecificConfig` (2–5 bytes). The sample entry is `mp4a` containing an `esds` box that contains a full MPEG-4 Elementary Stream Descriptor. The ES descriptor structure is nested; we write it byte-for-byte per ISO/IEC 14496-1 §7.2.6.

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { AacCodec } from '@/codecs/aac'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'

describe('AacCodec', () => {
  it('creates mp4a entry containing esds with the supplied AudioSpecificConfig', () => {
    const asc = new Uint8Array([0x12, 0x10]) // AOT=LC, sample rate idx 4 (44.1kHz), channels=2
    const codec = new AacCodec({ description: asc.buffer, channels: 2, sampleRate: 44100 })
    const w = new Writer()
    writeBox(w, codec.createSampleEntry())
    const bytes = w.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mp4a')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('esds')).toBeGreaterThan(0)
    // ASC bytes should appear verbatim inside the esds payload
    const idx = indexOfBytes(bytes, asc)
    expect(idx).toBeGreaterThan(0)
  })
})

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test codec-aac`

- [ ] **Step 3: Implement `src/codecs/aac.ts`**

```ts
import { writeBox, type Box } from '@/boxes/box'
import type { Codec } from '@/codecs/codec'

export type AacCodecOptions = {
  description: ArrayBuffer | ArrayBufferView // AudioSpecificConfig bytes
  channels: number
  sampleRate: number
}

export class AacCodec implements Codec {
  readonly kind = 'audio'
  readonly fourcc = 'mp4a'
  readonly channels: number
  readonly sampleRate: number
  private readonly asc: Uint8Array

  constructor(opts: AacCodecOptions) {
    this.asc = toU8(opts.description)
    this.channels = opts.channels
    this.sampleRate = opts.sampleRate
  }

  createSampleEntry(): Box {
    return {
      type: 'mp4a',
      write: (w) => {
        // AudioSampleEntry: 6 reserved + 2 data_reference_index
        w.zeros(6)
        w.u16(1)
        // 8 bytes reserved
        w.zeros(8)
        w.u16(this.channels)
        w.u16(16) // samplesize
        w.u16(0) // pre_defined
        w.u16(0) // reserved
        w.u32(this.sampleRate * 0x10000) // 16.16 fixed
        writeBox(w, this.createEsdsBox())
      },
    }
  }

  private createEsdsBox(): Box {
    const asc = this.asc
    return {
      type: 'esds',
      fullBox: { version: 0, flags: 0 },
      write: (w) => {
        // ES_Descriptor (tag=3) — writeMp4Descriptor computes size by writing body to a temp Writer.
        writeMp4Descriptor(w, 0x03, (w2) => {
          w2.u16(0) // ES_ID
          w2.u8(0) // stream-priority flags
          // DecoderConfigDescriptor (tag=4)
          writeMp4Descriptor(w2, 0x04, (w3) => {
            w3.u8(0x40) // objectTypeIndication = Audio ISO/IEC 14496-3
            w3.u8((0x05 << 2) | 0x01) // streamType=Audio(5), upstream=0, reserved=1
            w3.u24(0) // bufferSizeDB
            w3.u32(0) // maxBitrate
            w3.u32(0) // avgBitrate
            // DecoderSpecificInfo (tag=5) → AudioSpecificConfig
            writeMp4Descriptor(w3, 0x05, (w4) => {
              w4.bytes(asc)
            })
          })
          // SLConfigDescriptor (tag=6)
          writeMp4Descriptor(w2, 0x06, (w3) => {
            w3.u8(0x02) // predefined = MP4
          })
        })
      },
    }
  }
}

import { Writer } from '@/io/writer'

// MP4 descriptor wire format (ISO/IEC 14496-1 §7.2.6): tag byte + variable-length size + body.
function writeMp4Descriptor(parent: Writer, tag: number, writeBody: (w: Writer) => void): void {
  const body = new Writer()
  writeBody(body)
  const bytes = body.toBytes()
  parent.u8(tag)
  writeDescriptorLength(parent, bytes.length)
  parent.bytes(bytes)
}

function writeDescriptorLength(w: Writer, len: number): void {
  // Use 4-byte extended form for simplicity: 0x80 | (byte) three times, then final.
  w.u8(0x80 | ((len >> 21) & 0x7f))
  w.u8(0x80 | ((len >> 14) & 0x7f))
  w.u8(0x80 | ((len >> 7) & 0x7f))
  w.u8(len & 0x7f)
}

function toU8(d: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (d instanceof ArrayBuffer) return new Uint8Array(d)
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test codec-aac`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codecs/aac.ts packages/core/tests/unit/codec-aac.test.ts
git commit -m "feat(core): add AAC codec with esds/ES descriptor tree"
```

---

## Task 17: `stsd` box (delegates to Codec)

**Files:**

- Create: `packages/core/src/boxes/stsd.ts`
- Test: `packages/core/tests/unit/stsd.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'
import { createStsd } from '@/boxes/stsd'
import type { Box } from '@/boxes/box'

describe('stsd', () => {
  it('wraps a single sample entry with entry_count=1', () => {
    const entry: Box = { type: 'avc1', write: (w) => w.zeros(78) } // minimal VisualSampleEntry
    const w = new Writer()
    writeBox(w, createStsd(entry))
    const bytes = w.toBytes()
    // 8 header + 4 FullBox + 4 entry_count + (8 + 78) child = 102
    expect(bytes.length).toBe(102)
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint32(12, false)).toBe(1)
    expect(String.fromCharCode(...bytes.subarray(20, 24))).toBe('avc1')
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test "tests/unit/stsd"`

- [ ] **Step 3: Implement `src/boxes/stsd.ts`**

```ts
import { writeBox, type Box } from '@/boxes/box'

export function createStsd(sampleEntry: Box): Box {
  return {
    type: 'stsd',
    fullBox: { version: 0, flags: 0 },
    write: (w) => {
      w.u32(1) // entry_count
      writeBox(w, sampleEntry)
    },
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test "tests/unit/stsd"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/boxes/stsd.ts packages/core/tests/unit/stsd.test.ts
git commit -m "feat(core): add stsd box (wraps sample entry)"
```

---

## Task 18: `trak` + `moov` assembly

**Files:**

- Create: `packages/core/src/boxes/trak.ts`, `packages/core/src/boxes/moov.ts`
- Test: `packages/core/tests/unit/trak-moov.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'
import { createTrak } from '@/boxes/trak'
import { createMoov } from '@/boxes/moov'
import { createMvhd } from '@/boxes/mvhd'
import type { Box } from '@/boxes/box'

function stub(type: string, size = 8): Box {
  return { type, write: (w) => w.zeros(size - 8) }
}

describe('trak/moov', () => {
  it('trak nests tkhd and mdia', () => {
    const w = new Writer()
    writeBox(w, createTrak({ tkhd: stub('tkhd', 16), mdia: stub('mdia', 24) }))
    const bytes = w.toBytes()
    // 8 header + 16 tkhd + 24 mdia = 48
    expect(bytes.length).toBe(48)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trak')
  })

  it('moov nests mvhd and one or more traks', () => {
    const w = new Writer()
    writeBox(
      w,
      createMoov({
        mvhd: createMvhd({ timescale: 1000, duration: 0, nextTrackId: 2 }),
        traks: [stub('trak', 40)],
      })
    )
    const bytes = w.toBytes()
    // 8 header + 108 mvhd + 40 trak = 156
    expect(bytes.length).toBe(156)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('moov')
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test trak-moov`

- [ ] **Step 3: Implement `src/boxes/trak.ts`**

```ts
import { writeBox, type Box } from '@/boxes/box'

export function createTrak(children: { tkhd: Box; mdia: Box }): Box {
  return {
    type: 'trak',
    write: (w) => {
      writeBox(w, children.tkhd)
      writeBox(w, children.mdia)
    },
  }
}
```

- [ ] **Step 4: Implement `src/boxes/moov.ts`**

```ts
import { writeBox, type Box } from '@/boxes/box'

export function createMoov(children: { mvhd: Box; traks: Box[] }): Box {
  return {
    type: 'moov',
    write: (w) => {
      writeBox(w, children.mvhd)
      for (const t of children.traks) writeBox(w, t)
    },
  }
}
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm --filter mp4craft test trak-moov`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/boxes/trak.ts packages/core/src/boxes/moov.ts packages/core/tests/unit/trak-moov.test.ts
git commit -m "feat(core): add trak and moov container boxes"
```

---

## Task 19: `TimestampTracker`

**Files:**

- Create: `packages/core/src/tracks/timestamp-tracker.ts`
- Test: `packages/core/tests/unit/timestamp-tracker.test.ts`

Behavior per `firstTimestampBehavior`:

- `'strict'` — first sample must have timestamp 0; otherwise throw `StateError`.
- `'offset'` (default) — subtract the first timestamp from every subsequent one.
- `'permissive'` — pass timestamps through untouched (v1 does not yet emit edit lists for this mode; it's accepted literally).

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { TimestampTracker } from '@/tracks/timestamp-tracker'
import { StateError } from '@/types/errors'

describe('TimestampTracker', () => {
  it('offset mode subtracts the first timestamp', () => {
    const t = new TimestampTracker('offset')
    expect(t.adjust(1_000)).toBe(0)
    expect(t.adjust(4_000)).toBe(3_000)
    expect(t.adjust(7_000)).toBe(6_000)
  })

  it('strict mode throws on non-zero first timestamp', () => {
    const t = new TimestampTracker('strict')
    expect(() => t.adjust(1_000)).toThrowError(StateError)
  })

  it('strict mode passes zero-first through', () => {
    const t = new TimestampTracker('strict')
    expect(t.adjust(0)).toBe(0)
    expect(t.adjust(3_000)).toBe(3_000)
  })

  it('permissive mode does not rewrite', () => {
    const t = new TimestampTracker('permissive')
    expect(t.adjust(5_000)).toBe(5_000)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test timestamp-tracker`

- [ ] **Step 3: Implement `src/tracks/timestamp-tracker.ts`**

```ts
import { StateError } from '@/types/errors'

export type FirstTimestampBehavior = 'strict' | 'offset' | 'permissive'

export class TimestampTracker {
  private first: number | null = null

  constructor(private readonly mode: FirstTimestampBehavior) {}

  adjust(ts: number): number {
    if (this.first === null) {
      this.first = ts
      if (this.mode === 'strict' && ts !== 0) {
        throw new StateError(`firstTimestampBehavior='strict' but first timestamp was ${ts}; expected 0`)
      }
    }
    if (this.mode === 'offset') return ts - this.first
    return ts
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test timestamp-tracker`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tracks/timestamp-tracker.ts packages/core/tests/unit/timestamp-tracker.test.ts
git commit -m "feat(core): add TimestampTracker (strict/offset/permissive)"
```

---

## Task 20: Track base + Video/Audio tracks

**Files:**

- Create: `packages/core/src/tracks/track.ts`, `video-track.ts`, `audio-track.ts`
- Test: `packages/core/tests/unit/tracks.test.ts`

A `Track` holds a codec, a `SampleTable`, and a `TimestampTracker`. It produces a `trak` Box at finalize. It exposes `appendSample(info)` which records the sample into its sample table — the muxer separately writes the sample bytes into the target.

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { writeBox } from '@/boxes/box'
import { Writer } from '@/io/writer'
import { VideoTrack } from '@/tracks/video-track'
import { AudioTrack } from '@/tracks/audio-track'
import { AvcCodec } from '@/codecs/avc'
import { AacCodec } from '@/codecs/aac'

const avcc = new Uint8Array([
  0x01,
  0x42,
  0xc0,
  0x1e,
  0xff,
  0xe1,
  0x00,
  0x16, // sps len
  0x67,
  0x42,
  0xc0,
  0x1e,
  0xda,
  0x01,
  0x40,
  0x16,
  0xe8,
  0x40,
  0x00,
  0x00,
  0x00,
  0x40,
  0x00,
  0x00,
  0x0f,
  0xa0,
  0xf1,
  0x83,
  0x19,
  0x60,
  0x01,
  0x00,
  0x04, // 1 pps, pps len=4
  0x68,
  0xce,
  0x38,
  0x80,
])

describe('Track', () => {
  it('VideoTrack records samples and produces a valid trak', () => {
    const codec = new AvcCodec(avcc.buffer)
    const track = new VideoTrack({
      trackId: 1,
      codec,
      timescale: 90000,
      firstTimestampBehavior: 'offset',
    })
    track.appendSample({
      data: new Uint8Array(100),
      timestamp: 0,
      duration: 3000,
      isKeyFrame: true,
      chunkOffset: 48,
    })
    track.appendSample({
      data: new Uint8Array(80),
      timestamp: 33333,
      duration: 3000,
      isKeyFrame: false,
      chunkOffset: 148,
    })
    const { trak, durationInTimescale } = track.buildTrak({ movieTimescale: 1000 })
    expect(durationInTimescale).toBeGreaterThan(0)
    const w = new Writer()
    writeBox(w, trak)
    const bytes = w.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trak')
  })

  it('AudioTrack records samples and produces a valid trak (no stss)', () => {
    const codec = new AacCodec({
      description: new Uint8Array([0x12, 0x10]).buffer,
      channels: 2,
      sampleRate: 44100,
    })
    const track = new AudioTrack({
      trackId: 2,
      codec,
      timescale: 44100,
      firstTimestampBehavior: 'offset',
    })
    track.appendSample({
      data: new Uint8Array(500),
      timestamp: 0,
      duration: 1024,
      isKeyFrame: true,
      chunkOffset: 48,
    })
    const { trak } = track.buildTrak({ movieTimescale: 1000 })
    const w = new Writer()
    writeBox(w, trak)
    const bytes = w.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('trak')
    // audio tracks should NOT include stss
    expect(new TextDecoder('latin1').decode(bytes).indexOf('stss')).toBe(-1)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test "tests/unit/tracks"`

- [ ] **Step 3: Implement `src/tracks/track.ts`**

```ts
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
  timescale: number // media timescale (e.g., 90000 for video, 44100 for audio)
  firstTimestampBehavior: FirstTimestampBehavior
  language?: string
}

export type AppendedSample = {
  data: Uint8Array
  timestamp: number // microseconds (input)
  duration: number // microseconds (input)
  isKeyFrame: boolean
  chunkOffset: number
}

export abstract class Track {
  protected readonly samples: SampleTable
  protected readonly timestamps: TimestampTracker

  constructor(
    protected readonly opts: TrackOptions,
    isVideo: boolean
  ) {
    this.samples = new SampleTable({ isVideo })
    this.timestamps = new TimestampTracker(opts.firstTimestampBehavior)
  }

  appendSample(s: AppendedSample): SampleInfo {
    this.timestamps.adjust(s.timestamp)
    const durationInTimescale = Math.round((s.duration * this.opts.timescale) / 1_000_000)
    const info: SampleInfo = {
      size: s.data.length,
      duration: durationInTimescale,
      isKeyFrame: s.isKeyFrame,
      chunkOffset: s.chunkOffset,
    }
    this.samples.addSample(info)
    return info
  }

  abstract get handlerType(): 'vide' | 'soun'
  abstract get mediaHeader(): Box
  abstract get isVideo(): boolean

  buildTrak(ctx: { movieTimescale: number }): {
    trak: Box
    durationInTimescale: number
    durationInMovieTimescale: number
  } {
    const built = this.samples.build()
    const stsd = createStsd(this.opts.codec.createSampleEntry())
    const stts = createStts(built.sttsEntries)
    const stsc = createStsc(built.stscEntries)
    const stsz = createStsz({ sizes: built.sampleSizes })
    const stco = built.needs64Bit
      ? createCo64(built.chunkOffsets.map((n) => BigInt(n)))
      : createStco(built.chunkOffsets)
    const stss = this.isVideo && built.syncSamples ? createStss(built.syncSamples) : undefined
    const stbl = createStbl({ stsd, stts, stsc, stsz, stco, ...(stss ? { stss } : {}) })

    const mdhd = createMdhd({
      timescale: this.opts.timescale,
      duration: built.totalDuration,
      language: this.opts.language ?? 'und',
    })
    const hdlr = createHdlr({
      handlerType: this.handlerType,
      name: this.isVideo ? 'VideoHandler' : 'SoundHandler',
    })
    const minf = createMinf({ mediaHeader: this.mediaHeader, stbl })
    const mdia = createMdia({ mdhd, hdlr, minf })

    const durationInMovieTimescale = Math.round((built.totalDuration * ctx.movieTimescale) / this.opts.timescale)

    const tkhd = createTkhd({
      trackId: this.opts.trackId,
      duration: durationInMovieTimescale,
      width: this.isVideo ? this.videoWidth : 0,
      height: this.isVideo ? this.videoHeight : 0,
      isAudio: !this.isVideo,
    })
    const trak = createTrak({ tkhd, mdia })
    return { trak, durationInTimescale: built.totalDuration, durationInMovieTimescale }
  }

  protected get videoWidth(): number {
    return 0
  }
  protected get videoHeight(): number {
    return 0
  }
}
```

- [ ] **Step 4: Implement `src/tracks/video-track.ts`**

```ts
import { createVmhd } from '@/boxes/vmhd'
import type { Box } from '@/boxes/box'
import { Track } from '@/tracks/track'
import type { AvcCodec } from '@/codecs/avc'

export class VideoTrack extends Track {
  constructor(opts: ConstructorParameters<typeof Track>[0]) {
    super(opts, true)
  }

  get handlerType(): 'vide' {
    return 'vide'
  }
  get mediaHeader(): Box {
    return createVmhd()
  }
  get isVideo(): true {
    return true
  }

  protected override get videoWidth(): number {
    return (this.opts.codec as AvcCodec).width ?? 0
  }
  protected override get videoHeight(): number {
    return (this.opts.codec as AvcCodec).height ?? 0
  }
}
```

- [ ] **Step 5: Implement `src/tracks/audio-track.ts`**

```ts
import { createSmhd } from '@/boxes/smhd'
import type { Box } from '@/boxes/box'
import { Track } from '@/tracks/track'

export class AudioTrack extends Track {
  constructor(opts: ConstructorParameters<typeof Track>[0]) {
    super(opts, false)
  }

  get handlerType(): 'soun' {
    return 'soun'
  }
  get mediaHeader(): Box {
    return createSmhd()
  }
  get isVideo(): false {
    return false
  }
}
```

- [ ] **Step 6: Run — expect pass**

Run: `pnpm --filter mp4craft test "tests/unit/tracks"`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tracks packages/core/tests/unit/tracks.test.ts
git commit -m "feat(core): add Track base + VideoTrack + AudioTrack"
```

---

## Task 21: Target interface + `ArrayBufferTarget`

**Files:**

- Create: `packages/core/src/targets/target.ts`, `array-buffer-target.ts`
- Test: `packages/core/tests/unit/array-buffer-target.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'

describe('ArrayBufferTarget', () => {
  it('accepts sequential writes and exposes buffer after finish()', async () => {
    const t = new ArrayBufferTarget()
    await t.write(0, new Uint8Array([1, 2, 3]))
    await t.write(3, new Uint8Array([4, 5]))
    await t.finish()
    expect(new Uint8Array(t.buffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  it('supports seek and out-of-order writes (required for faststart later)', async () => {
    const t = new ArrayBufferTarget()
    await t.write(10, new Uint8Array([10, 11]))
    await t.write(0, new Uint8Array([0, 1]))
    await t.finish()
    const u = new Uint8Array(t.buffer)
    expect(u[0]).toBe(0)
    expect(u[1]).toBe(1)
    expect(u[10]).toBe(10)
    expect(u[11]).toBe(11)
    expect(u.length).toBe(12)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test array-buffer-target`

- [ ] **Step 3: Implement `src/targets/target.ts`**

```ts
export type Target = {
  write(offset: number, data: Uint8Array): void | Promise<void>
  seek?(offset: number): void | Promise<void>
  finish(): void | Promise<void>
}
```

- [ ] **Step 4: Implement `src/targets/array-buffer-target.ts`**

```ts
import type { Target } from '@/targets/target'

export class ArrayBufferTarget implements Target {
  private buf = new Uint8Array(1024)
  private size = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #buffer: ArrayBuffer | null = null

  private ensure(end: number): void {
    if (end <= this.buf.length) return
    let cap = this.buf.length || 1024
    while (cap < end) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.size))
    this.buf = next
  }

  write(offset: number, data: Uint8Array): void {
    const end = offset + data.length
    this.ensure(end)
    this.buf.set(data, offset)
    if (end > this.size) this.size = end
  }

  seek(_offset: number): void {
    // no-op: we use absolute offsets on each write()
  }

  finish(): void {
    const out = new Uint8Array(this.size)
    out.set(this.buf.subarray(0, this.size))
    this.#buffer = out.buffer
  }

  get buffer(): ArrayBuffer {
    if (!this.#buffer) throw new Error('ArrayBufferTarget.buffer accessed before finish()')
    return this.#buffer
  }
}
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm --filter mp4craft test array-buffer-target`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/targets packages/core/tests/unit/array-buffer-target.test.ts
git commit -m "feat(core): add Target contract and ArrayBufferTarget"
```

---

## Task 22: `StreamTarget`

**Files:**

- Create: `packages/core/src/targets/stream-target.ts`
- Test: `packages/core/tests/unit/stream-target.test.ts`

StreamTarget is non-seekable. It enforces sequential writes: if a write's offset doesn't match the running position, it throws `TargetError`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { StreamTarget } from '@/targets/stream-target'
import { TargetError } from '@/types/errors'

describe('StreamTarget', () => {
  it('emits chunks sequentially to the callback', async () => {
    const chunks: { offset: number; data: Uint8Array }[] = []
    const t = new StreamTarget({
      onData: (c) => {
        chunks.push({ offset: c.offset, data: new Uint8Array(c.data) })
      },
    })
    await t.write(0, new Uint8Array([1, 2]))
    await t.write(2, new Uint8Array([3, 4, 5]))
    await t.finish()
    expect(chunks).toEqual([
      { offset: 0, data: new Uint8Array([1, 2]) },
      { offset: 2, data: new Uint8Array([3, 4, 5]) },
    ])
  })

  it('throws TargetError on out-of-order writes (non-seekable)', async () => {
    const t = new StreamTarget({ onData: () => undefined })
    await t.write(0, new Uint8Array([1]))
    await expect(t.write(100, new Uint8Array([2]))).rejects.toThrow(TargetError)
  })

  it('awaits async onData promises (backpressure)', async () => {
    let resolved = 0
    const t = new StreamTarget({
      onData: async () => {
        await new Promise((r) => setTimeout(r, 5))
        resolved++
      },
    })
    await t.write(0, new Uint8Array([1]))
    expect(resolved).toBe(1)
    await t.finish()
  })

  it('calls onFinish once at the end', async () => {
    let finished = false
    const t = new StreamTarget({
      onData: () => undefined,
      onFinish: () => {
        finished = true
      },
    })
    await t.write(0, new Uint8Array([1]))
    await t.finish()
    expect(finished).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test stream-target`

- [ ] **Step 3: Implement `src/targets/stream-target.ts`**

```ts
import type { Target } from '@/targets/target'
import { TargetError } from '@/types/errors'

export type StreamTargetOptions = {
  onData: (chunk: { offset: number; data: Uint8Array }) => void | Promise<void>
  onFinish?: () => void | Promise<void>
}

export class StreamTarget implements Target {
  private pos = 0

  constructor(private readonly opts: StreamTargetOptions) {}

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (offset !== this.pos) {
      throw new TargetError(`StreamTarget is not seekable: expected offset ${this.pos}, got ${offset}`)
    }
    await this.opts.onData({ offset, data })
    this.pos += data.length
  }

  async finish(): Promise<void> {
    await this.opts.onFinish?.()
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test stream-target`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/targets/stream-target.ts packages/core/tests/unit/stream-target.test.ts
git commit -m "feat(core): add StreamTarget (non-seekable, backpressure-aware)"
```

---

## Task 23: State machine

**Files:**

- Create: `packages/core/src/muxer/state-machine.ts`
- Test: `packages/core/tests/unit/state-machine.test.ts`

States: `'idle' | 'writing' | 'finalized'`. Transitions:

- `idle → writing` on first `addXxx()`
- `writing → finalized` on `finalize()`
- Calls in wrong state throw `StateError`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { StateMachine } from '@/muxer/state-machine'
import { StateError } from '@/types/errors'

describe('StateMachine', () => {
  it('starts idle, moves to writing on first sample, then to finalized', () => {
    const s = new StateMachine()
    expect(s.state).toBe('idle')
    s.onSample()
    expect(s.state).toBe('writing')
    s.onFinalize()
    expect(s.state).toBe('finalized')
  })

  it('throws when adding a sample after finalize', () => {
    const s = new StateMachine()
    s.onSample()
    s.onFinalize()
    expect(() => s.onSample()).toThrow(StateError)
  })

  it('throws when finalizing twice', () => {
    const s = new StateMachine()
    s.onSample()
    s.onFinalize()
    expect(() => s.onFinalize()).toThrow(StateError)
  })

  it('throws when finalizing without any samples', () => {
    const s = new StateMachine()
    expect(() => s.onFinalize()).toThrow(StateError)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test state-machine`

- [ ] **Step 3: Implement `src/muxer/state-machine.ts`**

```ts
import { StateError } from '@/types/errors'

export type MuxerState = 'idle' | 'writing' | 'finalized'

export class StateMachine {
  #state: MuxerState = 'idle'

  get state(): MuxerState {
    return this.#state
  }

  onSample(): void {
    if (this.#state === 'finalized') {
      throw new StateError('Cannot add samples after finalize()')
    }
    if (this.#state === 'idle') this.#state = 'writing'
  }

  onFinalize(): void {
    if (this.#state === 'idle') {
      throw new StateError('Cannot finalize() before any samples were added')
    }
    if (this.#state === 'finalized') {
      throw new StateError('finalize() was already called')
    }
    this.#state = 'finalized'
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter mp4craft test state-machine`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/muxer/state-machine.ts packages/core/tests/unit/state-machine.test.ts
git commit -m "feat(core): add muxer state machine"
```

---

## Task 24: `MuxerOptions` + `Mp4Muxer` orchestrator (progressive mode)

**Files:**

- Create: `packages/core/src/types/config.ts`, `packages/core/src/types/chunk.ts`, `packages/core/src/muxer/mp4-muxer.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/unit/mp4-muxer.test.ts`

**Progressive mode algorithm:**

1. Construct: build codecs + tracks; write `ftyp` + `mdat` header (32-bit placeholder) to target; remember mdat header offset.
2. `addVideoChunk` / `addVideoSample` / `addAudioChunk` / `addAudioSample`: copy payload into target at running `mdat` position; register a `SampleInfo` on the track's sample table with the **absolute** chunk offset.
3. `finalize`: compute final mdat size; patch mdat 32-bit size in place (requires `target.seek`) OR if target is non-seekable, we buffer mdat header in the writer and rewrite it... **BUT** a non-seekable `StreamTarget` can't patch. Resolution: write the mdat header **last**, re-using the construction: write `ftyp` → collect samples into memory/stream as `mdat` body → at finalize, write the `moov`. But then `mdat` size isn't known until the end — tricky for streaming.
   **Simpler, correct approach for progressive mode on non-seekable targets:** skip `mdat` header bytes initially (fill with zeros), and at finalize:
   - If target supports `seek` → patch the mdat header in place.
   - Otherwise (pure StreamTarget) → we need a workaround. For MVP, require `seek` or fall back to buffering in memory. **v1 restriction:** progressive mode with `StreamTarget` requires either (a) `seek` support, or (b) caller tolerates an "in-memory spill" path (the muxer buffers `mdat` bytes in RAM, writes `ftyp + moov + mdat` at finalize — this is actually `'in-memory'` faststart). Since this plan explicitly excludes `'in-memory'`, we require the target to support `seek` for progressive mode OR use a 64-bit mdat header (`largesize=1`) that we can patch by rewriting the 8-byte size field. But rewriting still needs seek.
     **Pragmatic decision for Plan 1:** progressive mode requires `target.seek`. `ArrayBufferTarget` supports it. `StreamTarget` does not — so combining `StreamTarget` + `fastStart: false` throws `ConfigError` in Plan 1 and will be addressed by Plan 2's `'fragmented'` mode (which is the correct tool for non-seekable streams anyway).

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { Mp4Muxer } from '@/muxer/mp4-muxer'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { StreamTarget } from '@/targets/stream-target'
import { AvcCodec } from '@/codecs/avc'
import { AacCodec } from '@/codecs/aac'
import { ConfigError, StateError } from '@/types/errors'

const avcc = /* same fixture as Task 20 */ new Uint8Array([
  0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x16, 0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x40, 0x00,
  0x00, 0x00, 0x40, 0x00, 0x00, 0x0f, 0xa0, 0xf1, 0x83, 0x19, 0x60, 0x01, 0x00, 0x04, 0x68, 0xce, 0x38, 0x80,
])

describe('Mp4Muxer (progressive)', () => {
  it('throws ConfigError on StreamTarget + fastStart:false (requires seek)', () => {
    expect(
      () =>
        new Mp4Muxer({
          target: new StreamTarget({ onData: () => undefined }),
          fastStart: false,
          video: {
            codec: 'avc',
            width: 640,
            height: 480,
            description: avcc.buffer,
            timescale: 90000,
          },
        })
    ).toThrow(ConfigError)
  })

  it('produces a non-empty buffer for a 2-frame video-only file', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
      video: { codec: 'avc', width: 640, height: 480, description: avcc.buffer, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: new Uint8Array(200),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: new Uint8Array(150),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    await muxer.finalize()
    const bytes = new Uint8Array(target.buffer)
    expect(bytes.length).toBeGreaterThan(500)
    // starts with ftyp
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp')
    // contains mdat and moov somewhere
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('mdat')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeGreaterThan(0)
    expect(text.indexOf('moov')).toBeGreaterThan(text.indexOf('mdat')) // progressive: moov after mdat
  })

  it('blocks addSample after finalize', async () => {
    const muxer = new Mp4Muxer({
      target: new ArrayBufferTarget(),
      fastStart: false,
      video: { codec: 'avc', width: 640, height: 480, description: avcc.buffer, timescale: 90000 },
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

  it('supports audio-only files', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
      audio: {
        codec: 'aac',
        description: new Uint8Array([0x12, 0x10]).buffer,
        channels: 2,
        sampleRate: 44100,
        timescale: 44100,
      },
    })
    muxer.addAudioSample({
      data: new Uint8Array(500),
      timestamp: 0,
      duration: 23000,
      isKeyFrame: true,
    })
    await muxer.finalize()
    expect(new Uint8Array(target.buffer).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter mp4craft test "tests/unit/mp4-muxer"`

- [ ] **Step 3: Implement `src/types/config.ts`**

```ts
import type { Target } from '@/targets/target'
import type { FirstTimestampBehavior } from '@/tracks/timestamp-tracker'

export type VideoCodec = 'avc' // Plan 1 only supports AVC
export type AudioCodec = 'aac' // Plan 1 only supports AAC
export type FastStart = false // Plan 1 only supports progressive

export type VideoTrackConfig = {
  codec: VideoCodec
  width: number
  height: number
  description: ArrayBuffer | ArrayBufferView // avcC record (from VideoDecoderConfig)
  timescale?: number // default 90000
}

export type AudioTrackConfig = {
  codec: AudioCodec
  description: ArrayBuffer | ArrayBufferView // AudioSpecificConfig (from AudioDecoderConfig)
  channels: number
  sampleRate: number
  timescale?: number // default = sampleRate
}

export type MuxerOptions<T extends Target = Target> = {
  target: T
  video?: VideoTrackConfig
  audio?: AudioTrackConfig
  fastStart?: FastStart
  firstTimestampBehavior?: FirstTimestampBehavior
}
```

- [ ] **Step 4: Implement `src/types/chunk.ts`**

```ts
export type VideoSampleInput = {
  data: Uint8Array
  timestamp: number // microseconds
  duration: number // microseconds
  isKeyFrame: boolean
}

export type AudioSampleInput = {
  data: Uint8Array
  timestamp: number
  duration: number
  isKeyFrame?: boolean // audio: defaults to true
}
```

- [ ] **Step 5: Implement `src/muxer/mp4-muxer.ts`**

```ts
import { writeBox } from '@/boxes/box'
import { createFtyp } from '@/boxes/ftyp'
import { createMoov } from '@/boxes/moov'
import { createMvhd } from '@/boxes/mvhd'
import { MDAT_HEADER_SIZE_32, writeMdatHeader32 } from '@/boxes/mdat'
import { AvcCodec } from '@/codecs/avc'
import { AacCodec } from '@/codecs/aac'
import { Writer } from '@/io/writer'
import { StreamTarget } from '@/targets/stream-target'
import { ArrayBufferTarget } from '@/targets/array-buffer-target'
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
  private readonly state = new StateMachine()
  private readonly videoTrack?: VideoTrack
  private readonly audioTrack?: AudioTrack
  private readonly tracks: Track[] = []

  private mdatHeaderOffset = 0
  private mdatBodyStart = 0
  private mdatSize = 0
  private writeCursor = 0

  constructor(private readonly opts: MuxerOptions<T>) {
    this.target = opts.target
    validateOptions(opts)

    if (opts.video) {
      const codec = createVideoCodec(opts.video)
      this.videoTrack = new VideoTrack({
        trackId: 1,
        codec,
        timescale: opts.video.timescale ?? 90000,
        firstTimestampBehavior: opts.firstTimestampBehavior ?? 'offset',
      })
      this.tracks.push(this.videoTrack)
    }
    if (opts.audio) {
      const codec = createAudioCodec(opts.audio)
      this.audioTrack = new AudioTrack({
        trackId: this.videoTrack ? 2 : 1,
        codec,
        timescale: opts.audio.timescale ?? opts.audio.sampleRate,
        firstTimestampBehavior: opts.firstTimestampBehavior ?? 'offset',
      })
      this.tracks.push(this.audioTrack)
    }

    this.writeHeaderAndMdatPlaceholder()
  }

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

  addVideoSample(s: VideoSampleInput): void {
    if (!this.videoTrack) throw new ConfigError('No video track configured')
    this.state.onSample()
    const offset = this.writeCursor
    this.target.write(offset, s.data)
    this.writeCursor += s.data.length
    this.mdatSize += s.data.length
    this.videoTrack.appendSample({ ...s, chunkOffset: offset })
  }

  addAudioSample(s: AudioSampleInput): void {
    if (!this.audioTrack) throw new ConfigError('No audio track configured')
    this.state.onSample()
    const offset = this.writeCursor
    this.target.write(offset, s.data)
    this.writeCursor += s.data.length
    this.mdatSize += s.data.length
    this.audioTrack.appendSample({ ...s, isKeyFrame: s.isKeyFrame ?? true, chunkOffset: offset })
  }

  async finalize(): Promise<void> {
    this.state.onFinalize()

    // 1. Patch mdat header with the final size (includes header itself).
    const mdatTotal = MDAT_HEADER_SIZE_32 + this.mdatSize
    if (mdatTotal > 0xffffffff) {
      throw new ConfigError('Progressive mdat > 4GiB not supported in Plan 1 (use fragmented mode in Plan 2)')
    }
    const headerW = new Writer()
    writeMdatHeader32(headerW, mdatTotal)
    if (!this.target.seek) {
      throw new ConfigError('Target does not support seek — required for progressive mode')
    }
    await this.target.seek(this.mdatHeaderOffset)
    await this.target.write(this.mdatHeaderOffset, headerW.toBytes())

    // 2. Build moov and write it after mdat.
    const traks = this.tracks.map((t) => t.buildTrak({ movieTimescale: MOVIE_TIMESCALE }))
    const movieDuration = Math.max(0, ...traks.map((r) => r.durationInMovieTimescale))
    const mvhd = createMvhd({
      timescale: MOVIE_TIMESCALE,
      duration: movieDuration,
      nextTrackId: this.tracks.length + 1,
    })
    const moov = createMoov({ mvhd, traks: traks.map((r) => r.trak) })
    const moovW = new Writer()
    writeBox(moovW, moov)
    await this.target.write(this.writeCursor, moovW.toBytes())
    this.writeCursor += moovW.length

    await this.target.finish()
  }

  private writeHeaderAndMdatPlaceholder(): void {
    // ftyp
    const ftyp = createFtyp({
      majorBrand: 'isom',
      minorVersion: 512,
      compatibleBrands: ['isom', 'iso2', 'avc1', 'mp41'],
    })
    const w = new Writer()
    writeBox(w, ftyp)
    this.target.write(0, w.toBytes())
    this.writeCursor = w.length
    this.mdatHeaderOffset = this.writeCursor

    // mdat 32-bit header placeholder (size patched in finalize)
    const mdatW = new Writer()
    writeMdatHeader32(mdatW, 0)
    this.target.write(this.writeCursor, mdatW.toBytes())
    this.writeCursor += mdatW.length
    this.mdatBodyStart = this.writeCursor
  }
}

function createVideoCodec(cfg: VideoTrackConfig) {
  if (cfg.codec !== 'avc') throw new ConfigError(`Unsupported video codec: ${cfg.codec}`)
  return new AvcCodec(toBuffer(cfg.description))
}
function createAudioCodec(cfg: AudioTrackConfig) {
  if (cfg.codec !== 'aac') throw new ConfigError(`Unsupported audio codec: ${cfg.codec}`)
  return new AacCodec({
    description: toBuffer(cfg.description),
    channels: cfg.channels,
    sampleRate: cfg.sampleRate,
  })
}
function toBuffer(d: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (d instanceof ArrayBuffer) return d
  return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)
}

function validateOptions(opts: MuxerOptions): void {
  if (!opts.video && !opts.audio) {
    throw new ConfigError('Must configure at least one of `video` or `audio`')
  }
  // StreamTarget has no seek — progressive mode requires seek.
  if (opts.target instanceof StreamTarget && (opts.fastStart ?? false) === false) {
    throw new ConfigError(
      'Progressive mode requires a seekable target. Use ArrayBufferTarget, or switch to fragmented mode (Plan 2).'
    )
  }
  // Plan 1 only implements progressive — reject other modes
  if (opts.fastStart !== false && opts.fastStart !== undefined) {
    throw new ConfigError(`fastStart=${String(opts.fastStart)} is not implemented in Plan 1`)
  }
  void ArrayBufferTarget // keep import alive for type narrowing
}
```

- [ ] **Step 6: Update `src/index.ts`** to export the public API

```ts
export { Mp4Muxer } from '@/muxer/mp4-muxer'
export { ArrayBufferTarget } from '@/targets/array-buffer-target'
export { StreamTarget, type StreamTargetOptions } from '@/targets/stream-target'
export { Mp4CraftError, ConfigError, StateError, CodecError, TargetError } from '@/types/errors'
export type {
  MuxerOptions,
  VideoTrackConfig,
  AudioTrackConfig,
  VideoCodec,
  AudioCodec,
  FastStart,
} from '@/types/config'
export type { VideoSampleInput, AudioSampleInput } from '@/types/chunk'
export type { Target } from '@/targets/target'
export type { FirstTimestampBehavior } from '@/tracks/timestamp-tracker'
```

- [ ] **Step 7: Run — expect pass**

Run: `pnpm --filter mp4craft test mp4-muxer`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/muxer packages/core/src/types/config.ts packages/core/src/types/chunk.ts packages/core/src/index.ts packages/core/tests/unit/mp4-muxer.test.ts
git commit -m "feat(core): add Mp4Muxer orchestrator (progressive AVC+AAC)"
```

---

## Task 25: Integration test — validate output with MP4Box.js

**Files:**

- Create: `packages/core/tests/integration/mp4box-validation.test.ts`
- Create: `packages/core/tests/fixtures/avc-key-frame.bin`, `packages/core/tests/fixtures/avc-delta-frame.bin`

Fixtures are pre-encoded H.264 NAL units plus a matching `avcC` record. We generate them once with ffmpeg + a small Node script, commit the `.bin` files, and never regenerate unless the fixture intentionally changes.

- [ ] **Step 1: Create fixtures**

Write a one-off Node script at `packages/core/tests/fixtures/build-fixtures.mjs`:

```js
// Run once; outputs avc-key-frame.bin, avc-delta-frame.bin, and avcc.bin.
// Requires ffmpeg installed on PATH.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const h264 = resolve(here, 'out.h264')

execSync(
  `ffmpeg -y -f lavfi -i testsrc=duration=0.1:size=320x240:rate=30 ` +
    `-c:v libx264 -profile:v baseline -g 1 -bf 0 -pix_fmt yuv420p ` +
    `-f h264 ${h264}`,
  { stdio: 'inherit' }
)

const bytes = readFileSync(h264)

// Find all Annex-B NAL-unit boundaries.
const nalus = []
for (let i = 0; i + 3 < bytes.length; i++) {
  if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
    nalus.push(i + 4)
  }
}
nalus.push(bytes.length)
const units = []
for (let i = 0; i < nalus.length - 1; i++) units.push(bytes.subarray(nalus[i], nalus[i + 1] - 4))
// Remove trailing zero-run from boundary detection
units[units.length - 1] = units[units.length - 1]

// Classify: NAL type is the low 5 bits of the first byte. 7=SPS, 8=PPS, 5=IDR, 1=non-IDR.
const sps = units.find((u) => (u[0] & 0x1f) === 7)
const pps = units.find((u) => (u[0] & 0x1f) === 8)
const idr = units.find((u) => (u[0] & 0x1f) === 5)
const p = units.find((u) => (u[0] & 0x1f) === 1)
if (!sps || !pps || !idr || !p) throw new Error('fixture missing SPS/PPS/IDR/P')

// Build avcC: configVersion(1) + profile(sps[1]) + profile_compat(sps[2]) + level(sps[3])
//          + 0xff (reserved + lengthSizeMinusOne=3)
//          + 0xe1 (reserved + numSPS=1) + u16 spsLen + sps...
//          + u8 numPPS=1 + u16 ppsLen + pps...
const avcc = Buffer.concat([
  Buffer.from([0x01, sps[1], sps[2], sps[3], 0xff, 0xe1]),
  Buffer.from([(sps.length >> 8) & 0xff, sps.length & 0xff]),
  sps,
  Buffer.from([0x01, (pps.length >> 8) & 0xff, pps.length & 0xff]),
  pps,
])

// Two "frames" for the muxer: each is Annex-B bytes of one picture (IDR, then P).
// Include SPS+PPS in the IDR frame (common practice; ok for muxer input since we'll
// convert Annex-B → length-prefixed anyway).
const keyFrame = Buffer.concat([prefix(sps), prefix(pps), prefix(idr)])
const deltaFrame = prefix(p)

function prefix(u) {
  return Buffer.concat([Buffer.from([0, 0, 0, 1]), u])
}

writeFileSync(resolve(here, 'avc-key-frame.bin'), keyFrame)
writeFileSync(resolve(here, 'avc-delta-frame.bin'), deltaFrame)
writeFileSync(resolve(here, 'avcc.bin'), avcc)
```

Run once: `node packages/core/tests/fixtures/build-fixtures.mjs`
Commit the three `.bin` files; the script is informational (kept for reproducibility).

- [ ] **Step 2: Write the integration test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import MP4Box from 'mp4box'
import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'

const keyFrame = readFileSync(resolve(__dirname, '../fixtures/avc-key-frame.bin'))
const deltaFrame = readFileSync(resolve(__dirname, '../fixtures/avc-delta-frame.bin'))

// Construct a minimal avcC record from the SPS/PPS inside keyFrame. For Plan 1 we use
// a hand-crafted avcC that matches the fixture's SPS (documented in the fixture script).
const avcc = readFileSync(resolve(__dirname, '../fixtures/avcc.bin'))

describe('integration: MP4Box.js validates mp4craft output', () => {
  it('parses a progressive AVC+AAC file back without errors', async () => {
    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
      video: { codec: 'avc', width: 320, height: 240, description: avcc.buffer, timescale: 90000 },
    })

    // convert Annex-B NAL-unit bytes → length-prefixed, as MP4 requires
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrame),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(deltaFrame),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })

    await muxer.finalize()

    const file = MP4Box.createFile()
    let info: unknown = null
    file.onReady = (i: unknown) => {
      info = i
    }
    file.onError = (e: string) => {
      throw new Error(`mp4box parse error: ${e}`)
    }
    const ab = target.buffer as ArrayBuffer & { fileStart: number }
    ab.fileStart = 0
    file.appendBuffer(ab)
    file.flush()
    expect(info).not.toBeNull()
    const asAny = info as { tracks: { codec: string; nb_samples: number }[] }
    expect(asAny.tracks.length).toBe(1)
    expect(asAny.tracks[0]!.codec).toMatch(/^avc1/)
    expect(asAny.tracks[0]!.nb_samples).toBe(2)
  })
})
```

- [ ] **Step 3: Run — expect pass**

Run: `pnpm --filter mp4craft test mp4box-validation`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/integration packages/core/tests/fixtures
git commit -m "test(core): integration test — validate output with MP4Box.js"
```

---

## Task 26: Golden-file regression test

**Files:**

- Create: `packages/core/tests/golden/avc-2frame.mp4` (produced once by the integration test and committed)
- Create: `packages/core/tests/golden/golden.test.ts`

Strategy: run the same muxer scenario; compare byte-for-byte with the checked-in golden file. Any accidental change in layout, ordering, or byte emission fails the test.

- [ ] **Step 1: Generate the golden file once**

Add a one-shot script: `packages/core/tests/golden/build-golden.mjs`

```js
// Run once to produce avc-2frame.mp4 from the same fixture used in integration test.
// Checked in afterwards; this script is informational.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// We import from the source tree directly — this script runs in Node via tsx or after a build.
import { Mp4Muxer, ArrayBufferTarget } from '../../src/index.ts'
import { annexBToLengthPrefixed } from '../../src/io/nalu.ts'

const here = dirname(fileURLToPath(import.meta.url))
const keyFrame = readFileSync(resolve(here, '../fixtures/avc-key-frame.bin'))
const deltaFrame = readFileSync(resolve(here, '../fixtures/avc-delta-frame.bin'))
const avcc = readFileSync(resolve(here, '../fixtures/avcc.bin'))

const target = new ArrayBufferTarget()
const muxer = new Mp4Muxer({
  target,
  fastStart: false,
  video: { codec: 'avc', width: 320, height: 240, description: avcc.buffer, timescale: 90000 },
})
muxer.addVideoSample({
  data: annexBToLengthPrefixed(keyFrame),
  timestamp: 0,
  duration: 33_333,
  isKeyFrame: true,
})
muxer.addVideoSample({
  data: annexBToLengthPrefixed(deltaFrame),
  timestamp: 33_333,
  duration: 33_333,
  isKeyFrame: false,
})
await muxer.finalize()
writeFileSync(resolve(here, 'avc-2frame.mp4'), Buffer.from(target.buffer))
```

Run via tsx (no separate alias needed): `pnpm dlx tsx packages/core/tests/golden/build-golden.mjs`
Commit `avc-2frame.mp4`.

- [ ] **Step 2: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Mp4Muxer, ArrayBufferTarget } from '@/index'
import { annexBToLengthPrefixed } from '@/io/nalu'

describe('golden: avc-2frame.mp4', () => {
  it('byte-for-byte matches the checked-in golden file', async () => {
    const keyFrame = readFileSync(resolve(__dirname, '../fixtures/avc-key-frame.bin'))
    const deltaFrame = readFileSync(resolve(__dirname, '../fixtures/avc-delta-frame.bin'))
    const avcc = readFileSync(resolve(__dirname, '../fixtures/avcc.bin'))
    const golden = readFileSync(resolve(__dirname, 'avc-2frame.mp4'))

    const target = new ArrayBufferTarget()
    const muxer = new Mp4Muxer({
      target,
      fastStart: false,
      video: { codec: 'avc', width: 320, height: 240, description: avcc.buffer, timescale: 90000 },
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(keyFrame),
      timestamp: 0,
      duration: 33_333,
      isKeyFrame: true,
    })
    muxer.addVideoSample({
      data: annexBToLengthPrefixed(deltaFrame),
      timestamp: 33_333,
      duration: 33_333,
      isKeyFrame: false,
    })
    await muxer.finalize()

    const produced = Buffer.from(target.buffer)
    expect(produced.length).toBe(golden.length)
    expect(produced.equals(golden)).toBe(true)
  })
})
```

- [ ] **Step 3: Run — expect pass**

Run: `pnpm --filter mp4craft test golden`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/golden
git commit -m "test(core): golden-file regression for avc-2frame.mp4"
```

---

## Task 27: Scaffold `packages/playground`

**Files:**

- Create: `packages/playground/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`

Minimal scaffold only. Scenarios come in Plan 3.

- [ ] **Step 1: Create `packages/playground/package.json`**

```jsonc
{
  "name": "@mp4craft/playground",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
  },
  "dependencies": {
    "mp4craft": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
  },
}
```

- [ ] **Step 2: Create `packages/playground/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: { port: 5173 },
})
```

- [ ] **Step 3: Create `packages/playground/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vite/client", "@types/react", "@types/react-dom", "@types/dom-webcodecs"],
  },
  "include": ["src", "vite.config.ts"],
}
```

- [ ] **Step 4: Create `packages/playground/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mp4craft playground</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `packages/playground/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import '@/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 6: Create `packages/playground/src/App.tsx`**

```tsx
import { Mp4Muxer, ArrayBufferTarget } from 'mp4craft'

export function App() {
  return (
    <main>
      <h1>mp4craft playground</h1>
      <p>
        Library loaded: <code>{typeof Mp4Muxer === 'function' ? 'ok' : 'fail'}</code>
      </p>
      <p>
        <code>ArrayBufferTarget</code>: <code>{typeof ArrayBufferTarget === 'function' ? 'ok' : 'fail'}</code>
      </p>
      <p>Scenarios come in Plan 3.</p>
    </main>
  )
}
```

- [ ] **Step 7: Create `packages/playground/src/styles.css`**

```css
:root {
  --fg: #1a1a1a;
  --bg: #fafafa;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
}
body {
  font-family: system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
}
main {
  max-width: 720px;
  margin: 2rem auto;
  padding: 0 1rem;
}
code {
  font-family: var(--mono);
}
```

- [ ] **Step 8: Install + verify dev server boots**

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:5173`. Expected: both lines show "ok". Kill the server.

- [ ] **Step 9: Commit**

```bash
git add packages/playground pnpm-lock.yaml
git commit -m "chore: scaffold React+Vite playground"
```

---

## Task 28: CI workflow + README + final typecheck/build/lint

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `packages/core/README.md`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [master, main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Create root `README.md`**

````markdown
# mp4craft

A zero-dependency TypeScript MP4 muxer for browsers and Node.js.

> **Status:** Plan 1 MVP. Supports AVC (H.264) video + AAC audio, progressive MP4, ArrayBufferTarget, StreamTarget. More codecs and container modes in Plan 2.

## Install

```bash
pnpm add mp4craft
```
````

## Usage

```ts
import { Mp4Muxer, ArrayBufferTarget } from 'mp4craft'

const muxer = new Mp4Muxer({
  target: new ArrayBufferTarget(),
  fastStart: false,
  video: {
    codec: 'avc',
    width: 1920,
    height: 1080,
    description: avccBytes, // from VideoEncoder's output callback metadata.decoderConfig.description
  },
})

muxer.addVideoChunk(encodedVideoChunk, metadata)
await muxer.finalize()
const mp4 = muxer.target.buffer
```

## Development

```bash
pnpm install
pnpm test           # run core unit + integration + golden tests
pnpm dev            # run the playground at http://localhost:5173
pnpm build          # build the core package to packages/core/dist
```

See `docs/superpowers/specs/2026-04-17-mp4craft-design.md` for the full design.

````

- [ ] **Step 3: Create `packages/core/README.md`**

```markdown
# mp4craft

Zero-dependency TypeScript MP4 muxer for browsers and Node.js.

See the [monorepo README](../../README.md) for full docs and status.
````

- [ ] **Step 4: Run full verification locally**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Expected: all pass. If any fails, fix the underlying issue and commit the fix as a separate step before proceeding.

- [ ] **Step 5: Commit**

```bash
git add .github README.md packages/core/README.md
git commit -m "docs+ci: add README and GitHub Actions CI"
```

- [ ] **Step 6: Verify final state**

```bash
git log --oneline
```

Expected: ~28 commits, one per task. Tree builds, tests pass, CI config present, playground boots.

---

## Verification Before Declaring Plan 1 Complete

Run these and confirm each passes before marking this plan done:

- [ ] `pnpm install --frozen-lockfile` — succeeds
- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm format:check` — 0 diffs
- [ ] `pnpm typecheck` — 0 errors
- [ ] `pnpm test` — all tests pass (unit + integration + golden)
- [ ] `pnpm build` — produces `packages/core/dist/index.mjs` and `index.d.mts`
- [ ] `pnpm dev` — playground loads at `http://localhost:5173`, "ok" text renders
- [ ] Manual: open the golden `.mp4` file in VLC or QuickTime — it plays (2 frames of testsrc pattern)

Only when every checkbox is green is Plan 1 done. Plan 2 (additional modes + codecs) and Plan 3 (playground scenarios) follow.

/*
 * Minimal MP4 parser that extracts the samples required by the FileReplay
 * scenario. The parser walks top-level boxes, finds `moov` and `mdat`, then
 * within each `trak` reads the media description plus the sample tables needed
 * to reconstruct absolute sample byte ranges on disk. Sample bytes are sliced
 * verbatim from the input buffer and returned alongside presentation
 * timestamps, durations, and keyframe flags.
 *
 * The parser is intentionally narrow in scope: it accepts files carrying one
 * AVC video track and one AAC audio track, or a single track of either kind,
 * and throws a descriptive {@link Error} for every unsupported configuration
 * or missing required box. Composition time offsets (`ctts`) are not honoured,
 * so presentation timestamps equal decoding timestamps. This defers B-frame
 * PTS support, which the FileReplay scenario does not require because every
 * file produced by the playground scenarios is either AVC Baseline (no B
 * frames) or uses `stts` deltas that already match the intended PTS.
 *
 * @see ISO/IEC 14496-12 §4.2 for the box structure.
 * @see ISO/IEC 14496-12 §8 for the `moov`, `trak`, `mdia`, and `stbl` layout.
 * @see ISO/IEC 14496-15 §5.3.3 for AVCDecoderConfigurationRecord.
 * @see ISO/IEC 14496-1 §7.2.6 for the ES_Descriptor chain inside `esds`.
 * @see ISO/IEC 14496-3 §1.6.2.1 for AudioSpecificConfig.
 */

/**
 * One decoded sample of a parsed MP4 track. Sample bytes are a fresh
 * `Uint8Array` slice owning its own `ArrayBuffer` so downstream consumers can
 * keep references without pinning the entire source file.
 */
export type ParsedSample = {
  /**
   * Encoded sample bytes in the codec's native bitstream format. For AVC this
   * is the length-prefixed NAL unit stream exactly as stored inside `mdat`;
   * for AAC this is a raw access unit.
   */
  readonly data: Uint8Array<ArrayBuffer>
  /** Presentation timestamp of the sample in microseconds. */
  readonly timestampMicroseconds: number
  /** Sample duration in microseconds, derived from the `stts` delta entry. */
  readonly durationMicroseconds: number
  /**
   * Whether the sample is a sync sample. For video this reflects the `stss`
   * table; for audio every sample is treated as a sync sample because the AAC
   * bitstream carries no inter-frame dependencies.
   */
  readonly isKeyFrame: boolean
}

/**
 * Parsed video track. Carries the fields {@link Mp4Muxer} needs to build an
 * AVC video track config plus the ordered sample list.
 */
export type ParsedVideoTrack = {
  readonly kind: 'video'
  readonly codec: 'avc'
  readonly width: number
  readonly height: number
  /**
   * AVCDecoderConfigurationRecord bytes extracted verbatim from the child
   * `avcC` box. The payload is the eight bytes following the box header.
   */
  readonly avcDecoderConfigRecord: Uint8Array<ArrayBuffer>
  /** Media timescale ticks per second from the track's `mdhd`. */
  readonly timescale: number
  readonly samples: readonly ParsedSample[]
}

/**
 * Parsed audio track. Carries the fields {@link Mp4Muxer} needs to build an
 * AAC audio track config plus the ordered sample list.
 */
export type ParsedAudioTrack = {
  readonly kind: 'audio'
  readonly codec: 'aac'
  readonly channels: number
  readonly sampleRate: number
  /**
   * AudioSpecificConfig bytes extracted from the DecoderSpecificInfo
   * descriptor inside the `esds` ES_Descriptor chain.
   */
  readonly audioSpecificConfig: Uint8Array<ArrayBuffer>
  /** Media timescale ticks per second from the track's `mdhd`. */
  readonly timescale: number
  readonly samples: readonly ParsedSample[]
}

/** Discriminated union of every parsed track kind the FileReplay scenario supports. */
export type ParsedMp4Track = ParsedVideoTrack | ParsedAudioTrack

/**
 * Top-level result returned by {@link parseMp4Bytes}. Either track may be
 * `null` when the file carries only the other kind.
 */
export type ParsedMp4 = {
  readonly videoTrack: ParsedVideoTrack | null
  readonly audioTrack: ParsedAudioTrack | null
}

/** Microseconds per second, used when scaling ticks into the muxer's time base. */
const MICROSECONDS_PER_SECOND = 1_000_000

/** Length of the 8-byte box header: four-byte size followed by four-byte type. */
const BASE_BOX_HEADER_LENGTH = 8

/** Length of the 64-bit size extension added when the 32-bit size field is 1. */
const LARGE_SIZE_EXTENSION_LENGTH = 8

/**
 * Location of a box inside the source buffer. `payloadOffset` skips past the
 * size and type fields and any 64-bit size extension.
 */
type BoxSpan = {
  readonly type: string
  readonly payloadOffset: number
  readonly payloadLength: number
  /** Absolute byte offset of the first byte following the box. */
  readonly endOffset: number
}

/**
 * Reads the ISO/IEC 14496-12 §4.2 box header at the supplied offset and
 * returns the containing {@link BoxSpan}. Supports both 32-bit and 64-bit
 * size fields and the sentinel size `0` (extends to end of file).
 *
 * @param sourceBytes - The full source file bytes.
 * @param boxHeaderOffset - Absolute offset of the box's size field.
 * @returns The decoded {@link BoxSpan}.
 */
function readBoxHeader(sourceBytes: Uint8Array<ArrayBuffer>, boxHeaderOffset: number): BoxSpan {
  if (boxHeaderOffset + BASE_BOX_HEADER_LENGTH > sourceBytes.byteLength) {
    throw new Error('MP4 is truncated: box header extends past end of file.')
  }
  const headerDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + boxHeaderOffset,
    BASE_BOX_HEADER_LENGTH
  )
  const declaredSize = headerDataView.getUint32(0)
  const typeFourCharacterCode = readAsciiFourCharacterCode(sourceBytes, boxHeaderOffset + 4)
  const headerEndOffset = boxHeaderOffset + BASE_BOX_HEADER_LENGTH

  const resolveSpanFromTotalSize = (totalSize: number, payloadStart: number): BoxSpan => {
    const boxEndOffset = boxHeaderOffset + totalSize
    if (boxEndOffset > sourceBytes.byteLength) {
      throw new Error(
        `MP4 is truncated: ${typeFourCharacterCode} box at offset ${boxHeaderOffset} claims ${totalSize} bytes but file ends at ${sourceBytes.byteLength}.`
      )
    }
    return {
      type: typeFourCharacterCode,
      payloadOffset: payloadStart,
      payloadLength: boxEndOffset - payloadStart,
      endOffset: boxEndOffset,
    }
  }

  if (declaredSize === 1) {
    if (headerEndOffset + LARGE_SIZE_EXTENSION_LENGTH > sourceBytes.byteLength) {
      throw new Error('MP4 is truncated: large-size extension missing.')
    }
    const largeSizeDataView = new DataView(
      sourceBytes.buffer,
      sourceBytes.byteOffset + headerEndOffset,
      LARGE_SIZE_EXTENSION_LENGTH
    )
    const largeSizeHighWord = largeSizeDataView.getUint32(0)
    const largeSizeLowWord = largeSizeDataView.getUint32(4)
    /*
     * JavaScript numbers represent integers exactly up to 2^53 - 1, which
     * comfortably covers every realistic MP4 box size. A file above that
     * threshold is declined explicitly rather than silently producing lossy
     * arithmetic.
     */
    const MAX_SAFE_HIGH_WORD = 0x1f_ff_ff
    if (largeSizeHighWord > MAX_SAFE_HIGH_WORD) {
      throw new Error('MP4 box is larger than the browser-safe integer range.')
    }
    const largeSize = largeSizeHighWord * 0x1_00_00_00_00 + largeSizeLowWord
    return resolveSpanFromTotalSize(largeSize, headerEndOffset + LARGE_SIZE_EXTENSION_LENGTH)
  }

  if (declaredSize === 0) {
    return {
      type: typeFourCharacterCode,
      payloadOffset: headerEndOffset,
      payloadLength: sourceBytes.byteLength - headerEndOffset,
      endOffset: sourceBytes.byteLength,
    }
  }

  if (declaredSize < BASE_BOX_HEADER_LENGTH) {
    throw new Error(
      `MP4 is malformed: ${typeFourCharacterCode} box at offset ${boxHeaderOffset} declares size ${declaredSize} which is smaller than the 8-byte header.`
    )
  }

  return resolveSpanFromTotalSize(declaredSize, headerEndOffset)
}

/**
 * Reads four ASCII bytes starting at the supplied offset and returns them as
 * a four-character string. Used for decoding the box type fourcc.
 *
 * @param sourceBytes - The full source file bytes.
 * @param asciiOffset - Absolute offset of the first ASCII byte.
 * @returns The decoded four-character string.
 */
function readAsciiFourCharacterCode(sourceBytes: Uint8Array<ArrayBuffer>, asciiOffset: number): string {
  return String.fromCharCode(
    sourceBytes[asciiOffset] ?? 0,
    sourceBytes[asciiOffset + 1] ?? 0,
    sourceBytes[asciiOffset + 2] ?? 0,
    sourceBytes[asciiOffset + 3] ?? 0
  )
}

/**
 * Iterates every child box inside the supplied container payload. Used to
 * walk `moov`, `trak`, `mdia`, `minf`, `stbl`, `stsd`, and other container
 * boxes defined by ISO/IEC 14496-12 §4.2.
 *
 * @param sourceBytes - The full source file bytes.
 * @param containerPayloadOffset - Absolute offset of the first child box.
 * @param containerPayloadLength - Length of the container payload in bytes.
 * @returns An array of {@link BoxSpan} entries in document order.
 */
function readContainerChildBoxes(
  sourceBytes: Uint8Array<ArrayBuffer>,
  containerPayloadOffset: number,
  containerPayloadLength: number
): BoxSpan[] {
  const childBoxes: BoxSpan[] = []
  const containerEndOffset = containerPayloadOffset + containerPayloadLength
  let currentOffset = containerPayloadOffset
  while (currentOffset < containerEndOffset) {
    const childBox = readBoxHeader(sourceBytes, currentOffset)
    childBoxes.push(childBox)
    currentOffset = childBox.endOffset
  }
  return childBoxes
}

/**
 * Locates the first child box of the supplied type. Returns `undefined` when
 * no matching child exists so callers can decide whether to throw.
 *
 * @param childBoxes - Children produced by {@link readContainerChildBoxes}.
 * @param requestedType - Four-character type code to locate.
 * @returns The first matching {@link BoxSpan}, or `undefined` when absent.
 */
function findChildBox(childBoxes: readonly BoxSpan[], requestedType: string): BoxSpan | undefined {
  return childBoxes.find((candidateBox) => candidateBox.type === requestedType)
}

/**
 * Looks up a required child box by type and throws a descriptive error when
 * the child is missing. Used to surface unsupported files early.
 *
 * @param childBoxes - Children produced by {@link readContainerChildBoxes}.
 * @param requestedType - Four-character type code to locate.
 * @param containerLabel - Label naming the parent for inclusion in the error.
 * @returns The located {@link BoxSpan}.
 */
function requireChildBox(childBoxes: readonly BoxSpan[], requestedType: string, containerLabel: string): BoxSpan {
  const matchingBox = findChildBox(childBoxes, requestedType)
  if (matchingBox === undefined) {
    throw new Error(`MP4 is missing required '${requestedType}' box inside ${containerLabel}.`)
  }
  return matchingBox
}

/**
 * Raw sample-table payloads pulled out of a single `trak`. The data in this
 * record is not yet aligned against chunk offsets; {@link expandSampleTable}
 * consumes these fields to produce the final {@link ParsedSample} list.
 */
type SampleTablePayloads = {
  /** Sample sizes, one entry per sample. */
  readonly sampleSizesInBytes: readonly number[]
  /** Decoding-time delta entries as `(sampleCount, sampleDelta)` pairs. */
  readonly decodingTimeDeltaEntries: readonly { count: number; delta: number }[]
  /** Sync sample indices, 1-based. `null` means every sample is a sync sample. */
  readonly syncSampleIndices: readonly number[] | null
  /** Chunk file offsets in file bytes. */
  readonly chunkFileOffsets: readonly number[]
  /** Sample-to-chunk run entries. */
  readonly sampleToChunkRunEntries: readonly {
    firstChunk: number
    samplesPerChunk: number
  }[]
}

/**
 * Parses the `stsz` (sample size) box and returns the per-sample size list.
 * Supports both the uniform-size form (`sampleSize !== 0`) and the per-sample
 * table form.
 *
 * @param sourceBytes - The full source file bytes.
 * @param stszBox - The `stsz` box span.
 * @returns An array of sample sizes in bytes.
 *
 * @see ISO/IEC 14496-12 §8.7.3 for the `stsz` layout.
 */
function parseSampleSizes(sourceBytes: Uint8Array<ArrayBuffer>, stszBox: BoxSpan): number[] {
  const stszDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + stszBox.payloadOffset,
    stszBox.payloadLength
  )
  /* Skip the 4-byte FullBox version+flags header. */
  const uniformSampleSize = stszDataView.getUint32(4)
  const sampleCount = stszDataView.getUint32(8)
  const sampleSizeList: number[] = []
  if (uniformSampleSize !== 0) {
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      sampleSizeList.push(uniformSampleSize)
    }
    return sampleSizeList
  }
  const perSampleTableOffset = 12
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    sampleSizeList.push(stszDataView.getUint32(perSampleTableOffset + sampleIndex * 4))
  }
  return sampleSizeList
}

/**
 * Parses the `stts` (decoding time to sample) box.
 *
 * @param sourceBytes - The full source file bytes.
 * @param sttsBox - The `stts` box span.
 * @returns An array of `(sampleCount, sampleDelta)` run entries.
 *
 * @see ISO/IEC 14496-12 §8.6.1.2 for the `stts` layout.
 */
function parseDecodingTimeDeltas(
  sourceBytes: Uint8Array<ArrayBuffer>,
  sttsBox: BoxSpan
): { count: number; delta: number }[] {
  const sttsDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + sttsBox.payloadOffset,
    sttsBox.payloadLength
  )
  const entryCount = sttsDataView.getUint32(4)
  const decodingTimeDeltaEntries: { count: number; delta: number }[] = []
  const perEntryTableOffset = 8
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const sampleCount = sttsDataView.getUint32(perEntryTableOffset + entryIndex * 8)
    const sampleDelta = sttsDataView.getUint32(perEntryTableOffset + entryIndex * 8 + 4)
    decodingTimeDeltaEntries.push({ count: sampleCount, delta: sampleDelta })
  }
  return decodingTimeDeltaEntries
}

/**
 * Parses the `stss` (sync sample) box. Returns `null` when the box is absent
 * because that encodes the convention that every sample is a sync sample.
 *
 * @param sourceBytes - The full source file bytes.
 * @param stssBox - The `stss` box span, or `undefined` when absent.
 * @returns Sync sample indices (1-based), or `null` when every sample syncs.
 *
 * @see ISO/IEC 14496-12 §8.6.2 for the `stss` layout.
 */
function parseSyncSampleIndices(sourceBytes: Uint8Array<ArrayBuffer>, stssBox: BoxSpan | undefined): number[] | null {
  if (stssBox === undefined) {
    return null
  }
  const stssDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + stssBox.payloadOffset,
    stssBox.payloadLength
  )
  const entryCount = stssDataView.getUint32(4)
  const syncSampleIndices: number[] = []
  const perEntryTableOffset = 8
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    syncSampleIndices.push(stssDataView.getUint32(perEntryTableOffset + entryIndex * 4))
  }
  return syncSampleIndices
}

/**
 * Parses the `stco` (32-bit chunk offset) or `co64` (64-bit chunk offset)
 * box. Selects the wider reader automatically based on which box is present.
 *
 * @param sourceBytes - The full source file bytes.
 * @param chunkOffsetBox - Either the `stco` or `co64` box span.
 * @returns Chunk offsets in absolute file bytes.
 *
 * @see ISO/IEC 14496-12 §8.7.5 for the `stco` layout.
 */
function parseChunkFileOffsets(sourceBytes: Uint8Array<ArrayBuffer>, chunkOffsetBox: BoxSpan): number[] {
  const chunkOffsetDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + chunkOffsetBox.payloadOffset,
    chunkOffsetBox.payloadLength
  )
  const entryCount = chunkOffsetDataView.getUint32(4)
  const chunkFileOffsets: number[] = []
  const perEntryTableOffset = 8
  if (chunkOffsetBox.type === 'stco') {
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      chunkFileOffsets.push(chunkOffsetDataView.getUint32(perEntryTableOffset + entryIndex * 4))
    }
    return chunkFileOffsets
  }
  /* `co64` entries are 8 bytes each: a 32-bit high word and 32-bit low word. */
  const MAX_SAFE_HIGH_WORD = 0x1f_ff_ff
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const highWord = chunkOffsetDataView.getUint32(perEntryTableOffset + entryIndex * 8)
    const lowWord = chunkOffsetDataView.getUint32(perEntryTableOffset + entryIndex * 8 + 4)
    if (highWord > MAX_SAFE_HIGH_WORD) {
      throw new Error('MP4 chunk offset exceeds the browser-safe integer range.')
    }
    chunkFileOffsets.push(highWord * 0x1_00_00_00_00 + lowWord)
  }
  return chunkFileOffsets
}

/**
 * Parses the `stsc` (sample to chunk) box. Only the first-chunk and
 * samples-per-chunk fields are retained because the optional description
 * index is not needed for sample byte extraction.
 *
 * @param sourceBytes - The full source file bytes.
 * @param stscBox - The `stsc` box span.
 * @returns The array of sample-to-chunk run entries.
 *
 * @see ISO/IEC 14496-12 §8.7.4 for the `stsc` layout.
 */
function parseSampleToChunkRuns(
  sourceBytes: Uint8Array<ArrayBuffer>,
  stscBox: BoxSpan
): { firstChunk: number; samplesPerChunk: number }[] {
  const stscDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + stscBox.payloadOffset,
    stscBox.payloadLength
  )
  const entryCount = stscDataView.getUint32(4)
  const runEntries: { firstChunk: number; samplesPerChunk: number }[] = []
  const perEntryTableOffset = 8
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const firstChunk = stscDataView.getUint32(perEntryTableOffset + entryIndex * 12)
    const samplesPerChunk = stscDataView.getUint32(perEntryTableOffset + entryIndex * 12 + 4)
    runEntries.push({ firstChunk, samplesPerChunk })
  }
  return runEntries
}

/**
 * Combines the raw sample-table payloads into the final ordered sample list.
 * Walks the sample-to-chunk run table to assign each sample a chunk, sums
 * sample sizes inside the chunk to derive the absolute byte offset, and walks
 * the `stts` run table and sync sample set to stamp timing and keyframe flags.
 *
 * @param sourceBytes - The full source file bytes.
 * @param sampleTablePayloads - The raw sample-table fields parsed from `stbl`.
 * @param sampleTimescale - Ticks per second used to convert durations.
 * @param isEveryAudioSampleSync - When `true` marks every sample a keyframe,
 *   which is the convention for AAC since it has no inter-frame prediction.
 * @returns The ordered {@link ParsedSample} list.
 *
 * @see ISO/IEC 14496-12 §8.7.4 for the sample-to-chunk walking rules.
 */
function expandSampleTable(
  sourceBytes: Uint8Array<ArrayBuffer>,
  sampleTablePayloads: SampleTablePayloads,
  sampleTimescale: number,
  isEveryAudioSampleSync: boolean
): ParsedSample[] {
  const totalSampleCount = sampleTablePayloads.sampleSizesInBytes.length
  const totalChunkCount = sampleTablePayloads.chunkFileOffsets.length
  const parsedSamples: ParsedSample[] = []

  /*
   * Walk the stsc run entries to build a per-chunk samplesPerChunk array.
   * Each entry applies from `firstChunk` until the `firstChunk` of the next
   * entry (or end of file). The stsc box uses 1-based chunk numbering per
   * ISO/IEC 14496-12 §8.7.4.
   */
  const samplesInEachChunk: number[] = Array.from({ length: totalChunkCount }, () => 0)
  for (let runIndex = 0; runIndex < sampleTablePayloads.sampleToChunkRunEntries.length; runIndex += 1) {
    const currentRun = sampleTablePayloads.sampleToChunkRunEntries[runIndex]
    if (currentRun === undefined) {
      continue
    }
    const nextRun = sampleTablePayloads.sampleToChunkRunEntries[runIndex + 1]
    const oneBasedLastChunk = nextRun !== undefined ? nextRun.firstChunk - 1 : totalChunkCount
    for (
      let oneBasedChunkIndex = currentRun.firstChunk;
      oneBasedChunkIndex <= oneBasedLastChunk;
      oneBasedChunkIndex += 1
    ) {
      const zeroBasedChunkIndex = oneBasedChunkIndex - 1
      if (zeroBasedChunkIndex < 0 || zeroBasedChunkIndex >= totalChunkCount) {
        continue
      }
      samplesInEachChunk[zeroBasedChunkIndex] = currentRun.samplesPerChunk
    }
  }

  const syncSampleSet: Set<number> | null =
    sampleTablePayloads.syncSampleIndices !== null ? new Set(sampleTablePayloads.syncSampleIndices) : null

  let runningSampleIndex = 0
  let runningDecodingTimeTicks = 0
  let decodingTimeDeltaRunIndex = 0
  let remainingSamplesInDeltaRun = sampleTablePayloads.decodingTimeDeltaEntries[0]?.count ?? 0

  for (let zeroBasedChunkIndex = 0; zeroBasedChunkIndex < totalChunkCount; zeroBasedChunkIndex += 1) {
    const samplesInThisChunk = samplesInEachChunk[zeroBasedChunkIndex] ?? 0
    const chunkFileOffset = sampleTablePayloads.chunkFileOffsets[zeroBasedChunkIndex] ?? 0
    let sampleByteCursor = chunkFileOffset
    for (let sampleOffsetInChunk = 0; sampleOffsetInChunk < samplesInThisChunk; sampleOffsetInChunk += 1) {
      if (runningSampleIndex >= totalSampleCount) {
        break
      }
      const sampleSizeInBytes = sampleTablePayloads.sampleSizesInBytes[runningSampleIndex] ?? 0
      if (sampleByteCursor + sampleSizeInBytes > sourceBytes.byteLength) {
        throw new Error(
          `MP4 sample at index ${runningSampleIndex} extends past end of file (offset ${sampleByteCursor}, size ${sampleSizeInBytes}).`
        )
      }

      /* Advance the stts run cursor to the entry containing this sample. */
      while (
        remainingSamplesInDeltaRun === 0 &&
        decodingTimeDeltaRunIndex < sampleTablePayloads.decodingTimeDeltaEntries.length - 1
      ) {
        decodingTimeDeltaRunIndex += 1
        remainingSamplesInDeltaRun = sampleTablePayloads.decodingTimeDeltaEntries[decodingTimeDeltaRunIndex]?.count ?? 0
      }
      const currentSampleDelta = sampleTablePayloads.decodingTimeDeltaEntries[decodingTimeDeltaRunIndex]?.delta ?? 0

      const oneBasedSampleNumber = runningSampleIndex + 1
      const isSyncSample = isEveryAudioSampleSync
        ? true
        : syncSampleSet === null
          ? true
          : syncSampleSet.has(oneBasedSampleNumber)

      const sampleBytesOwned = new Uint8Array(new ArrayBuffer(sampleSizeInBytes))
      sampleBytesOwned.set(sourceBytes.subarray(sampleByteCursor, sampleByteCursor + sampleSizeInBytes))

      const timestampMicroseconds = Math.round((runningDecodingTimeTicks * MICROSECONDS_PER_SECOND) / sampleTimescale)
      const durationMicroseconds = Math.max(
        1,
        Math.round((currentSampleDelta * MICROSECONDS_PER_SECOND) / sampleTimescale)
      )

      parsedSamples.push({
        data: sampleBytesOwned,
        timestampMicroseconds,
        durationMicroseconds,
        isKeyFrame: isSyncSample,
      })

      runningDecodingTimeTicks += currentSampleDelta
      remainingSamplesInDeltaRun -= 1
      sampleByteCursor += sampleSizeInBytes
      runningSampleIndex += 1
    }
  }

  return parsedSamples
}

/**
 * Reads an ES_Descriptor variable-length "expanded" length encoding. Each
 * encoded byte contributes its low 7 bits to the length; the high bit signals
 * continuation. At most four bytes participate per ISO/IEC 14496-1 §7.2.6.
 *
 * @param descriptorBytes - The descriptor slice starting at the first length byte.
 * @param startOffset - Absolute offset of the first length byte.
 * @returns The decoded length and the number of bytes consumed.
 */
function readExpandedDescriptorLength(
  descriptorBytes: Uint8Array<ArrayBuffer>,
  startOffset: number
): { length: number; consumedByteCount: number } {
  let decodedLength = 0
  let consumedByteCount = 0
  for (let continuationIndex = 0; continuationIndex < 4; continuationIndex += 1) {
    const nextByte = descriptorBytes[startOffset + continuationIndex]
    if (nextByte === undefined) {
      throw new Error('Truncated ES_Descriptor length field.')
    }
    decodedLength = (decodedLength << 7) | (nextByte & 0x7f)
    consumedByteCount += 1
    if ((nextByte & 0x80) === 0) {
      break
    }
  }
  return { length: decodedLength, consumedByteCount }
}

/**
 * Walks the `esds` ES_Descriptor chain and returns the DecoderSpecificInfo
 * payload bytes, which for an AAC track is the AudioSpecificConfig defined by
 * ISO/IEC 14496-3 §1.6.2.1.
 *
 * The chain layout per ISO/IEC 14496-1 §7.2.6:
 * - FullBox header (8 bytes: size + `esds` + 4-byte version+flags)
 * - ES_Descriptor (tag 0x03, expanded length)
 *   - 3-byte ES header (ES_ID + flags)
 *   - DecoderConfigDescriptor (tag 0x04, expanded length)
 *     - 13-byte DecoderConfig header
 *     - DecoderSpecificInfo (tag 0x05, expanded length)
 *       - payload = AudioSpecificConfig bytes (the value returned here)
 *
 * @param sourceBytes - The full source file bytes.
 * @param esdsBox - The `esds` box span.
 * @returns A freshly allocated `Uint8Array` holding the AudioSpecificConfig bytes.
 */
function extractAudioSpecificConfigFromEsds(
  sourceBytes: Uint8Array<ArrayBuffer>,
  esdsBox: BoxSpan
): Uint8Array<ArrayBuffer> {
  /* Skip the 4-byte FullBox version+flags header. */
  let descriptorCursor = esdsBox.payloadOffset + 4

  const expectTag = (expectedTag: number, tagLabel: string): number => {
    const foundTag = sourceBytes[descriptorCursor]
    if (foundTag !== expectedTag) {
      throw new Error(
        `Malformed esds descriptor chain: expected ${tagLabel} tag 0x${expectedTag.toString(16)}, found 0x${(foundTag ?? 0).toString(16)} at offset ${descriptorCursor}.`
      )
    }
    descriptorCursor += 1
    const { length, consumedByteCount } = readExpandedDescriptorLength(sourceBytes, descriptorCursor)
    descriptorCursor += consumedByteCount
    return length
  }

  expectTag(0x03, 'ES_Descriptor')
  /*
   * ES_Descriptor body begins with a 2-byte ES_ID and a 1-byte flags byte.
   * Two optional fields (dependsOn stream ID and URL) are skipped based on
   * flag bits. The OCR stream flag adds another two-byte field. The AAC
   * tracks produced by WebCodecs never set these flags, but a conformant
   * reader honours them for robustness.
   */
  descriptorCursor += 2
  const esDescriptorFlags = sourceBytes[descriptorCursor] ?? 0
  descriptorCursor += 1
  if ((esDescriptorFlags & 0x80) !== 0) {
    descriptorCursor += 2
  }
  if ((esDescriptorFlags & 0x40) !== 0) {
    const urlLength = sourceBytes[descriptorCursor] ?? 0
    descriptorCursor += 1 + urlLength
  }
  if ((esDescriptorFlags & 0x20) !== 0) {
    descriptorCursor += 2
  }

  expectTag(0x04, 'DecoderConfigDescriptor')
  /* DecoderConfigDescriptor fixed header is 13 bytes. */
  descriptorCursor += 13

  const decoderSpecificInfoLength = expectTag(0x05, 'DecoderSpecificInfo')
  if (descriptorCursor + decoderSpecificInfoLength > esdsBox.endOffset) {
    throw new Error('DecoderSpecificInfo payload extends past the esds box.')
  }
  const audioSpecificConfigBytes = new Uint8Array(new ArrayBuffer(decoderSpecificInfoLength))
  audioSpecificConfigBytes.set(sourceBytes.subarray(descriptorCursor, descriptorCursor + decoderSpecificInfoLength))
  return audioSpecificConfigBytes
}

/**
 * Reads the coded picture width and height out of the AVC visual sample
 * entry. The two fields live at fixed offsets inside the sample entry body.
 *
 * @param sourceBytes - The full source file bytes.
 * @param avc1Box - The `avc1` visual sample entry box span.
 * @returns The coded width and height.
 *
 * @see ISO/IEC 14496-12 §8.5.2.2 for the VisualSampleEntry layout.
 */
function readAvc1CodedDimensions(
  sourceBytes: Uint8Array<ArrayBuffer>,
  avc1Box: BoxSpan
): { width: number; height: number } {
  /*
   * VisualSampleEntry layout: 6-byte reserved + 2-byte data_reference_index
   * (8 bytes) then a 16-byte SampleEntry(Visual) pre_defined/reserved/
   * pre_defined block, then width (uint16) and height (uint16).
   */
  const dimensionsFieldOffset = avc1Box.payloadOffset + 8 + 16
  const dimensionsDataView = new DataView(sourceBytes.buffer, sourceBytes.byteOffset + dimensionsFieldOffset, 4)
  return {
    width: dimensionsDataView.getUint16(0),
    height: dimensionsDataView.getUint16(2),
  }
}

/**
 * Reads the channel count and sample rate out of the AAC audio sample entry.
 *
 * @param sourceBytes - The full source file bytes.
 * @param mp4aBox - The `mp4a` audio sample entry box span.
 * @returns The channel count and sample rate.
 *
 * @see ISO/IEC 14496-12 §8.5.2.2 for the AudioSampleEntry layout.
 */
function readMp4aAudioMetadata(
  sourceBytes: Uint8Array<ArrayBuffer>,
  mp4aBox: BoxSpan
): { channels: number; sampleRate: number } {
  /*
   * AudioSampleEntry layout: 6-byte reserved + 2-byte data_reference_index,
   * then an 8-byte reserved block, then channel_count (uint16), sample_size
   * (uint16), pre_defined (uint16), reserved (uint16), sample_rate (uint32
   * in 16.16 fixed-point). The 16.16 sample rate keeps only the integer
   * portion as the true value per the standard.
   */
  const audioFieldsOffset = mp4aBox.payloadOffset + 8 + 8
  const audioFieldsDataView = new DataView(sourceBytes.buffer, sourceBytes.byteOffset + audioFieldsOffset, 12)
  const channelCount = audioFieldsDataView.getUint16(0)
  const sampleRateFixedPoint = audioFieldsDataView.getUint32(8)
  const sampleRateHertz = sampleRateFixedPoint >>> 16
  return { channels: channelCount, sampleRate: sampleRateHertz }
}

/**
 * Reads the media timescale from the track `mdhd` box. The timescale lives at
 * a different offset depending on the FullBox version (0 or 1).
 *
 * @param sourceBytes - The full source file bytes.
 * @param mdhdBox - The `mdhd` box span.
 * @returns Ticks per second.
 *
 * @see ISO/IEC 14496-12 §8.4.2.3 for the `mdhd` layout.
 */
function readMediaTimescale(sourceBytes: Uint8Array<ArrayBuffer>, mdhdBox: BoxSpan): number {
  const mdhdDataView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset + mdhdBox.payloadOffset,
    mdhdBox.payloadLength
  )
  const version = mdhdDataView.getUint8(0)
  if (version === 1) {
    /* version 1: 4-byte FullBox + 8-byte creation + 8-byte modification + 4-byte timescale. */
    return mdhdDataView.getUint32(20)
  }
  /* version 0: 4-byte FullBox + 4-byte creation + 4-byte modification + 4-byte timescale. */
  return mdhdDataView.getUint32(12)
}

/**
 * Parses a single `trak` box and returns a {@link ParsedMp4Track} when the
 * track carries a supported codec. Returns `null` for tracks the FileReplay
 * scenario ignores (for example text tracks).
 *
 * @param sourceBytes - The full source file bytes.
 * @param trakBox - The `trak` box span.
 * @returns The parsed track, or `null` when the codec is unsupported and the
 *   caller is expected to continue searching.
 */
function parseTrakBox(sourceBytes: Uint8Array<ArrayBuffer>, trakBox: BoxSpan): ParsedMp4Track | null {
  const trakChildBoxes = readContainerChildBoxes(sourceBytes, trakBox.payloadOffset, trakBox.payloadLength)
  const mdiaBox = requireChildBox(trakChildBoxes, 'mdia', 'trak')
  const mdiaChildBoxes = readContainerChildBoxes(sourceBytes, mdiaBox.payloadOffset, mdiaBox.payloadLength)
  const mdhdBox = requireChildBox(mdiaChildBoxes, 'mdhd', 'mdia')
  const mediaTimescale = readMediaTimescale(sourceBytes, mdhdBox)

  const minfBox = requireChildBox(mdiaChildBoxes, 'minf', 'mdia')
  const minfChildBoxes = readContainerChildBoxes(sourceBytes, minfBox.payloadOffset, minfBox.payloadLength)
  const stblBox = requireChildBox(minfChildBoxes, 'stbl', 'minf')
  const stblChildBoxes = readContainerChildBoxes(sourceBytes, stblBox.payloadOffset, stblBox.payloadLength)

  const stsdBox = requireChildBox(stblChildBoxes, 'stsd', 'stbl')
  /*
   * stsd payload: 4-byte FullBox header + 4-byte entry_count + one or more
   * sample entries. The scenario only supports a single-entry stsd, which
   * matches every MP4 produced by the other playground scenarios.
   */
  const sampleEntryOffset = stsdBox.payloadOffset + 8
  const sampleEntryBox = readBoxHeader(sourceBytes, sampleEntryOffset)

  const stszBox = requireChildBox(stblChildBoxes, 'stsz', 'stbl')
  const sttsBox = requireChildBox(stblChildBoxes, 'stts', 'stbl')
  const stscBox = requireChildBox(stblChildBoxes, 'stsc', 'stbl')
  const stssBox = findChildBox(stblChildBoxes, 'stss')
  const stcoBox = findChildBox(stblChildBoxes, 'stco')
  const co64Box = findChildBox(stblChildBoxes, 'co64')
  const chunkOffsetBox = stcoBox ?? co64Box
  if (chunkOffsetBox === undefined) {
    throw new Error("MP4 is missing both 'stco' and 'co64' boxes inside stbl.")
  }

  const sampleTablePayloads: SampleTablePayloads = {
    sampleSizesInBytes: parseSampleSizes(sourceBytes, stszBox),
    decodingTimeDeltaEntries: parseDecodingTimeDeltas(sourceBytes, sttsBox),
    syncSampleIndices: parseSyncSampleIndices(sourceBytes, stssBox),
    chunkFileOffsets: parseChunkFileOffsets(sourceBytes, chunkOffsetBox),
    sampleToChunkRunEntries: parseSampleToChunkRuns(sourceBytes, stscBox),
  }

  /*
   * Dispatch on the sample entry fourcc. The record maps every supported
   * sample entry type to its parser; everything else returns null so the
   * top-level caller can surface an unsupported-codec error once every track
   * has been inspected.
   */
  const sampleEntryParsers: Record<string, (() => ParsedMp4Track) | undefined> = {
    avc1: (): ParsedMp4Track => {
      const sampleEntryChildBoxes = readContainerChildBoxes(
        sourceBytes,
        /* VisualSampleEntry extension data begins at payloadOffset + 8 + 70. */
        sampleEntryBox.payloadOffset + 78,
        sampleEntryBox.endOffset - (sampleEntryBox.payloadOffset + 78)
      )
      const avccBox = requireChildBox(sampleEntryChildBoxes, 'avcC', 'avc1')
      const avcDecoderConfigRecord = new Uint8Array(new ArrayBuffer(avccBox.payloadLength))
      avcDecoderConfigRecord.set(sourceBytes.subarray(avccBox.payloadOffset, avccBox.endOffset))
      const { width, height } = readAvc1CodedDimensions(sourceBytes, sampleEntryBox)
      const samples = expandSampleTable(sourceBytes, sampleTablePayloads, mediaTimescale, false)
      return {
        kind: 'video',
        codec: 'avc',
        width,
        height,
        avcDecoderConfigRecord,
        timescale: mediaTimescale,
        samples,
      }
    },
    mp4a: (): ParsedMp4Track => {
      const sampleEntryChildBoxes = readContainerChildBoxes(
        sourceBytes,
        /* AudioSampleEntry extension data begins at payloadOffset + 8 + 20. */
        sampleEntryBox.payloadOffset + 28,
        sampleEntryBox.endOffset - (sampleEntryBox.payloadOffset + 28)
      )
      const esdsBox = requireChildBox(sampleEntryChildBoxes, 'esds', 'mp4a')
      const audioSpecificConfig = extractAudioSpecificConfigFromEsds(sourceBytes, esdsBox)
      const { channels, sampleRate } = readMp4aAudioMetadata(sourceBytes, sampleEntryBox)
      const samples = expandSampleTable(sourceBytes, sampleTablePayloads, mediaTimescale, true)
      return {
        kind: 'audio',
        codec: 'aac',
        channels,
        sampleRate,
        audioSpecificConfig,
        timescale: mediaTimescale,
        samples,
      }
    },
  }

  const selectedParser = sampleEntryParsers[sampleEntryBox.type]
  if (selectedParser === undefined) {
    throw new Error(
      `Unsupported sample entry '${sampleEntryBox.type}'. FileReplay only accepts AVC video ('avc1') and AAC audio ('mp4a').`
    )
  }
  return selectedParser()
}

/**
 * Parses the supplied MP4 bytes and returns a {@link ParsedMp4} describing
 * the AVC video track (if any) and the AAC audio track (if any). The buffer
 * must carry both `moov` and `mdat` top-level boxes and at least one
 * supported track.
 *
 * @param sourceBytes - The full source file bytes.
 * @returns The parsed tracks.
 *
 * @throws {Error} When required boxes are missing, when a track uses an
 *   unsupported codec, or when the file is truncated.
 */
export function parseMp4Bytes(sourceBytes: Uint8Array<ArrayBuffer>): ParsedMp4 {
  if (sourceBytes.byteLength < BASE_BOX_HEADER_LENGTH) {
    throw new Error('File is too small to contain an MP4 box header.')
  }

  const topLevelBoxes: BoxSpan[] = []
  let topLevelCursor = 0
  while (topLevelCursor < sourceBytes.byteLength) {
    const topLevelBox = readBoxHeader(sourceBytes, topLevelCursor)
    topLevelBoxes.push(topLevelBox)
    topLevelCursor = topLevelBox.endOffset
  }

  const moovBox = findChildBox(topLevelBoxes, 'moov')
  if (moovBox === undefined) {
    throw new Error("MP4 is missing the required 'moov' box.")
  }
  const mdatBox = findChildBox(topLevelBoxes, 'mdat')
  if (mdatBox === undefined) {
    throw new Error("MP4 is missing the required 'mdat' box.")
  }

  const moovChildBoxes = readContainerChildBoxes(sourceBytes, moovBox.payloadOffset, moovBox.payloadLength)

  let videoTrack: ParsedVideoTrack | null = null
  let audioTrack: ParsedAudioTrack | null = null
  for (const moovChildBox of moovChildBoxes) {
    if (moovChildBox.type !== 'trak') {
      continue
    }
    const parsedTrack = parseTrakBox(sourceBytes, moovChildBox)
    if (parsedTrack === null) {
      continue
    }
    if (parsedTrack.kind === 'video') {
      if (videoTrack !== null) {
        throw new Error('MP4 carries more than one video track. FileReplay supports a single AVC track.')
      }
      videoTrack = parsedTrack
    } else {
      if (audioTrack !== null) {
        throw new Error('MP4 carries more than one audio track. FileReplay supports a single AAC track.')
      }
      audioTrack = parsedTrack
    }
  }

  if (videoTrack === null && audioTrack === null) {
    throw new Error('MP4 contains no AVC video or AAC audio tracks.')
  }

  return { videoTrack, audioTrack }
}

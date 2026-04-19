import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a `ChunkOffsetBox` (`stco`) per ISO/IEC 14496-12 §8.7.5.
 *
 * `stco` is a FullBox (version 0, flags 0) carrying a 32-bit absolute file offset
 * for each chunk. Use this variant when every chunk offset fits in 32 bits. When
 * any offset exceeds `0xFFFFFFFF` (4 GiB), switch to {@link createCo64}. The muxer
 * picks between `stco` and `co64` by checking the largest absolute chunk offset.
 *
 * @param offsets - Absolute file offsets of each chunk, in chunk order. Each value
 *   must be in the range `[0, 0xFFFFFFFF]`.
 * @returns A `FullBox` whose serializer writes the entry count followed by one
 *   32-bit offset per chunk.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStco(offsets: number[]): FullBox {
  return {
    type: 'stco',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(offsets.length)
      for (const chunkOffset of offsets) writer.u32(chunkOffset)
    },
  }
}

/**
 * Builds a `ChunkLargeOffsetBox` (`co64`) per ISO/IEC 14496-12 §8.7.5.
 *
 * `co64` is a FullBox (version 0, flags 0) carrying a 64-bit absolute file offset
 * for each chunk. It replaces {@link createStco} when any chunk offset exceeds
 * `0xFFFFFFFF` (4 GiB). The muxer selects `co64` over `stco` by checking the
 * largest absolute chunk offset at finalize time.
 *
 * @param offsets - Absolute file offsets of each chunk, in chunk order, as `bigint`
 *   values so that the full 64-bit range is representable without loss.
 * @returns A `FullBox` whose serializer writes the entry count followed by one
 *   64-bit offset per chunk.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createCo64(offsets: bigint[]): FullBox {
  return {
    type: 'co64',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(offsets.length)
      for (const chunkOffset of offsets) writer.u64(chunkOffset)
    },
  }
}

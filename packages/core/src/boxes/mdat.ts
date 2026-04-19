import type { Writer } from '@/io/writer'

/**
 * Byte size of the 32-bit `MediaDataBox` (`mdat`) header.
 *
 * @remarks
 * Equals 8 bytes: a 4-byte `size` field followed by the 4-byte fourcc `"mdat"`.
 *
 * @defaultValue `8`
 */
export const MDAT_HEADER_SIZE_32 = 8

/**
 * Byte size of the 64-bit `MediaDataBox` (`mdat`) header with a `largesize` field.
 *
 * @remarks
 * Equals 16 bytes: a 4-byte `size` field (set to 1 to signal the extended form),
 * the 4-byte fourcc `"mdat"`, and an 8-byte `largesize` field carrying the real
 * total size.
 *
 * @defaultValue `16`
 */
export const MDAT_HEADER_SIZE_64 = 16

/**
 * Writes the 32-bit header of a `MediaDataBox` (`mdat`) per ISO/IEC 14496-12 §8.1.1.
 *
 * Emits a 4-byte `size` field followed by the fourcc `"mdat"`, totaling
 * {@link MDAT_HEADER_SIZE_32} bytes. Use this variant when the whole `mdat`
 * (header plus sample payload) fits in 32 bits. When the total exceeds
 * `0xFFFFFFFF`, use {@link writeMdatHeader64} instead.
 *
 * @param writer - The destination `Writer` that receives the header bytes.
 * @param totalSize - The total byte size of the `mdat` box, including its own
 *   8-byte header. Must be less than or equal to `0xFFFFFFFF`.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function writeMdatHeader32(writer: Writer, totalSize: number): void {
  writer.u32(totalSize)
  writer.fourcc('mdat')
}

/**
 * Writes the 64-bit (`largesize`) header of a `MediaDataBox` (`mdat`) per
 * ISO/IEC 14496-12 §8.1.1.
 *
 * Emits the sentinel `size = 1`, the fourcc `"mdat"`, and an 8-byte `largesize`
 * field carrying the real total size, totaling {@link MDAT_HEADER_SIZE_64} bytes.
 * Use this variant when the whole `mdat` (header plus sample payload) exceeds
 * `0xFFFFFFFF` bytes.
 *
 * @param writer - The destination `Writer` that receives the header bytes.
 * @param totalSize - The total byte size of the `mdat` box as a `bigint`,
 *   including its own 16-byte header.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function writeMdatHeader64(writer: Writer, totalSize: bigint): void {
  writer.u32(1)
  writer.fourcc('mdat')
  writer.u64(totalSize)
}

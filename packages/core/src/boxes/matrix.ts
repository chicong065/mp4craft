/**
 * The ISOBMFF 3x3 "unity" transformation matrix, flagged to mean "no transform" on the track.
 *
 * Per ISO/IEC 14496-12 §8.2.2 and §8.3.2, the transformation matrix stored in `mvhd` and
 * `tkhd` is a 9-entry 3x3 matrix in row-major order with mixed fixed-point formats. Entries
 * at indices 0, 1, 3, 4, 6, and 7 (the `a`, `b`, `c`, `d`, `x`, `y` entries) use 16.16
 * fixed-point, while entries at indices 2, 5, and 8 (the `u`, `v`, `w` entries) use 2.30
 * fixed-point. The unity matrix is therefore `{ 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0,
 * 0x40000000 }`, representing the identity transform `[[1, 0, 0], [0, 1, 0], [0, 0, 1]]`.
 *
 * Every entry is written as a 32-bit big-endian unsigned integer by the owning box.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export const UNITY_MATRIX_3X3 = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000] as const

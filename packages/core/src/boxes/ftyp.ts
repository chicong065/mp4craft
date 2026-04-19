import type { Box } from '@/boxes/box'

/**
 * Options for constructing a `FileTypeBox` (`ftyp`).
 *
 * Every brand value is a 4-character ASCII fourcc identifying a file-format profile. The
 * `majorBrand` declares the "best use" profile, while `compatibleBrands` enumerates every
 * profile the file is also compliant with. MP4 files typically list `isom` and `iso2` as
 * baseline compatibility, and add codec-specific brands such as `avc1`, `hvc1`, or `vp09` to
 * opt into per-codec file-format profiles.
 *
 * @see {@link https://mp4ra.org/registered-types/brands | MP4 Registration Authority brand registry}
 */
export type FtypOptions = {
  /**
   * The primary brand, a 4-character ASCII fourcc identifying the file-format profile that
   * best describes the file's intended use.
   */
  readonly majorBrand: string
  /**
   * A 32-bit informative version number associated with `majorBrand`. Not interpreted by
   * decoders, but stored verbatim in the box.
   */
  readonly minorVersion: number
  /**
   * The list of 4-character ASCII fourcc brands the file declares compatibility with.
   * Typically includes `isom` and `iso2` plus codec-specific brands such as `avc1`, `hvc1`,
   * or `vp09`.
   */
  readonly compatibleBrands: readonly string[]
}

/**
 * Builds a `FileTypeBox` (`ftyp`) declaring the file-format profile and compatible brands.
 *
 * Per ISO/IEC 14496-12 §4.3, `ftyp` must appear before any significant data in the file and
 * advertises both the major brand and the set of brands the file is compatible with.
 *
 * @param options - Major brand, minor version, and compatible-brand list (see {@link FtypOptions}).
 * @returns A {@link Box} whose serializer writes the `ftyp` body bytes in the order
 *   `(majorBrand, minorVersion, compatibleBrands...)`.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://mp4ra.org/registered-types/brands | MP4 Registration Authority brand registry}
 */
export function createFtyp(options: FtypOptions): Box {
  return {
    type: 'ftyp',
    write: (writer) => {
      writer.fourcc(options.majorBrand)
      writer.u32(options.minorVersion)
      for (const compatibleBrand of options.compatibleBrands) {
        writer.fourcc(compatibleBrand)
      }
    },
  }
}

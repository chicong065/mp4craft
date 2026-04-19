import type { FullBox } from '@/boxes/full-box'
import { ConfigError } from '@/types/errors'

/**
 * Options for constructing a `MediaHeaderBox` (`mdhd`).
 *
 * Times and duration are in the per-track media timescale (distinct from the movie timescale
 * in `mvhd`), per ISO/IEC 14496-12 §8.4.2. This builder emits the version 0 layout (32-bit
 * times and duration).
 */
export type MdhdOptions = {
  /**
   * Number of time units that pass per second in the media's timeline, used to interpret
   * per-sample composition and decode times.
   */
  timescale: number
  /**
   * The media duration expressed in `timescale` units. Equals the sum of sample durations for
   * the track's elementary stream.
   */
  duration: number
  /**
   * The media's language as a 3-character lowercase ISO 639-2/T code. Encoded into a 15-bit
   * packed integer per §8.4.2. Defaults to `"und"` (undetermined) when omitted.
   *
   * @defaultValue `"und"`
   */
  language?: string
  /**
   * Seconds since 1904-01-01 UTC at which the media was created. Defaults to `0` when omitted.
   */
  creationTime?: number
  /**
   * Seconds since 1904-01-01 UTC at which the media was last modified. Defaults to `0` when
   * omitted.
   */
  modificationTime?: number
}

/**
 * Packs a 3-character ISO 639-2/T language code into the 15-bit big-endian format required by
 * `mdhd`.
 *
 * Per ISO/IEC 14496-12 §8.4.2, the language field is a 16-bit value with the top bit padded
 * to `0` and the remaining 15 bits containing three 5-bit entries. Each 5-bit entry encodes
 * one lowercase ASCII letter as `char - 0x60` (so `'a'` is `1` and `'z'` is `26`).
 *
 * @param languageCode - A 3-character lowercase ISO 639-2/T language code.
 * @returns The packed 15-bit language value, ready to be written as a `u16`.
 * @throws {ConfigError} When `languageCode.length !== 3`.
 * @throws {ConfigError} When any character falls outside the lowercase `a` through `z` range.
 */
function packLanguage(languageCode: string): number {
  if (languageCode.length !== 3) {
    throw new ConfigError(`language code must be 3 chars, got "${languageCode}"`)
  }
  const charValues = [
    languageCode.charCodeAt(0) - 0x60,
    languageCode.charCodeAt(1) - 0x60,
    languageCode.charCodeAt(2) - 0x60,
  ]
  for (let charIndex = 0; charIndex < 3; charIndex++) {
    const charValue = charValues[charIndex]!
    if (charValue < 1 || charValue > 26) {
      throw new ConfigError(`language code must be lowercase a-z, got "${languageCode}" at position ${charIndex}`)
    }
  }
  return ((charValues[0]! & 0x1f) << 10) | ((charValues[1]! & 0x1f) << 5) | (charValues[2]! & 0x1f)
}

/**
 * Builds a `MediaHeaderBox` (`mdhd`) describing the per-track media timescale, duration, and
 * language.
 *
 * Per ISO/IEC 14496-12 §8.4.2, `mdhd` is a FullBox written at version 0 with 32-bit creation
 * and modification times, the media timescale and duration, the packed 15-bit language field,
 * and a 16-bit `pre_defined` field set to `0`.
 *
 * @param options - Media timing and language values (see {@link MdhdOptions}).
 * @returns A {@link FullBox} whose serializer emits the `mdhd` body per §8.4.2 version 0.
 * @throws {ConfigError} When `options.language` is not a 3-character lowercase ISO 639-2/T code.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference}
 */
export function createMdhd(options: MdhdOptions): FullBox {
  return {
    type: 'mdhd',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.creationTime ?? 0)
      writer.u32(options.modificationTime ?? 0)
      writer.u32(options.timescale)
      writer.u32(options.duration)
      writer.u16(packLanguage(options.language ?? 'und'))
      writer.u16(0) // pre_defined
    },
  }
}

import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createStsz}, in one of two mutually exclusive shapes.
 *
 * @remarks
 * Form one carries a uniform `fixedSize` shared by every sample, along with the
 * total `sampleCount`. The encoder writes `sample_size = fixedSize` and
 * `sample_count = sampleCount`, and no per-sample table follows.
 *
 * Form two carries a per-sample `sizes` array. The encoder writes
 * `sample_size = 0`, `sample_count = sizes.length`, and then one 32-bit size entry
 * per sample. This is the form used by the muxer because encoded sample sizes vary.
 */
export type StszOptions =
  | {
      /** Uniform size in bytes applied to every sample when all samples are the same length. */
      fixedSize: number
      /** Total number of samples in the track when `fixedSize` is in effect. */
      sampleCount: number
      /** Forbidden in this form. */
      sizes?: never
    }
  | {
      /** Forbidden in this form. */
      fixedSize?: never
      /** Forbidden in this form. */
      sampleCount?: never
      /**
       * Per-sample sizes in bytes, in decoding order, one entry per sample in the track.
       * The array length determines the sample count written to the box.
       */
      sizes: number[]
    }

/**
 * Builds a `SampleSizeBox` (`stsz`) per ISO/IEC 14496-12 §8.7.3.2.
 *
 * `stsz` is a FullBox (version 0, flags 0) whose payload is `sample_size`,
 * `sample_count`, and, when `sample_size` is 0, a per-sample table of 32-bit sizes.
 *
 * @param options - Either a uniform-size configuration ({@link StszOptions} form
 *   one) or a per-sample sizes array ({@link StszOptions} form two).
 * @returns A `FullBox` whose serializer writes the chosen layout.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStsz(options: StszOptions): FullBox {
  return {
    type: 'stsz',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(options.fixedSize ?? 0)
      if (options.fixedSize !== undefined) {
        writer.u32(options.sampleCount)
      } else {
        writer.u32(options.sizes.length)
        for (const sampleSize of options.sizes) writer.u32(sampleSize)
      }
    },
  }
}

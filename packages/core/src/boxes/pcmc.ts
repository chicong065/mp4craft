import type { FullBox } from '@/boxes/full-box'

/**
 * Options for {@link createPcmc}.
 */
export type PcmcOptions = {
  /**
   * Byte order of each PCM sample in the accompanying `mdat`. `"little"` sets bit 0 of
   * `format_flags` (value `0x01`). `"big"` leaves it cleared (value `0x00`).
   */
  endianness: 'little' | 'big'
  /** Bit depth of each PCM sample. mp4craft supports 16, 24, and 32. */
  bitsPerSample: number
}

/**
 * Builds a `PCMConfigurationBox` (`pcmC`) declaring the endianness and bit depth of the
 * PCM samples in the parent `ipcm` sample entry.
 *
 * Per ISO/IEC 23003-5, `pcmC` is a FullBox (version 0, flags 0) whose body is a `u8`
 * `format_flags` followed by a `u8` `PCM_sample_size`. `format_flags` bit 0 marks
 * little-endian samples (`1`) versus big-endian (`0`). Bits 1 through 7 are reserved
 * and mp4craft writes them as zero.
 *
 * @param options - Endianness and bit depth controlling the two `pcmC` payload bytes.
 * @returns A {@link FullBox} that serializes to a 14-byte `pcmC` box.
 *
 * @see ISO/IEC 23003-5 for the PCMConfigurationBox payload.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createPcmc(options: PcmcOptions): FullBox {
  return {
    type: 'pcmC',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u8(options.endianness === 'little' ? 0x01 : 0x00)
      writer.u8(options.bitsPerSample)
    },
  }
}

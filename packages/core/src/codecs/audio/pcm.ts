import { writeBox, type Box } from '@/boxes/box'
import { createPcmc } from '@/boxes/pcmc'
import type { AudioCodecAdapter } from '@/codecs/codec'

/**
 * Options for constructing a {@link PcmCodec}.
 *
 * @see ISO/IEC 23003-5 for the `ipcm` sample entry and `pcmC` configuration box layouts.
 */
export type PcmCodecOptions = {
  /** Output channel count, written into the AudioSampleEntry channelcount field. */
  channels: number
  /** Source sample rate in Hz, written into the AudioSampleEntry samplerate field. */
  sampleRate: number
  /** Bit depth of each PCM sample. mp4craft supports 16, 24, and 32. */
  bitsPerSample: 16 | 24 | 32
  /** Byte order of each PCM sample in the accompanying `mdat`. */
  endianness: 'little' | 'big'
}

/**
 * Integer PCM audio codec, producing an `ipcm` AudioSampleEntry with a `pcmC` FullBox
 * child per ISO/IEC 23003-5.
 *
 * The sample rate and channel count live in the standard AudioSampleEntry fields. The bit
 * depth also populates the `samplesize` field there, and the `pcmC` child separately
 * carries the bit depth alongside the little-endian or big-endian byte-order flag. PCM
 * carries no decoder configuration record, so no out-of-band `description` is required.
 *
 * mp4craft does not emit a `ChannelLayoutBox` (`chnl`). Some parsers require `chnl` for
 * multi-channel PCM. Mono and stereo layouts are accepted without it by every parser
 * the test suite round-trips against.
 *
 * @see ISO/IEC 23003-5 for the `ipcm` sample entry and `pcmC` layout.
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4 Registration Authority sample-entry registry}
 */
export class PcmCodec implements AudioCodecAdapter {
  readonly kind = 'audio'
  readonly fourcc = 'ipcm'
  /** Output channel count forwarded from {@link PcmCodecOptions.channels}. */
  readonly channels: number
  /** Source sample rate in Hz forwarded from {@link PcmCodecOptions.sampleRate}. */
  readonly sampleRate: number
  /** Bit depth of each PCM sample forwarded from {@link PcmCodecOptions.bitsPerSample}. */
  readonly bitsPerSample: 16 | 24 | 32
  /** Byte order of each PCM sample forwarded from {@link PcmCodecOptions.endianness}. */
  readonly endianness: 'little' | 'big'

  /**
   * Constructs the PCM codec adapter.
   *
   * @param options - Channel count, source sample rate, sample bit depth, and byte order.
   *   PCM carries no out-of-band decoder configuration.
   */
  constructor(options: PcmCodecOptions) {
    this.channels = options.channels
    this.sampleRate = options.sampleRate
    this.bitsPerSample = options.bitsPerSample
    this.endianness = options.endianness
  }

  /**
   * Builds the `ipcm` AudioSampleEntry with its `pcmC` child.
   *
   * @returns A `Box` whose serializer emits the fixed AudioSampleEntry header, the declared
   *   channel count, the bit depth in the `samplesize` field, the 16.16 fixed-point sample
   *   rate, and the wrapped `pcmC` FullBox carrying the endianness flag and bit depth.
   */
  createSampleEntry(): Box {
    return {
      type: 'ipcm',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.zeros(8)
        writer.u16(this.channels)
        writer.u16(this.bitsPerSample)
        writer.u16(0)
        writer.u16(0)
        writer.u32(this.sampleRate * 0x10000)
        writeBox(writer, createPcmc({ endianness: this.endianness, bitsPerSample: this.bitsPerSample }))
      },
    }
  }
}

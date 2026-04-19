import { writeBox, type Box } from '@/boxes/box'
import { createDfla } from '@/boxes/dfla'
import type { AudioCodecAdapter } from '@/codecs/codec'
import { toUint8Array } from '@/io/bytes'

/**
 * Options for constructing a {@link FlacCodec}.
 *
 * @see {@link https://github.com/xiph/flac/blob/master/doc/isoflac.txt | FLAC in ISOBMFF}
 */
export type FlacCodecOptions = {
  /**
   * FLAC metadata-block bytes that populate the child `dfLa` FullBox. The STREAMINFO block
   * MUST be present. The supplied bytes must NOT include the native "fLaC" magic signature
   * that begins a standalone `.flac` file. That magic lives outside the ISOBMFF encoding.
   */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, as declared by the STREAMINFO block. */
  channels: number
  /** Source sample rate in Hz, written into the AudioSampleEntry samplerate field. */
  sampleRate: number
}

/**
 * FLAC audio codec, producing an `fLaC` AudioSampleEntry with a `dfLa` child box per the
 * FLAC in ISOBMFF encapsulation. The class stores the supplied metadata-block bytes
 * verbatim and does not parse or validate them.
 *
 * @see {@link https://github.com/xiph/flac/blob/master/doc/isoflac.txt | FLAC in ISOBMFF}
 * @see {@link https://xiph.org/flac/format.html | FLAC Format Specification (STREAMINFO layout)}
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4 Registration Authority sample-entry registry}
 */
export class FlacCodec implements AudioCodecAdapter {
  readonly kind = 'audio'
  readonly fourcc = 'fLaC'
  /** Output channel count forwarded from {@link FlacCodecOptions.channels}. */
  readonly channels: number
  /** Source sample rate in Hz forwarded from {@link FlacCodecOptions.sampleRate}. */
  readonly sampleRate: number
  private readonly metadataBlocksPayload: Uint8Array

  /**
   * Constructs the FLAC codec adapter.
   *
   * @param options - Channel count, source sample rate, and the `dfLa` metadata-block bytes.
   */
  constructor(options: FlacCodecOptions) {
    this.metadataBlocksPayload = toUint8Array(options.description)
    this.channels = options.channels
    this.sampleRate = options.sampleRate
  }

  /**
   * Builds the `fLaC` AudioSampleEntry with its `dfLa` child.
   *
   * @returns A `Box` whose serializer emits the fixed AudioSampleEntry header, the declared
   *   channel count, the 16-bit samplesize, the 16.16 fixed-point sample rate, and the
   *   wrapped `dfLa` FullBox carrying the supplied metadata-block bytes.
   */
  createSampleEntry(): Box {
    return {
      type: 'fLaC',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.zeros(8)
        writer.u16(this.channels)
        writer.u16(16)
        writer.u16(0)
        writer.u16(0)
        writer.u32(this.sampleRate * 0x10000)
        writeBox(writer, createDfla(this.metadataBlocksPayload))
      },
    }
  }
}

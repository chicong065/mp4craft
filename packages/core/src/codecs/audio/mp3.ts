import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'
import type { AudioCodecAdapter } from '@/codecs/codec'
import { Writer } from '@/io/writer'

/**
 * Options for constructing an {@link Mp3Codec}.
 */
export type Mp3CodecOptions = {
  /** Output channel count declared on the emitted `mp4a` AudioSampleEntry. */
  channels: number
  /** Source sample rate in Hz, written into the AudioSampleEntry in 16.16 fixed-point. */
  sampleRate: number
}

/**
 * MPEG-1 Audio Layer III codec, producing an `mp4a` AudioSampleEntry with an `esds`
 * descriptor whose `objectTypeIndication` is `0x6B` (MPEG-1 Audio) and whose
 * DecoderSpecificInfo descriptor is omitted because MP3 decoders derive every parameter
 * from the bitstream.
 *
 * @see {@link https://mp4ra.org/registered-types/mp4ra/object-types | MP4 Registration Authority Object Type Indications}
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4 Registration Authority sample-entry registry}
 * @see ISO/IEC 14496-1 §7.2.6 for the ES descriptor chain.
 */
export class Mp3Codec implements AudioCodecAdapter {
  readonly kind = 'audio'
  readonly fourcc = 'mp4a'
  /** Output channel count forwarded from {@link Mp3CodecOptions.channels}. */
  readonly channels: number
  /** Source sample rate in Hz forwarded from {@link Mp3CodecOptions.sampleRate}. */
  readonly sampleRate: number

  /**
   * Constructs the MP3 codec adapter.
   *
   * @param options - Channel count and source sample rate. MP3 carries no out-of-band
   *   decoder configuration.
   */
  constructor(options: Mp3CodecOptions) {
    this.channels = options.channels
    this.sampleRate = options.sampleRate
  }

  /**
   * Builds the `mp4a` AudioSampleEntry with its `esds` child.
   *
   * @returns A `Box` whose serializer emits the fixed AudioSampleEntry header, the declared
   *   channel count, the 16-bit samplesize, the 16.16 fixed-point sample rate, and the
   *   wrapped `esds` ES_Descriptor chain with `objectTypeIndication: 0x6B` and no
   *   DecoderSpecificInfo payload.
   */
  createSampleEntry(): Box {
    return {
      type: 'mp4a',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.zeros(8)
        writer.u16(this.channels)
        writer.u16(16)
        writer.u16(0)
        writer.u16(0)
        writer.u32(this.sampleRate * 0x10000)
        writeBox(writer, this.createEsdsBox())
      },
    }
  }

  private createEsdsBox(): FullBox {
    return {
      type: 'esds',
      version: 0,
      flags: 0,
      write: (writer) => {
        writeMp4Descriptor(writer, 0x03, (esDescriptorWriter) => {
          esDescriptorWriter.u16(0)
          esDescriptorWriter.u8(0)
          writeMp4Descriptor(esDescriptorWriter, 0x04, (decoderConfigWriter) => {
            // objectTypeIndication 0x6B identifies MPEG-1 Audio (MP3) per MP4RA.
            decoderConfigWriter.u8(0x6b)
            // streamType (6 bits) = 0x05 (audioStream), upstream flag (1 bit) = 0,
            // reserved (1 bit) = 1, packed as (0x05 << 2) | 0x01.
            decoderConfigWriter.u8((0x05 << 2) | 0x01)
            decoderConfigWriter.u24(0)
            decoderConfigWriter.u32(0)
            decoderConfigWriter.u32(0)
            // DecoderSpecificInfo is intentionally omitted. MP3 carries all decoder
            // parameters in its bitstream and has no out-of-band configuration.
          })
          writeMp4Descriptor(esDescriptorWriter, 0x06, (slConfigWriter) => {
            slConfigWriter.u8(0x02)
          })
        })
      },
    }
  }
}

function writeMp4Descriptor(parentWriter: Writer, tag: number, writeBody: (bodyWriter: Writer) => void): void {
  const bodyWriter = new Writer()
  writeBody(bodyWriter)
  const bodyBytes = bodyWriter.toBytes()
  parentWriter.u8(tag)
  writeDescriptorLength(parentWriter, bodyBytes.length)
  parentWriter.bytes(bodyBytes)
}

function writeDescriptorLength(parentWriter: Writer, length: number): void {
  // ISO/IEC 14496-1 §7.2.6: always 4-byte extended form for simplicity.
  parentWriter.u8(0x80 | ((length >> 21) & 0x7f))
  parentWriter.u8(0x80 | ((length >> 14) & 0x7f))
  parentWriter.u8(0x80 | ((length >> 7) & 0x7f))
  parentWriter.u8(length & 0x7f)
}

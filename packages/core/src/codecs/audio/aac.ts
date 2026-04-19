import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'
import type { AudioCodecAdapter } from '@/codecs/codec'
import { toUint8Array } from '@/io/bytes'
import { Writer } from '@/io/writer'

/**
 * Options for constructing an {@link AacCodec}.
 */
export type AacCodecOptions = {
  /**
   * AudioSpecificConfig bytes per ISO/IEC 14496-3 §1.6.2.1. The muxer embeds these verbatim as
   * the DecoderSpecificInfo payload (descriptor tag `0x05`) inside the `esds` ES_Descriptor.
   * Typically obtained from `AudioDecoderConfig.description` when using WebCodecs.
   */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, written into the `mp4a` AudioSampleEntry channelcount field. */
  channels: number
  /**
   * Source sample rate in Hz, encoded as 16.16 fixed-point in the `mp4a` samplerate field. The
   * value reflects the AAC AudioSpecificConfig sampling frequency and may differ from the SBR
   * extended output rate when HE-AAC is used.
   */
  sampleRate: number
}

/**
 * AAC audio codec, producing an `mp4a` AudioSampleEntry with an `esds` child box.
 *
 * The `esds` descriptor stack follows ISO/IEC 14496-1 §7.2.6: an ES_Descriptor (tag `0x03`)
 * wraps a DecoderConfigDescriptor (tag `0x04`) whose DecoderSpecificInfo (tag `0x05`) carries
 * the AudioSpecificConfig payload. An SLConfigDescriptor (tag `0x06`) with predefined value `2`
 * closes out the stack as required for MP4.
 *
 * @see {@link https://mp4ra.org/registered-types/sampleentries | ISO/IEC 14496-14 (mp4a sample entry)}
 * @see {@link https://www.iso.org/standard/76383.html | ISO/IEC 14496-3 §1.6.2.1 (AudioSpecificConfig)}
 * @see {@link https://www.iso.org/standard/83454.html | ISO/IEC 14496-1 §7.2.6 (descriptor encoding)}
 */
export class AacCodec implements AudioCodecAdapter {
  readonly kind = 'audio'
  readonly fourcc = 'mp4a'
  /** Output channel count forwarded from {@link AacCodecOptions.channels}. */
  readonly channels: number
  /** Source sample rate in Hz forwarded from {@link AacCodecOptions.sampleRate}. */
  readonly sampleRate: number
  private readonly audioSpecificConfig: Uint8Array

  /**
   * Constructs the AAC codec adapter.
   *
   * @param options - Channel count, sample rate, and AudioSpecificConfig bytes.
   */
  constructor(options: AacCodecOptions) {
    this.audioSpecificConfig = toUint8Array(options.description)
    this.channels = options.channels
    this.sampleRate = options.sampleRate
  }

  /**
   * Builds the `mp4a` AudioSampleEntry with its `esds` child.
   *
   * @returns A `Box` whose serializer emits the fixed AudioSampleEntry header, the declared
   *   channel count, the 16-bit samplesize, the 16.16 fixed-point sample rate, and the wrapped
   *   `esds` ES_Descriptor chain.
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
            decoderConfigWriter.u8(0x40)
            decoderConfigWriter.u8((0x05 << 2) | 0x01)
            decoderConfigWriter.u24(0)
            decoderConfigWriter.u32(0)
            decoderConfigWriter.u32(0)
            writeMp4Descriptor(decoderConfigWriter, 0x05, (decoderSpecificInfoWriter) => {
              decoderSpecificInfoWriter.bytes(this.audioSpecificConfig)
            })
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
  // ISO/IEC 14496-1 §7.2.6: always 4-byte extended form for simplicity
  parentWriter.u8(0x80 | ((length >> 21) & 0x7f))
  parentWriter.u8(0x80 | ((length >> 14) & 0x7f))
  parentWriter.u8(0x80 | ((length >> 7) & 0x7f))
  parentWriter.u8(length & 0x7f)
}

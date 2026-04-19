import { writeBox, type Box } from '@/boxes/box'
import type { VideoCodecAdapter } from '@/codecs/codec'
import { toUint8Array } from '@/io/bytes'

/**
 * HEVC (H.265) video codec, producing an `hvc1` VisualSampleEntry with an `hvcC` child box.
 *
 * Unlike {@link AvcCodec}, this adapter does not parse the HEVCDecoderConfigurationRecord to
 * derive the picture dimensions. The caller must supply `width` and `height` explicitly,
 * because parsing the HEVC VPS and SPS NAL units to extract coded dimensions is out of scope
 * for the current release. The `hvcC` payload is stored opaquely and emitted verbatim.
 *
 * @see {@link https://mp4ra.org/registered-types/sampleentries | ISO/IEC 14496-15 §8 (hvc1 and hvcC)}
 * @see {@link https://www.itu.int/rec/T-REC-H.265 | ITU-T H.265 (HEVC bitstream syntax)}
 */
export class HevcCodec implements VideoCodecAdapter {
  readonly kind = 'video'
  readonly fourcc = 'hvc1'
  private readonly hvcc: Uint8Array
  private readonly width: number
  private readonly height: number

  /**
   * Constructs the HEVC codec adapter.
   *
   * @param description - The HEVCDecoderConfigurationRecord bytes per ISO/IEC 14496-15 §8.3.2.1.2
   *   (the payload that goes inside the `hvcC` box). Typically this comes from WebCodecs
   *   `VideoDecoderConfig.description` or a source MP4 track's `hvcC` atom payload.
   * @param width - Coded picture width in luma samples, written into the sample entry.
   * @param height - Coded picture height in luma samples, written into the sample entry.
   */
  constructor(description: ArrayBuffer | ArrayBufferView, width: number, height: number) {
    this.hvcc = toUint8Array(description)
    this.width = width
    this.height = height
  }

  /**
   * Builds the `hvc1` VisualSampleEntry with its `hvcC` child.
   *
   * @returns A `Box` whose serializer emits the fixed VisualSampleEntry header, the caller-
   *   supplied picture dimensions, 72 dpi resolution values, the `mp4craft HEVC` compressor
   *   name, and the wrapped HEVCDecoderConfigurationRecord.
   */
  createSampleEntry(): Box {
    return {
      type: 'hvc1',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.u16(0)
        writer.u16(0)
        writer.zeros(12)
        writer.u16(this.width)
        writer.u16(this.height)
        writer.u32(0x00480000)
        writer.u32(0x00480000)
        writer.u32(0)
        writer.u16(1)
        const compressorName = 'mp4craft HEVC'
        writer.u8(compressorName.length)
        writer.ascii(compressorName)
        writer.zeros(31 - compressorName.length)
        writer.u16(0x0018)
        writer.u16(0xffff)
        writeBox(writer, this.createHvcCBox())
      },
    }
  }

  private createHvcCBox(): Box {
    return {
      type: 'hvcC',
      write: (writer) => writer.bytes(this.hvcc),
    }
  }
}

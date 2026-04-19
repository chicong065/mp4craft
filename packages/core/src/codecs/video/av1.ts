import { createAv1c } from '@/boxes/av1c'
import { writeBox, type Box } from '@/boxes/box'
import type { VideoCodecAdapter } from '@/codecs/codec'
import { toUint8Array } from '@/io/bytes'

/**
 * AV1 video codec, producing an `av01` VisualSampleEntry with an `av1C` child box.
 *
 * Per the AV1 ISOBMFF binding §2.2 and §2.3, an AV1 track uses the `av01` sample entry code
 * and carries its decoder configuration in a child `av1C` box. The `av1C` payload is an
 * `AV1CodecConfigurationRecord` whose first byte packs a marker bit and a 7-bit version,
 * which replaces the FullBox `(version, flags)` header. The record also encodes
 * `seq_profile`, `seq_level_idx_0`, `seq_tier_0`, the bit-depth flags, the chroma
 * subsampling fields, and an optional variable-length `configOBUs` section carrying the
 * Sequence Header OBU.
 *
 * As with {@link HevcCodec} and {@link Vp9Codec}, this adapter does not parse the
 * `AV1CodecConfigurationRecord` or the embedded Sequence Header OBU to derive the picture
 * dimensions. The caller must supply `width` and `height` explicitly, because decoding the
 * variable-length OBU syntax to recover coded dimensions is out of scope for the current
 * release. The record is stored opaquely and emitted verbatim as the body of `av1C`.
 *
 * @see {@link https://aomediacodec.github.io/av1-isobmff/ | AV1 Codec ISO Media File Format Binding v1.2.0}
 * @see {@link https://aomediacodec.github.io/av1-spec/ | AV1 Bitstream and Decoding Process Specification}
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4 Registration Authority sample-entry registry}
 */
export class Av1Codec implements VideoCodecAdapter {
  readonly kind = 'video'
  readonly fourcc = 'av01'
  private readonly av1ConfigurationRecord: Uint8Array
  private readonly width: number
  private readonly height: number

  /**
   * Constructs the AV1 codec adapter.
   *
   * @param description - The full `AV1CodecConfigurationRecord` bytes per the AV1 ISOBMFF
   *   binding §2.3 (the payload that goes inside the `av1C` box, starting at the
   *   marker-and-version byte and running through the optional `configOBUs`). Typically this
   *   comes from WebCodecs `VideoDecoderConfig.description` or a source MP4 track's `av1C`
   *   atom payload.
   * @param width - Coded picture width in luma samples, written into the sample entry.
   * @param height - Coded picture height in luma samples, written into the sample entry.
   */
  constructor(description: ArrayBuffer | ArrayBufferView, width: number, height: number) {
    this.av1ConfigurationRecord = toUint8Array(description)
    this.width = width
    this.height = height
  }

  /**
   * Builds the `av01` VisualSampleEntry with its `av1C` child.
   *
   * @returns A `Box` whose serializer emits the fixed VisualSampleEntry header, the caller-
   *   supplied picture dimensions, 72 dpi resolution values, the `mp4craft AV1` compressor
   *   name, and the wrapped `AV1CodecConfigurationRecord`.
   */
  createSampleEntry(): Box {
    return {
      type: 'av01',
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
        const compressorName = 'mp4craft AV1'
        writer.u8(compressorName.length)
        writer.ascii(compressorName)
        writer.zeros(31 - compressorName.length)
        writer.u16(0x0018)
        writer.u16(0xffff)
        writeBox(writer, createAv1c(this.av1ConfigurationRecord))
      },
    }
  }
}

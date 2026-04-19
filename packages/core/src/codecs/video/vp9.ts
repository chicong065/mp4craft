import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'
import type { VideoCodecAdapter } from '@/codecs/codec'
import { toUint8Array } from '@/io/bytes'

/**
 * VP9 video codec, producing a `vp09` VisualSampleEntry with a `vpcC` FullBox child.
 *
 * As with {@link HevcCodec}, the adapter does not parse the VP Codec Configuration Record to
 * infer picture dimensions. The caller must supply `width` and `height` explicitly, because
 * deriving them from the VP9 uncompressed header is out of scope for the current release. The
 * `vpcC` payload (the body of the FullBox, excluding its version and flags header) is stored
 * opaquely and emitted verbatim.
 *
 * @see {@link https://www.webmproject.org/vp9/mp4/ | VP9 in ISOBMFF (vp09 sample entry and vpcC FullBox)}
 */
export class Vp9Codec implements VideoCodecAdapter {
  readonly kind = 'video'
  readonly fourcc = 'vp09'
  private readonly vpccPayload: Uint8Array
  private readonly width: number
  private readonly height: number

  /**
   * Constructs the VP9 codec adapter.
   *
   * @param description - The VP Codec Configuration Record payload (the `vpcC` FullBox body,
   *   without the leading version and flags bytes) per the VP9 ISOBMFF binding §2.2. Typically
   *   this comes from WebCodecs `VideoDecoderConfig.description` or a source MP4 track's
   *   `vpcC` atom payload.
   * @param width - Coded picture width in luma samples, written into the sample entry.
   * @param height - Coded picture height in luma samples, written into the sample entry.
   */
  constructor(description: ArrayBuffer | ArrayBufferView, width: number, height: number) {
    this.vpccPayload = toUint8Array(description)
    this.width = width
    this.height = height
  }

  /**
   * Builds the `vp09` VisualSampleEntry with its `vpcC` FullBox child.
   *
   * @returns A `Box` whose serializer emits the fixed VisualSampleEntry header, the caller-
   *   supplied picture dimensions, 72 dpi resolution values, the `mp4craft VP9` compressor
   *   name, and the wrapped VP Codec Configuration Record (FullBox version 1).
   */
  createSampleEntry(): Box {
    return {
      type: 'vp09',
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
        const compressorName = 'mp4craft VP9'
        writer.u8(compressorName.length)
        writer.ascii(compressorName)
        writer.zeros(31 - compressorName.length)
        writer.u16(0x0018)
        writer.u16(0xffff)
        writeBox(writer, this.createVpccBox())
      },
    }
  }

  private createVpccBox(): FullBox {
    return {
      type: 'vpcC',
      version: 1,
      flags: 0,
      write: (writer) => writer.bytes(this.vpccPayload),
    }
  }
}

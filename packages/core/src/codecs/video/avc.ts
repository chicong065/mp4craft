import { writeBox, type Box } from '@/boxes/box'
import type { VideoCodecAdapter } from '@/codecs/codec'
import { BitReader } from '@/io/bit-reader'
import { toUint8Array } from '@/io/bytes'
import { unescapeRbsp } from '@/io/nalu'
import { CodecError } from '@/types/errors'

/**
 * AVC (H.264) video codec, producing an `avc1` VisualSampleEntry with an `avcC` child box.
 *
 * The constructor parses the stored AVCDecoderConfigurationRecord's first SPS to derive the
 * coded picture `width` and `height`, which are then written into the sample entry fields.
 *
 * @remarks
 * The muxer keeps the AVCDecoderConfigurationRecord opaque beyond the dimension parse.
 * Callers must supply a valid record, typically obtained from
 * {@link https://w3c.github.io/webcodecs/ | WebCodecs} `VideoDecoderConfig.description` or
 * copied verbatim from a source MP4 track's `avcC` atom.
 *
 * @see {@link https://www.itu.int/rec/T-REC-H.264 | ITU-T H.264 (equivalently ISO/IEC 14496-10)}
 * @see {@link https://mp4ra.org/registered-types/sampleentries | ISO/IEC 14496-15 §5 (avc1 and avcC)}
 */
export class AvcCodec implements VideoCodecAdapter {
  readonly kind = 'video'
  readonly fourcc = 'avc1'
  /** Coded picture width in luma samples, parsed from the SPS inside the AVCDecoderConfigurationRecord. */
  readonly width: number
  /** Coded picture height in luma samples, parsed from the SPS inside the AVCDecoderConfigurationRecord. */
  readonly height: number
  private readonly avcc: Uint8Array

  /**
   * Constructs the AVC codec adapter.
   *
   * @param description - The AVCDecoderConfigurationRecord bytes (the payload that goes inside
   *   the `avcC` box). Typically this comes from WebCodecs `VideoDecoderConfig.description` or
   *   the raw `avcC` atom payload of a source MP4 track.
   *
   * @throws {@link CodecError} When the record is shorter than its fixed header, has an
   *   unsupported configurationVersion, or contains no SPS.
   *
   * @see {@link https://www.itu.int/rec/T-REC-H.264 | ISO/IEC 14496-10 §7.4.1 (SPS semantics)}
   */
  constructor(description: ArrayBuffer | ArrayBufferView) {
    this.avcc = toUint8Array(description)
    const { width, height } = parseAvcCDimensions(this.avcc)
    this.width = width
    this.height = height
  }

  /**
   * Builds the `avc1` VisualSampleEntry with its `avcC` child.
   *
   * @returns A `Box` whose serializer emits the full sample entry, including the fixed
   *   reserved fields, the parsed picture dimensions, 72 dpi resolution values, the
   *   `mp4craft AVC` compressor name, and the wrapped AVCDecoderConfigurationRecord.
   */
  createSampleEntry(): Box {
    return {
      type: 'avc1',
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
        const compressorName = 'mp4craft AVC'
        writer.u8(compressorName.length)
        writer.ascii(compressorName)
        writer.zeros(31 - compressorName.length)
        writer.u16(0x0018)
        writer.u16(0xffff)
        writeBox(writer, this.createAvcCBox())
      },
    }
  }

  private createAvcCBox(): Box {
    return {
      type: 'avcC',
      write: (writer) => writer.bytes(this.avcc),
    }
  }
}

function parseAvcCDimensions(avcc: Uint8Array): { width: number; height: number } {
  if (avcc.length < 8) {
    throw new CodecError('avcC record too short', 'avc')
  }
  if (avcc[0] !== 1) {
    throw new CodecError('unsupported avcC version', 'avc')
  }
  const spsCount = avcc[5]! & 0x1f
  if (spsCount < 1) {
    throw new CodecError('avcC has no SPS', 'avc')
  }
  const spsLength = (avcc[6]! << 8) | avcc[7]!
  const sps = avcc.subarray(8, 8 + spsLength)
  return parseSpsDimensions(sps)
}

function parseSpsDimensions(spsWithNalHeader: Uint8Array): { width: number; height: number } {
  const rbsp = unescapeRbsp(spsWithNalHeader.subarray(1))
  const bitReader = new BitReader(rbsp)
  const profileIdc = bitReader.readBits(8)
  bitReader.skipBits(8)
  bitReader.readBits(8)
  bitReader.readUE()
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
    const chromaFormatIdc = bitReader.readUE()
    if (chromaFormatIdc === 3) {
      bitReader.readBit()
    }
    bitReader.readUE()
    bitReader.readUE()
    bitReader.readBit()
    const seqScalingMatrixPresent = bitReader.readBit()
    if (seqScalingMatrixPresent) {
      const scalingListCount = chromaFormatIdc === 3 ? 12 : 8
      for (let scalingListIndex = 0; scalingListIndex < scalingListCount; scalingListIndex++) {
        if (bitReader.readBit()) {
          const scaleListSize = scalingListIndex < 6 ? 16 : 64
          let lastScale = 8,
            nextScale = 8
          for (let scaleEntryIndex = 0; scaleEntryIndex < scaleListSize; scaleEntryIndex++) {
            if (nextScale !== 0) {
              const deltaScale = bitReader.readSE()
              nextScale = (lastScale + deltaScale + 256) % 256
            }
            lastScale = nextScale === 0 ? lastScale : nextScale
          }
        }
      }
    }
  }
  bitReader.readUE()
  const picOrderCntType = bitReader.readUE()
  if (picOrderCntType === 0) {
    bitReader.readUE()
  } else if (picOrderCntType === 1) {
    bitReader.readBit()
    bitReader.readSE()
    bitReader.readSE()
    const numRefFramesInPicOrderCntCycle = bitReader.readUE()
    for (let picOrderCountIndex = 0; picOrderCountIndex < numRefFramesInPicOrderCntCycle; picOrderCountIndex++) {
      bitReader.readSE()
    }
  }
  bitReader.readUE()
  bitReader.readBit()
  const picWidthInMbsMinus1 = bitReader.readUE()
  const picHeightInMapUnitsMinus1 = bitReader.readUE()
  const frameMbsOnlyFlag = bitReader.readBit()
  if (!frameMbsOnlyFlag) {
    bitReader.readBit()
  }
  bitReader.readBit()
  const frameCroppingFlag = bitReader.readBit()
  let cropLeft = 0,
    cropRight = 0,
    cropTop = 0,
    cropBottom = 0
  if (frameCroppingFlag) {
    cropLeft = bitReader.readUE()
    cropRight = bitReader.readUE()
    cropTop = bitReader.readUE()
    cropBottom = bitReader.readUE()
  }
  const width = (picWidthInMbsMinus1 + 1) * 16 - cropLeft * 2 - cropRight * 2
  const height = (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 - cropTop * 2 - cropBottom * 2
  return { width, height }
}

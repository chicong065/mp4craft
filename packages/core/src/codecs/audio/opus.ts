import { writeBox, type Box } from '@/boxes/box'
import { createDops } from '@/boxes/dops'
import type { AudioCodecAdapter } from '@/codecs/codec'
import { toUint8Array } from '@/io/bytes'

/**
 * Options for constructing an `OpusCodec`.
 *
 * @see {@link https://opus-codec.org/docs/opus_in_isobmff.html | Opus in ISOBMFF (encapsulation spec)}
 * @see {@link https://w3c.github.io/webcodecs/#audio-decoder-config | WebCodecs AudioDecoderConfig}
 */
export type OpusCodecOptions = {
  /**
   * The `OpusSpecificBox` (`dOps`) payload bytes, containing the Opus decoder configuration.
   * Typically obtained from `AudioDecoderConfig.description` when using WebCodecs.
   */
  description: ArrayBuffer | ArrayBufferView
  /** Output channel count, as declared by the Opus decoder configuration. */
  channels: number
  /**
   * Source sample rate of the audio stream. Stored on the codec instance for downstream use,
   * but note that the MP4 AudioSampleEntry samplerate field is always written as 48000 Hz per
   * ISO/IEC 23003-5, regardless of this value.
   */
  sampleRate: number
}

/**
 * Opus audio codec, producing an `Opus` AudioSampleEntry with a `dOps` child box per
 * ISO/IEC 23003-5. The sample rate declared in the entry is always 48000 Hz, matching the
 * Opus decoder's mandatory presentation rate.
 *
 * @see {@link https://opus-codec.org/docs/opus_in_isobmff.html | Opus in ISOBMFF (encapsulation spec, Sample Entry and dOps)}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6716 | RFC 6716: Definition of the Opus Audio Codec}
 * @see {@link https://mp4ra.org/registered-types/sampleentries | MP4 Registration Authority sample-entry registry}
 */
export class OpusCodec implements AudioCodecAdapter {
  readonly kind = 'audio'
  readonly fourcc = 'Opus'
  readonly channels: number
  readonly sampleRate: number
  private readonly opusSpecificPayload: Uint8Array

  constructor(options: OpusCodecOptions) {
    this.opusSpecificPayload = toUint8Array(options.description)
    this.channels = options.channels
    this.sampleRate = options.sampleRate
  }

  createSampleEntry(): Box {
    return {
      type: 'Opus',
      write: (writer) => {
        writer.zeros(6)
        writer.u16(1)
        writer.zeros(8)
        writer.u16(this.channels)
        writer.u16(16)
        writer.u16(0)
        writer.u16(0)
        // ISO/IEC 23003-5 §5 requires the AudioSampleEntry samplerate field to be 48000 Hz
        // regardless of the source rate, encoded as 16.16 fixed-point (48000 << 16 = 0xBB800000).
        writer.u32(0xbb800000)
        writeBox(writer, createDops(this.opusSpecificPayload))
      },
    }
  }
}

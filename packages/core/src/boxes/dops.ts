import type { Box } from '@/boxes/box'

/**
 * Builds an `OpusSpecificBox` (`dOps`) wrapping the supplied raw payload bytes.
 *
 * The `dOps` box is a plain `Box`, not a `FullBox`. Its internal version field lives inside
 * the payload rather than in a shared FullBox header. See the Opus-in-ISOBMFF encapsulation
 * specification §4.3.2 for the full payload layout (Version, OutputChannelCount, PreSkip,
 * InputSampleRate, OutputGain, ChannelMappingFamily, and optional per-stream mapping table).
 *
 * @param opusSpecificPayload - The pre-serialized `OpusSpecificBox` body. Callers are
 *   responsible for producing the 11-byte payload (or longer, when `ChannelMappingFamily`
 *   is non-zero). Typically this is the WebCodecs `AudioDecoderConfig.description`.
 * @returns A `Box` whose serializer writes the payload bytes verbatim.
 *
 * @see {@link https://opus-codec.org/docs/opus_in_isobmff.html | Opus in ISOBMFF (authoritative encapsulation spec)}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6716 | RFC 6716: Definition of the Opus Audio Codec}
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification (source of `AudioDecoderConfig.description`)}
 */
export function createDops(opusSpecificPayload: Uint8Array): Box {
  return {
    type: 'dOps',
    write: (writer) => writer.bytes(opusSpecificPayload),
  }
}
